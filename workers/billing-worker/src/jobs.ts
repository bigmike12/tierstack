import {
  attemptInvoicePayment,
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
