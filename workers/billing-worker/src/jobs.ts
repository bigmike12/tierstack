import {
  applyTransition,
  attemptInvoicePayment,
  loadBillingSettings,
  expireGracePeriods,
  expireIncompleteSubscriptions,
  renewSubscription,
  type ProviderFactoryDeps,
} from "@tierstack/billing";
import type { PrismaClient } from "@tierstack/database";
import { BillingError } from "@tierstack/shared";

export interface JobContext {
  prisma: PrismaClient;
  providerDeps: ProviderFactoryDeps;
  environment: "TEST" | "LIVE";
  log: (message: string, meta?: Record<string, unknown>) => void;
}

/**
 * Opens the next billing period for every subscription whose period has ended,
 * issues that invoice, and attempts collection. Batched and idempotent: a
 * subscription whose period has already been advanced is simply not selected.
 */
export async function runRenewals(ctx: JobContext, now = new Date(), batchSize = 100) {
  const due = await ctx.prisma.subscription.findMany({
    where: {
      status: { in: ["ACTIVE", "TRIALING"] },
      currentPeriodEnd: { lte: now },
    },
    select: { id: true, organizationId: true },
    take: batchSize,
    orderBy: { currentPeriodEnd: "asc" },
  });

  let renewed = 0;
  let collected = 0;
  let failed = 0;

  for (const subscription of due) {
    try {
      const result = await renewSubscription(ctx.prisma, subscription.id, now);
      if (!result.renewed) continue;
      renewed += 1;

      if (result.invoiceId) {
        try {
          await attemptInvoicePayment(ctx.prisma, ctx.providerDeps, {
            organizationId: subscription.organizationId,
            invoiceId: result.invoiceId,
            environment: ctx.environment,
          });
          collected += 1;
        } catch (error) {
          failed += 1;
          ctx.log("renewal collection failed", {
            subscriptionId: subscription.id,
            reason: error instanceof BillingError ? error.code : "unknown",
          });

          // A trial is left in TRIALING through its final renewal so that a
          // converting customer never passes through PAST_DUE. If the charge
          // could not even be attempted — every rail down, say — that leaves
          // the trial holding live entitlements with its period already
          // advanced, and nothing would select it again. Close it here.
          if (result.previousStatus === "TRIALING") {
            await applyTransition(
              ctx.prisma,
              subscription.id,
              "TRIALING",
              "PAST_DUE",
              "trial_ended_uncollected"
            ).catch((transitionError: unknown) => {
              ctx.log("could not close an uncollected trial", {
                subscriptionId: subscription.id,
                reason: transitionError instanceof Error ? transitionError.message : "unknown",
              });
            });
          }
        }
      }
    } catch (error) {
      failed += 1;
      ctx.log("renewal failed", {
        subscriptionId: subscription.id,
        reason: error instanceof Error ? error.message : "unknown",
      });
    }
  }

  return { considered: due.length, renewed, collected, failed };
}

/**
 * Works the dunning ladder.
 *
 * An invoice carries its own next retry time, written when the payment failed
 * from the organization's own schedule — [0, 1, 3, 5] days after the *first*
 * failure by default, never a constant in this file. Selecting on that column
 * is the whole job: an invoice whose retries are exhausted has a null there and
 * is simply not returned, and one that got paid in the meantime had it cleared.
 *
 * This is the difference between detecting a failed payment and recovering it.
 * A card that declines on the 1st very often works on the 3rd — a temporary
 * limit, a card reissued, a bank that blocks the first online charge — and
 * without this job every one of those customers is lost at the end of their
 * grace period having never been asked twice.
 */
export async function runDunningRetries(ctx: JobContext, now = new Date(), batchSize = 100) {
  const due = await ctx.prisma.invoice.findMany({
    where: { status: "OPEN", nextRetryAt: { lte: now }, subscriptionId: { not: null } },
    select: { id: true, organizationId: true, dunningAttempts: true },
    orderBy: { nextRetryAt: "asc" },
    take: batchSize,
  });

  let attempted = 0;
  let recovered = 0;
  let exhausted = 0;

  for (const invoice of due) {
    try {
      const settings = await loadBillingSettings(ctx.prisma as never, invoice.organizationId);

      // Belt and braces: nextRetryAt should already be null past the limit, but
      // an invoice that slipped through must not be retried forever.
      if (invoice.dunningAttempts >= settings.maxRetryAttempts) {
        await ctx.prisma.invoice.update({ where: { id: invoice.id }, data: { nextRetryAt: null } });
        exhausted += 1;
        continue;
      }

      attempted += 1;
      const result = await attemptInvoicePayment(ctx.prisma, ctx.providerDeps, {
        organizationId: invoice.organizationId,
        invoiceId: invoice.id,
        environment: ctx.environment,
      });

      if (result.status === "SUCCEEDED") {
        recovered += 1;
        ctx.log("dunning recovered a payment", { invoiceId: invoice.id, amount: result.amount });
      }
    } catch (error) {
      // A failed attempt is the expected case here and reschedules itself
      // inside applyPaymentResult. Anything else is worth naming.
      ctx.log("dunning retry could not run", {
        invoiceId: invoice.id,
        reason: error instanceof BillingError ? error.code : "unknown",
      });
    }
  }

  if (attempted > 0) ctx.log("dunning ladder ran", { attempted, recovered, exhausted });
  return { considered: due.length, attempted, recovered, exhausted };
}

/**
 * Closes grace periods that have run out, applying whatever final action the
 * organization configured — MARK_UNPAID, CANCEL or PAUSE.
 */
export async function runGraceExpiry(ctx: JobContext, now = new Date()) {
  const organizations = await ctx.prisma.subscription.findMany({
    where: { status: "GRACE_PERIOD", gracePeriodEnd: { lte: now } },
    select: { organizationId: true },
    distinct: ["organizationId"],
  });

  const results: { subscriptionId: string; status: string }[] = [];
  for (const { organizationId } of organizations) {
    results.push(...(await expireGracePeriods(ctx.prisma, organizationId, now)));
  }
  if (results.length > 0) {
    ctx.log("grace periods closed", { count: results.length });
  }
  return results;
}

/**
 * Expires subscriptions whose first payment never arrived, and voids the
 * invoice that went with them, so an abandoned checkout does not sit on the
 * books as receivable forever.
 */
export async function runIncompleteExpiry(ctx: JobContext, now = new Date()) {
  const organizations = await ctx.prisma.subscription.findMany({
    where: { status: "INCOMPLETE" },
    select: { organizationId: true },
    distinct: ["organizationId"],
  });

  const expired: string[] = [];
  for (const { organizationId } of organizations) {
    expired.push(...(await expireIncompleteSubscriptions(ctx.prisma, organizationId, now)));
  }
  if (expired.length > 0) ctx.log("abandoned checkouts expired", { count: expired.length });
  return { expired: expired.length };
}

/** Idempotency records are short-lived by design; this reclaims the space. */
export async function runIdempotencySweep(ctx: JobContext, now = new Date()) {
  const { count } = await ctx.prisma.idempotencyKey.deleteMany({
    where: { expiresAt: { lte: now } },
  });
  return { deleted: count };
}

export async function runSessionSweep(ctx: JobContext, now = new Date()) {
  const { count } = await ctx.prisma.session.deleteMany({ where: { expiresAt: { lte: now } } });
  return { deleted: count };
}
