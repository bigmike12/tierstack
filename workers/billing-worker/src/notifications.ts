import {
  canRollForward,
  loadBillingSettings,
  resolveCurrentPrice,
  attemptInvoicePayment,
  type ProviderFactoryDeps,
} from "@tierstack/billing";
import type { PrismaClient } from "@tierstack/database";
import {
  dunningExhausted,
  MAX_EMAIL_ATTEMPTS,
  paymentFailed,
  paymentRecovered,
  priceChange,
  sendOnce,
  trialEnding,
  type EmailTransport,
} from "@tierstack/notifications";
import { assertCurrency, loadBranding, money } from "@tierstack/shared";

export interface NotificationContext {
  prisma: PrismaClient;
  transport: EmailTransport;
  providerDeps: ProviderFactoryDeps;
  environment: "TEST" | "LIVE";
  log: (message: string, meta?: Record<string, unknown>) => void;
}

const DAY_MS = 86_400_000;

/**
 * Everything the platform tells a customer, derived from state rather than
 * fired from inside a transaction.
 *
 * This is the same shape as every other job here, and for the same reason: a
 * webhook settling a payment should not be waiting on an HTTP call to an email
 * provider while it holds a row lock on an invoice. The cost of deriving is
 * that this job has to be safe to run repeatedly, which is what `dedupeKey`
 * buys — every key is computed from the same facts each time, so a second run
 * finds the message already sent and does nothing.
 */
export async function runNotifications(ctx: NotificationContext, now = new Date()) {
  const branding = loadBranding();
  const settingsCache = new Map<string, Awaited<ReturnType<typeof loadBillingSettings>>>();
  const orgCache = new Map<string, { id: string; name: string }>();
  let sent = 0;
  let considered = 0;
  let exhausted = 0;

  async function settingsFor(organizationId: string) {
    const cached = settingsCache.get(organizationId);
    if (cached) return cached;
    const loaded = await loadBillingSettings(ctx.prisma as never, organizationId);
    settingsCache.set(organizationId, loaded);
    return loaded;
  }

  async function orgFor(organizationId: string) {
    const cached = orgCache.get(organizationId);
    if (cached) return cached;
    const org = await ctx.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { id: true, name: true },
    });
    const value = org ?? { id: organizationId, name: branding.appName };
    orgCache.set(organizationId, value);
    return value;
  }

  async function deliver(params: {
    organizationId: string;
    dedupeKey: string;
    type: string;
    toEmail: string;
    email: { subject: string; text: string; html: string };
    customerId?: string | null;
    subscriptionId?: string | null;
    invoiceId?: string | null;
  }) {
    considered += 1;
    const settings = await settingsFor(params.organizationId);
    const org = await orgFor(params.organizationId);

    const result = await sendOnce(
      ctx.prisma,
      ctx.transport,
      {
        ...params,
        from: settings.emailSender ?? branding.emailSender,
        fromName: settings.senderName ?? org.name,
        replyTo: settings.supportEmail ?? null,
        enabled: settings.notificationsEnabled,
      },
      now
    );
    if (result.sent) sent += 1;
    if (!result.sent && result.reason === "EXHAUSTED") exhausted += 1;
    return result;
  }

  /**
   * A link the customer can actually pay through, or nothing.
   *
   * Reuses a checkout that is already open on the invoice before minting a new
   * one — a customer who has been emailed twice should land on the same page,
   * not accumulate abandoned checkouts at the provider.
   */
  async function payUrlFor(organizationId: string, invoiceId: string): Promise<string | null> {
    const open = await ctx.prisma.paymentAttempt.findFirst({
      where: { organizationId, invoiceId, status: "PENDING", checkoutUrl: { not: null } },
      orderBy: { createdAt: "desc" },
      select: { checkoutUrl: true },
    });
    if (open?.checkoutUrl) return open.checkoutUrl;

    try {
      const attempt = await attemptInvoicePayment(ctx.prisma, ctx.providerDeps, {
        organizationId,
        invoiceId,
        environment: ctx.environment,
        forceCheckout: true,
      });
      return attempt.checkoutUrl ?? null;
    } catch (error) {
      // No pay link is a worse email, not a failed job. Say so and carry on.
      ctx.log("could not open a checkout for a dunning email", {
        invoiceId,
        reason: error instanceof Error ? error.message : "unknown",
      });
      return null;
    }
  }

  /**
   * Whether this message has already reached a state `sendOnce` will not send
   * from, so there is no point building it again.
   *
   * `sendOnce` is idempotent, which is what stops a customer being emailed
   * twice — but it can only make that decision after it has been handed a
   * finished message, and finishing one can be expensive. The exhausted
   * dunning email needs a pay link, and minting one initializes a real
   * transaction at the provider. Without this check that happens on every
   * pass, for the life of the invoice: a checkout every five minutes for a
   * customer who was emailed once, days ago. Where the provider rejects the
   * call, each of those also lands as a FAILED payment attempt, and
   * `dunningAttempts` is a live count of those — so the "3 of 4 retries" the
   * dashboard shows climbs into the hundreds without anybody retrying
   * anything.
   */
  async function alreadySettled(organizationId: string, dedupeKey: string): Promise<boolean> {
    const existing = await ctx.prisma.emailMessage.findUnique({
      where: { organizationId_dedupeKey: { organizationId, dedupeKey } },
      select: { status: true, attempts: true },
    });
    if (!existing) return false;
    if (existing.status === "SENT" || existing.status === "SUPPRESSED") return true;
    // A failure with attempts left is worth rebuilding for; one past the limit
    // is not going to be sent however many times it is rendered.
    return existing.status === "FAILED" && existing.attempts >= MAX_EMAIL_ATTEMPTS;
  }

  // -- a payment that failed -------------------------------------------------
  const failing = await ctx.prisma.invoice.findMany({
    where: { status: "OPEN", dunningAttempts: { gte: 1 } },
    include: { customer: true, subscription: true },
    take: 200,
  });

  for (const invoice of failing) {
    const settings = await settingsFor(invoice.organizationId);
    const currency = assertCurrency(invoice.currency);
    const exhausted = invoice.nextRetryAt === null;

    const dedupeKey = exhausted
      ? `dunning_exhausted:${invoice.id}`
      : `payment_failed:${invoice.id}:${invoice.dunningAttempts}`;
    if (await alreadySettled(invoice.organizationId, dedupeKey)) continue;

    const method = invoice.subscription?.paymentMethodId
      ? await ctx.prisma.paymentMethod.findUnique({
          where: { id: invoice.subscription.paymentMethodId },
          select: { brand: true, last4: true },
        })
      : null;

    // Only the last message carries a pay link: minting a checkout on every
    // failure would leave a trail of abandoned sessions at the provider for a
    // customer whose card is simply going to work on Thursday.
    const payUrl = exhausted ? await payUrlFor(invoice.organizationId, invoice.id) : null;

    const rendered = exhausted
      ? dunningExhausted({
          merchantName: (await orgFor(invoice.organizationId)).name,
          customerName: invoice.customer.name,
          supportEmail: settings.supportEmail,
          amount: money(invoice.amountDue, currency),
          invoiceNumber: invoice.invoiceNumber,
          outcome: outcomeFor(invoice.subscription?.status),
          payUrl,
        })
      : paymentFailed({
          merchantName: (await orgFor(invoice.organizationId)).name,
          customerName: invoice.customer.name,
          supportEmail: settings.supportEmail,
          amount: money(invoice.amountDue, currency),
          invoiceNumber: invoice.invoiceNumber,
          attempt: invoice.dunningAttempts,
          maxAttempts: settings.maxRetryAttempts,
          nextRetryAt: invoice.nextRetryAt,
          payUrl: null,
          cardLabel: method?.last4 ? `${method.brand ?? "card"} ending ${method.last4}` : null,
        });

    await deliver({
      organizationId: invoice.organizationId,
      dedupeKey,
      type: exhausted ? "dunning_exhausted" : "payment_failed",
      toEmail: invoice.customer.email,
      email: rendered,
      customerId: invoice.customerId,
      subscriptionId: invoice.subscriptionId,
      invoiceId: invoice.id,
    });
  }

  // -- a payment that came good ---------------------------------------------
  const recovered = await ctx.prisma.invoice.findMany({
    where: {
      status: "PAID",
      dunningAttempts: { gte: 1 },
      paidAt: { gte: new Date(now.getTime() - 7 * DAY_MS) },
    },
    include: { customer: true },
    take: 200,
  });

  for (const invoice of recovered) {
    const settings = await settingsFor(invoice.organizationId);
    await deliver({
      organizationId: invoice.organizationId,
      dedupeKey: `payment_recovered:${invoice.id}`,
      type: "payment_recovered",
      toEmail: invoice.customer.email,
      email: paymentRecovered({
        merchantName: (await orgFor(invoice.organizationId)).name,
        customerName: invoice.customer.name,
        supportEmail: settings.supportEmail,
        amount: money(invoice.total, assertCurrency(invoice.currency)),
        invoiceNumber: invoice.invoiceNumber,
      }),
      customerId: invoice.customerId,
      subscriptionId: invoice.subscriptionId,
      invoiceId: invoice.id,
    });
  }

  // -- a price rise the customer has not been told about yet ----------------
  const renewingSoon = await ctx.prisma.subscription.findMany({
    where: {
      status: { in: ["ACTIVE", "TRIALING", "PAST_DUE", "GRACE_PERIOD"] },
      pricePinned: false,
      currentPeriodEnd: { gt: now, lte: new Date(now.getTime() + 31 * DAY_MS) },
    },
    include: { customer: true, price: { include: { plan: true } } },
    take: 500,
  });

  for (const subscription of renewingSoon) {
    const settings = await settingsFor(subscription.organizationId);
    const noticeStarts = new Date(
      subscription.currentPeriodEnd.getTime() - settings.priceChangeNoticeDays * DAY_MS
    );
    if (now < noticeStarts) continue;

    const current = await resolveCurrentPrice<typeof subscription.price>(
      ctx.prisma as never,
      subscription.priceId,
      { plan: true }
    );
    if (!current || !canRollForward(subscription.price, current)) continue;
    if (current.unitAmount === null || subscription.price.unitAmount === null) continue;
    if (current.unitAmount === subscription.price.unitAmount) continue;

    const currency = assertCurrency(subscription.price.currency);
    await deliver({
      organizationId: subscription.organizationId,
      dedupeKey: `price_change:${subscription.id}:${current.id}`,
      type: "price_change",
      toEmail: subscription.customer.email,
      email: priceChange({
        merchantName: (await orgFor(subscription.organizationId)).name,
        customerName: subscription.customer.name,
        supportEmail: settings.supportEmail,
        planName: current.plan.name,
        oldAmount: money(subscription.price.unitAmount, currency),
        newAmount: money(current.unitAmount, currency),
        effectiveOn: subscription.currentPeriodEnd,
        intervalLabel: intervalLabel(current.intervalUnit, current.intervalCount),
      }),
      customerId: subscription.customerId,
      subscriptionId: subscription.id,
    });
  }

  // -- a trial about to become a charge -------------------------------------
  const trialing = await ctx.prisma.subscription.findMany({
    where: {
      status: "TRIALING",
      trialEnd: { gt: now, lte: new Date(now.getTime() + 31 * DAY_MS) },
    },
    include: { customer: true, price: { include: { plan: true } } },
    take: 500,
  });

  for (const subscription of trialing) {
    const settings = await settingsFor(subscription.organizationId);
    const trialEnd = subscription.trialEnd;
    if (!trialEnd) continue;
    if (now < new Date(trialEnd.getTime() - settings.trialEndingNoticeDays * DAY_MS)) continue;
    if (subscription.price.unitAmount === null) continue;

    const storedMethods = await ctx.prisma.paymentMethod.count({
      where: {
        organizationId: subscription.organizationId,
        customerId: subscription.customerId,
        status: "ACTIVE",
      },
    });

    await deliver({
      organizationId: subscription.organizationId,
      dedupeKey: `trial_ending:${subscription.id}:${trialEnd.toISOString()}`,
      type: "trial_ending",
      toEmail: subscription.customer.email,
      email: trialEnding({
        merchantName: (await orgFor(subscription.organizationId)).name,
        customerName: subscription.customer.name,
        supportEmail: settings.supportEmail,
        planName: subscription.price.plan.name,
        amount: money(subscription.price.unitAmount, assertCurrency(subscription.price.currency)),
        endsOn: trialEnd,
        intervalLabel: intervalLabel(
          subscription.price.intervalUnit,
          subscription.price.intervalCount
        ),
        hasPaymentMethod: storedMethods > 0 || subscription.paymentMethodId !== null,
      }),
      customerId: subscription.customerId,
      subscriptionId: subscription.id,
    });
  }

  if (sent > 0) ctx.log("customer email sent", { sent, considered });
  return { considered, sent, exhausted };
}

function outcomeFor(status: string | undefined): "UNPAID" | "CANCELED" | "PAUSED" {
  if (status === "CANCELED") return "CANCELED";
  if (status === "PAUSED") return "PAUSED";
  return "UNPAID";
}

/** "per month", "every 3 months", "per year" — read aloud, not `MONTH:1`. */
export function intervalLabel(unit: string, count: number): string {
  const noun = unit.toLowerCase();
  return count === 1 ? `per ${noun}` : `every ${count} ${noun}s`;
}
