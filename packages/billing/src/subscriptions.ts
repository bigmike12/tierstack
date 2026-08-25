import type { PrismaClient } from "@tierstack/database";
import {
  BillingError,
  addInterval,
  assertCurrency,
  computeBillingPeriod,
  loadBranding,
  money,
  newId,
  type CurrencyCode,
} from "@tierstack/shared";
import { resolveCustomer, type CustomerInput } from "./customers";
import { createInvoice, finalizeInvoice } from "./invoice";
import { calculateProration, calculateSeatProration } from "./proration";
import { getUsageSnapshot } from "@tierstack/usage";
import {
  assertBillablePriceModel,
  buildRecurringLines,
  buildUsageLines,
  priceInterval,
  recurringAmount,
  type ComputedLine,
  type PriceSnapshot,
} from "./pricing";
import { loadBillingSettings, loadDunningPolicy } from "./settings";
import { applyTransition, recordInitialStatus } from "./transitions";
import type { SubscriptionStatus } from "./state-machine";

export interface CreateSubscriptionParams {
  organizationId: string;
  customerId?: string | null;
  customer?: CustomerInput | null;
  priceId: string;
  quantity?: number;
  /** Overrides the price's own trial length. Set 0 to skip a configured trial. */
  trialDays?: number | null;
  paymentMethodId?: string | null;
  metadata?: Record<string, unknown>;
  startAt?: Date;
}

export interface CreatedSubscription {
  subscriptionId: string;
  customerId: string;
  status: SubscriptionStatus;
  invoiceId: string | null;
  currency: CurrencyCode;
  amountDue: number;
}

/**
 * Creates a subscription and, unless it starts in a trial, its first invoice.
 *
 * A subscription that owes money is created in PAST_DUE and only becomes ACTIVE
 * once a payment actually settles — the platform never grants paid status on
 * the strength of an unpaid invoice.
 */
export async function createSubscription(
  prisma: PrismaClient,
  params: CreateSubscriptionParams
): Promise<CreatedSubscription> {
  const branding = loadBranding();

  return prisma.$transaction(async (tx) => {
    const customer = await resolveCustomer(tx, {
      organizationId: params.organizationId,
      customerId: params.customerId,
      customer: params.customer,
    });

    const price = await tx.price.findFirst({
      where: { organizationId: params.organizationId, OR: [{ id: params.priceId }, { code: params.priceId }] },
      include: { plan: true, usageMeter: true },
    });
    if (!price) throw BillingError.notFound("PRICE_NOT_FOUND", "Price");
    if (!price.active) {
      throw new BillingError("INVALID_REQUEST", `Price "${price.code}" is not active.`);
    }

    const snapshot = toPriceSnapshot(price);
    assertBillablePriceModel(snapshot);

    const currency = assertCurrency(price.currency);
    const quantity = params.quantity ?? 1;
    if (!Number.isInteger(quantity) || quantity < 1) {
      throw new BillingError("VALIDATION_ERROR", "Subscription quantity must be a positive integer.");
    }
    if (snapshot.model !== "PER_SEAT" && quantity !== 1) {
      throw new BillingError(
        "VALIDATION_ERROR",
        `Price "${price.code}" is not per-seat, so quantity must be 1.`
      );
    }

    if (params.paymentMethodId) {
      const method = await tx.paymentMethod.findFirst({
        where: {
          id: params.paymentMethodId,
          organizationId: params.organizationId,
          customerId: customer.id,
          status: "ACTIVE",
        },
      });
      if (!method) throw BillingError.notFound("PAYMENT_METHOD_NOT_FOUND", "Payment method");
    }

    const settings = await loadBillingSettings(tx, params.organizationId);
    const start = params.startAt ?? new Date();
    const trialDays = params.trialDays ?? price.trialDays ?? 0;
    const anchorDay = start.getUTCDate();

    const period =
      trialDays > 0
        ? { start, end: new Date(start.getTime() + trialDays * 86_400_000) }
        : computeBillingPeriod(start, priceInterval(snapshot), anchorDay);

    // Never PAST_DUE on creation: nothing has lapsed yet. INCOMPLETE says
    // exactly what is true — the subscription exists and owes its first payment.
    const status: SubscriptionStatus = trialDays > 0 ? "TRIALING" : "INCOMPLETE";

    const subscription = await tx.subscription.create({
      data: {
        id: newId("subscription"),
        organizationId: params.organizationId,
        customerId: customer.id,
        priceId: price.id,
        status,
        quantity,
        currentPeriodStart: period.start,
        currentPeriodEnd: period.end,
        billingAnchorDay: anchorDay,
        trialStart: trialDays > 0 ? start : null,
        trialEnd: trialDays > 0 ? period.end : null,
        paymentMethodId: params.paymentMethodId ?? null,
        metadata: (params.metadata ?? {}) as never,
      },
    });

    await recordInitialStatus(
      tx,
      subscription.id,
      status,
      trialDays > 0 ? "trial_started" : "subscription_created"
    );

    if (trialDays > 0) {
      return {
        subscriptionId: subscription.id,
        customerId: customer.id,
        status,
        invoiceId: null,
        currency,
        amountDue: 0,
      };
    }

    const lines = buildRecurringLines({
      price: snapshot,
      quantity,
      periodStart: period.start,
      periodEnd: period.end,
      planName: price.plan.name,
    });

    const invoice = await createInvoice(tx, {
      organizationId: params.organizationId,
      customerId: customer.id,
      subscriptionId: subscription.id,
      currency,
      lines,
      billingPeriodStart: period.start,
      billingPeriodEnd: period.end,
      invoiceDueDays: settings.invoiceDueDays,
      invoiceNumberPrefix: branding.invoiceNumberPrefix,
    });
    const finalized = await finalizeInvoice(tx, invoice.id, settings.invoiceDueDays);

    // A zero-value first invoice (100% coupon, full credit) settles on the spot.
    if (finalized.status === "PAID") {
      await applyTransition(tx, subscription.id, status, "ACTIVE", "invoice_settled_at_zero");
      return {
        subscriptionId: subscription.id,
        customerId: customer.id,
        status: "ACTIVE",
        invoiceId: finalized.id,
        currency,
        amountDue: 0,
      };
    }

    return {
      subscriptionId: subscription.id,
      customerId: customer.id,
      status,
      invoiceId: finalized.id,
      currency,
      amountDue: finalized.amountDue,
    };
  });
}

/**
 * Opens the next billing period and issues its invoice. Called by the renewal
 * worker when currentPeriodEnd passes, and by tests that fast-forward time.
 */
export async function renewSubscription(prisma: PrismaClient, subscriptionId: string, now = new Date()) {
  const branding = loadBranding();

  return prisma.$transaction(async (tx) => {
    const subscription = await tx.subscription.findUnique({
      where: { id: subscriptionId },
      include: { price: { include: { plan: true, usageMeter: true } } },
    });
    if (!subscription) throw BillingError.notFound("SUBSCRIPTION_NOT_FOUND", "Subscription");

    const status = subscription.status as SubscriptionStatus;
    if (["CANCELED", "EXPIRED", "PAUSED"].includes(status)) {
      throw new BillingError("INVALID_STATE_TRANSITION", `A ${status} subscription cannot renew.`);
    }
    if (status === "INCOMPLETE") {
      throw new BillingError(
        "INVALID_STATE_TRANSITION",
        "This subscription has never been paid for. Collect its first invoice before opening another period."
      );
    }

    if (subscription.cancelAtPeriodEnd) {
      await applyTransition(tx, subscription.id, status, "CANCELED", "cancel_at_period_end", {
        canceledAt: now,
        endedAt: subscription.currentPeriodEnd,
      });
      return { renewed: false as const, invoiceId: null };
    }

    const snapshot = toPriceSnapshot(subscription.price);
    assertBillablePriceModel(snapshot);

    const settings = await loadBillingSettings(tx, subscription.organizationId);
    const currency = assertCurrency(subscription.price.currency);
    const periodStart = subscription.currentPeriodEnd;
    const periodEnd = addInterval(
      periodStart,
      priceInterval(snapshot),
      subscription.billingAnchorDay ?? undefined
    );

    const lines = buildRecurringLines({
      price: snapshot,
      quantity: subscription.quantity,
      periodStart,
      periodEnd,
      planName: subscription.price.plan.name,
    });

    // Consumption for the period that just closed, billed in arrears. The base
    // fee above covers the period about to open; these two windows differ by
    // design and each line says which one it belongs to.
    if (snapshot.usageMeterId) {
      const closed = {
        start: subscription.currentPeriodStart,
        end: subscription.currentPeriodEnd,
      };
      const usage = await getUsageSnapshot(tx, {
        organizationId: subscription.organizationId,
        customerId: subscription.customerId,
        meterId: snapshot.usageMeterId,
        period: closed,
        price: {
          usageMeterId: snapshot.usageMeterId,
          usageUnitAmount: snapshot.usageUnitAmount ?? null,
          usageUnitSize: snapshot.usageUnitSize ?? null,
          includedUnits: snapshot.includedUnits ?? null,
        },
      });

      lines.push(
        ...buildUsageLines({
          price: snapshot,
          meterName: usage.meterName,
          unitLabel: usage.unitLabel,
          used: usage.used,
          included: usage.included,
          overage: usage.overage,
          blocks: usage.overageBlocks,
          periodStart: closed.start,
          periodEnd: closed.end,
        })
      );
    }

    const invoice = await createInvoice(tx, {
      organizationId: subscription.organizationId,
      customerId: subscription.customerId,
      subscriptionId: subscription.id,
      currency,
      lines,
      billingPeriodStart: periodStart,
      billingPeriodEnd: periodEnd,
      invoiceDueDays: settings.invoiceDueDays,
      invoiceNumberPrefix: branding.invoiceNumberPrefix,
    });
    const finalized = await finalizeInvoice(tx, invoice.id, settings.invoiceDueDays);

    await tx.subscription.update({
      where: { id: subscription.id },
      data: { currentPeriodStart: periodStart, currentPeriodEnd: periodEnd },
    });

    // A trial that reaches its end owes money for the first real period.
    if (status === "TRIALING" && finalized.status !== "PAID") {
      await applyTransition(tx, subscription.id, status, "PAST_DUE", "trial_ended");
    }

    return { renewed: true as const, invoiceId: finalized.id, amountDue: finalized.amountDue };
  });
}

export type PlanChangeTiming = "IMMEDIATE" | "NEXT_PERIOD";

export interface ChangePlanParams {
  organizationId: string;
  subscriptionId: string;
  newPriceId: string;
  quantity?: number;
  /** Defaults follow the documented policy: upgrades now, downgrades next period. */
  timing?: PlanChangeTiming;
  now?: Date;
}

/**
 * Upgrade, downgrade or interval change. An immediate change credits the unused
 * remainder of the current period and charges the new rate for the same window;
 * both halves land on a proration invoice so the arithmetic is visible.
 */
export async function changePlan(prisma: PrismaClient, params: ChangePlanParams) {
  const branding = loadBranding();
  const now = params.now ?? new Date();

  return prisma.$transaction(async (tx) => {
    const subscription = await tx.subscription.findFirst({
      where: { id: params.subscriptionId, organizationId: params.organizationId },
      include: { price: { include: { plan: true, usageMeter: true } } },
    });
    if (!subscription) throw BillingError.notFound("SUBSCRIPTION_NOT_FOUND", "Subscription");

    const status = subscription.status as SubscriptionStatus;
    if (["CANCELED", "EXPIRED"].includes(status)) {
      throw new BillingError("INVALID_STATE_TRANSITION", `A ${status} subscription cannot change plan.`);
    }

    const newPrice = await tx.price.findFirst({
      where: {
        organizationId: params.organizationId,
        OR: [{ id: params.newPriceId }, { code: params.newPriceId }],
      },
      include: { plan: true },
    });
    if (!newPrice) throw BillingError.notFound("PRICE_NOT_FOUND", "Price");

    const oldSnapshot = toPriceSnapshot(subscription.price);
    const newSnapshot = toPriceSnapshot(newPrice);
    assertBillablePriceModel(newSnapshot);

    if (oldSnapshot.currency !== newSnapshot.currency) {
      throw new BillingError(
        "CURRENCY_MISMATCH",
        `Cannot move a ${oldSnapshot.currency} subscription onto a ${newSnapshot.currency} price. ` +
          "Cancel and re-subscribe instead."
      );
    }

    const currency = assertCurrency(newPrice.currency);
    const quantity = params.quantity ?? subscription.quantity;
    const currentValue = recurringAmount(oldSnapshot, subscription.quantity);
    const newValue = recurringAmount(newSnapshot, quantity);

    const timing: PlanChangeTiming =
      params.timing ?? (newValue.amount >= currentValue.amount ? "IMMEDIATE" : "NEXT_PERIOD");

    if (timing === "NEXT_PERIOD") {
      await tx.subscription.update({
        where: { id: subscription.id },
        data: { metadata: { ...(subscription.metadata as object), pendingPriceId: newPrice.id } as never },
      });
      await tx.subscriptionTransition.create({
        data: {
          subscriptionId: subscription.id,
          fromStatus: status,
          toStatus: status,
          reason: "plan_change_scheduled",
          metadata: { newPriceId: newPrice.id, quantity, effectiveAt: subscription.currentPeriodEnd } as never,
        },
      });
      return {
        applied: false as const,
        effectiveAt: subscription.currentPeriodEnd,
        invoiceId: null,
        netAmount: 0,
      };
    }

    const proration = calculateProration({
      periodStart: subscription.currentPeriodStart,
      periodEnd: subscription.currentPeriodEnd,
      changeAt: now,
      currentAmount: currentValue,
      newAmount: newValue,
    });

    await tx.subscription.update({
      where: { id: subscription.id },
      data: { priceId: newPrice.id, quantity },
    });
    await tx.subscriptionTransition.create({
      data: {
        subscriptionId: subscription.id,
        fromStatus: status,
        toStatus: status,
        reason: newValue.amount >= currentValue.amount ? "plan_upgraded" : "plan_downgraded",
        metadata: {
          fromPriceId: subscription.priceId,
          toPriceId: newPrice.id,
          netAmount: proration.netAmount.amount,
        } as never,
      },
    });

    if (proration.lines.length === 0) {
      return { applied: true as const, effectiveAt: now, invoiceId: null, netAmount: 0 };
    }

    const settings = await loadBillingSettings(tx, params.organizationId);
    const invoice = await createInvoice(tx, {
      organizationId: params.organizationId,
      customerId: subscription.customerId,
      subscriptionId: subscription.id,
      currency,
      lines: proration.lines.map(toComputedLine),
      billingPeriodStart: now,
      billingPeriodEnd: subscription.currentPeriodEnd,
      invoiceDueDays: settings.invoiceDueDays,
      invoiceNumberPrefix: branding.invoiceNumberPrefix,
      metadata: { reason: "plan_change", fromPriceId: subscription.priceId, toPriceId: newPrice.id },
    });
    const finalized = await finalizeInvoice(tx, invoice.id, settings.invoiceDueDays);

    return {
      applied: true as const,
      effectiveAt: now,
      invoiceId: finalized.id,
      netAmount: proration.netAmount.amount,
    };
  });
}

/** Seat changes: increases bill immediately, decreases take effect next period. */
export async function changeQuantity(
  prisma: PrismaClient,
  params: { organizationId: string; subscriptionId: string; quantity: number; now?: Date }
) {
  const branding = loadBranding();
  const now = params.now ?? new Date();

  return prisma.$transaction(async (tx) => {
    const subscription = await tx.subscription.findFirst({
      where: { id: params.subscriptionId, organizationId: params.organizationId },
      include: { price: { include: { plan: true, usageMeter: true } } },
    });
    if (!subscription) throw BillingError.notFound("SUBSCRIPTION_NOT_FOUND", "Subscription");

    const snapshot = toPriceSnapshot(subscription.price);
    if (snapshot.model !== "PER_SEAT") {
      throw new BillingError(
        "VALIDATION_ERROR",
        `Price "${snapshot.code}" is not per-seat, so its quantity cannot be changed.`
      );
    }
    if (!Number.isInteger(params.quantity) || params.quantity < 1) {
      throw new BillingError("VALIDATION_ERROR", "Seat count must be a positive integer.");
    }

    const currency = assertCurrency(subscription.price.currency);
    const delta = params.quantity - subscription.quantity;
    if (delta === 0) return { applied: false as const, invoiceId: null, netAmount: 0 };

    if (delta < 0) {
      await tx.subscription.update({
        where: { id: subscription.id },
        data: {
          metadata: { ...(subscription.metadata as object), pendingQuantity: params.quantity } as never,
        },
      });
      await tx.subscriptionTransition.create({
        data: {
          subscriptionId: subscription.id,
          fromStatus: subscription.status,
          toStatus: subscription.status,
          reason: "seat_decrease_scheduled",
          metadata: { quantity: params.quantity, effectiveAt: subscription.currentPeriodEnd } as never,
        },
      });
      return { applied: false as const, invoiceId: null, netAmount: 0 };
    }

    const proration = calculateSeatProration({
      periodStart: subscription.currentPeriodStart,
      periodEnd: subscription.currentPeriodEnd,
      changeAt: now,
      unitAmount: money(snapshot.unitAmount ?? 0, currency),
      fromQuantity: subscription.quantity,
      toQuantity: params.quantity,
    });

    await tx.subscription.update({
      where: { id: subscription.id },
      data: { quantity: params.quantity },
    });

    if (proration.lines.length === 0) {
      return { applied: true as const, invoiceId: null, netAmount: 0 };
    }

    const settings = await loadBillingSettings(tx, params.organizationId);
    const invoice = await createInvoice(tx, {
      organizationId: params.organizationId,
      customerId: subscription.customerId,
      subscriptionId: subscription.id,
      currency,
      lines: proration.lines.map(toComputedLine),
      billingPeriodStart: now,
      billingPeriodEnd: subscription.currentPeriodEnd,
      invoiceDueDays: settings.invoiceDueDays,
      invoiceNumberPrefix: branding.invoiceNumberPrefix,
      metadata: { reason: "seat_change" },
    });
    const finalized = await finalizeInvoice(tx, invoice.id, settings.invoiceDueDays);

    return { applied: true as const, invoiceId: finalized.id, netAmount: proration.netAmount.amount };
  });
}

export async function cancelSubscription(
  prisma: PrismaClient,
  params: { organizationId: string; subscriptionId: string; atPeriodEnd?: boolean; now?: Date }
) {
  const now = params.now ?? new Date();

  return prisma.$transaction(async (tx) => {
    const subscription = await tx.subscription.findFirst({
      where: { id: params.subscriptionId, organizationId: params.organizationId },
    });
    if (!subscription) throw BillingError.notFound("SUBSCRIPTION_NOT_FOUND", "Subscription");

    const status = subscription.status as SubscriptionStatus;
    if (status === "CANCELED") {
      throw new BillingError("SUBSCRIPTION_ALREADY_CANCELED", "This subscription is already canceled.");
    }

    if (params.atPeriodEnd) {
      const updated = await tx.subscription.update({
        where: { id: subscription.id },
        data: { cancelAtPeriodEnd: true, canceledAt: now },
      });
      await tx.subscriptionTransition.create({
        data: {
          subscriptionId: subscription.id,
          fromStatus: status,
          toStatus: status,
          reason: "cancel_scheduled_at_period_end",
        },
      });
      return updated;
    }

    return applyTransition(tx, subscription.id, status, "CANCELED", "canceled_immediately", {
      canceledAt: now,
      endedAt: now,
      cancelAtPeriodEnd: false,
    });
  });
}

/** Undo a scheduled cancellation, while the period is still running. */
export async function resumeSubscription(
  prisma: PrismaClient,
  params: { organizationId: string; subscriptionId: string; now?: Date }
) {
  const now = params.now ?? new Date();

  return prisma.$transaction(async (tx) => {
    const subscription = await tx.subscription.findFirst({
      where: { id: params.subscriptionId, organizationId: params.organizationId },
    });
    if (!subscription) throw BillingError.notFound("SUBSCRIPTION_NOT_FOUND", "Subscription");

    const status = subscription.status as SubscriptionStatus;

    if (status === "PAUSED") {
      return applyTransition(tx, subscription.id, status, "ACTIVE", "resumed_from_pause", {
        pausedAt: null,
      });
    }
    if (!subscription.cancelAtPeriodEnd) {
      throw new BillingError(
        "INVALID_STATE_TRANSITION",
        "This subscription is neither paused nor scheduled for cancellation."
      );
    }
    if (subscription.currentPeriodEnd.getTime() <= now.getTime()) {
      throw new BillingError(
        "INVALID_STATE_TRANSITION",
        "The billing period has already ended; create a new subscription instead."
      );
    }

    const updated = await tx.subscription.update({
      where: { id: subscription.id },
      data: { cancelAtPeriodEnd: false, canceledAt: null },
    });
    await tx.subscriptionTransition.create({
      data: {
        subscriptionId: subscription.id,
        fromStatus: status,
        toStatus: status,
        reason: "cancellation_revoked",
      },
    });
    return updated;
  });
}

export async function pauseSubscription(
  prisma: PrismaClient,
  params: { organizationId: string; subscriptionId: string; now?: Date }
) {
  const now = params.now ?? new Date();
  return prisma.$transaction(async (tx) => {
    const subscription = await tx.subscription.findFirst({
      where: { id: params.subscriptionId, organizationId: params.organizationId },
    });
    if (!subscription) throw BillingError.notFound("SUBSCRIPTION_NOT_FOUND", "Subscription");
    return applyTransition(
      tx,
      subscription.id,
      subscription.status as SubscriptionStatus,
      "PAUSED",
      "paused",
      { pausedAt: now }
    );
  });
}

/**
 * Expires subscriptions whose first payment never arrived. Without this an
 * abandoned checkout would leave an INCOMPLETE subscription and an open invoice
 * on the books forever. The window is the organization's own setting; zero
 * disables expiry entirely.
 */
export async function expireIncompleteSubscriptions(
  prisma: PrismaClient,
  organizationId: string,
  now = new Date()
) {
  const policy = await loadDunningPolicy(prisma, organizationId);
  if (policy.incompleteExpiryHours <= 0) return [];

  const cutoff = new Date(now.getTime() - policy.incompleteExpiryHours * 3_600_000);
  const stale = await prisma.subscription.findMany({
    where: { organizationId, status: "INCOMPLETE", createdAt: { lte: cutoff } },
    select: { id: true, status: true },
  });

  const expired: string[] = [];
  for (const subscription of stale) {
    await prisma.$transaction(async (tx) => {
      await applyTransition(
        tx,
        subscription.id,
        subscription.status as SubscriptionStatus,
        "EXPIRED",
        "first_payment_never_completed",
        { endedAt: now }
      );
      // The invoice goes with it: nothing is owed on a subscription that never
      // started, so leaving it OPEN would misstate receivables.
      await tx.invoice.updateMany({
        where: { subscriptionId: subscription.id, status: { in: ["DRAFT", "OPEN"] } },
        data: { status: "VOID", voidedAt: now, amountDue: 0, nextRetryAt: null },
      });
    });
    expired.push(subscription.id);
  }
  return expired;
}

/** Closes out grace periods that have run their course, per the frozen policy. */
export async function expireGracePeriods(prisma: PrismaClient, organizationId: string, now = new Date()) {
  const due = await prisma.subscription.findMany({
    where: { organizationId, status: "GRACE_PERIOD", gracePeriodEnd: { lte: now } },
    select: { id: true, status: true, gracePolicy: true },
  });

  const results: { subscriptionId: string; status: SubscriptionStatus }[] = [];
  for (const subscription of due) {
    const policy = (subscription.gracePolicy ?? null) as { failureAction?: string } | null;
    const action = (policy?.failureAction ?? (await loadDunningPolicy(prisma, organizationId)).failureAction) as
      | "MARK_UNPAID"
      | "CANCEL"
      | "PAUSE";
    const target = action === "CANCEL" ? "CANCELED" : action === "PAUSE" ? "PAUSED" : "UNPAID";

    await prisma.$transaction(async (tx) => {
      await applyTransition(
        tx,
        subscription.id,
        subscription.status as SubscriptionStatus,
        target,
        "grace_period_expired",
        target === "CANCELED" ? { canceledAt: now, endedAt: now } : target === "PAUSED" ? { pausedAt: now } : {}
      );
    });
    results.push({ subscriptionId: subscription.id, status: target });
  }
  return results;
}

// -- helpers -----------------------------------------------------------------

export function toPriceSnapshot(price: {
  id: string;
  code: string;
  nickname: string | null;
  model: string;
  currency: string;
  unitAmount: number | null;
  intervalUnit: string;
  intervalCount: number;
  usageMeterId?: string | null;
  usageMeter?: { code: string } | null;
  usageUnitAmount?: number | null;
  usageUnitSize?: number | null;
  includedUnits?: number | null;
  trialDays?: number | null;
}): PriceSnapshot {
  return {
    id: price.id,
    code: price.code,
    nickname: price.nickname,
    model: price.model as PriceSnapshot["model"],
    currency: price.currency,
    unitAmount: price.unitAmount,
    intervalUnit: price.intervalUnit as PriceSnapshot["intervalUnit"],
    intervalCount: price.intervalCount,
    usageMeterId: price.usageMeterId ?? null,
    usageMeterCode: price.usageMeter?.code ?? null,
    usageUnitAmount: price.usageUnitAmount ?? null,
    usageUnitSize: price.usageUnitSize ?? null,
    includedUnits: price.includedUnits ?? null,
    trialDays: price.trialDays ?? null,
  };
}

function toComputedLine(line: {
  type: "PRORATION";
  description: string;
  quantity: number;
  unitAmount: number;
  amount: number;
  currency: CurrencyCode;
  periodStart: Date;
  periodEnd: Date;
}): ComputedLine {
  return { ...line };
}
