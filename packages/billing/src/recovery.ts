import { addInterval, assertValidInterval, type BillingInterval } from "@tierstack/shared";
import type { SubscriptionStatus } from "./state-machine";

/**
 * What a settled payment does to a lapsed subscription, and what stops a
 * renewal from replaying periods that were never served.
 *
 * Both decisions are pure so the engine's behaviour on a recovery is testable
 * without a database and without waiting a month; `applyPaymentResult` and
 * `renewSubscription` are the thin transactional wrappers around them.
 */

/**
 * The statuses a fully settled invoice brings back to ACTIVE. Everything else
 * — PAUSED, CANCELED, EXPIRED, or an ACTIVE subscription paying a second
 * invoice — is left exactly where it is.
 */
export const RECOVERABLE_STATUSES: SubscriptionStatus[] = [
  "INCOMPLETE",
  "TRIALING",
  "PAST_DUE",
  "GRACE_PERIOD",
  "UNPAID",
];

export function isRecoverableStatus(status: SubscriptionStatus): boolean {
  return RECOVERABLE_STATUSES.includes(status);
}

export interface RecoveryInput {
  /** The subscription's status at the moment the payment settled. */
  status: SubscriptionStatus;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  billingAnchorDay?: number | null;
  /** The billing interval of the price this subscription is on. */
  interval: BillingInterval;
  /** When the money actually arrived — the provider's paid-at, not "now". */
  recoveredAt: Date;
}

export interface RecoveryPlan {
  /** Whether this payment moves the subscription back to ACTIVE at all. */
  recovers: boolean;
  /**
   * Whether the payment buys a *new* period rather than finishing the one
   * already on the row. Only an UNPAID recovery rebases; when false the caller
   * must leave the period columns untouched.
   */
  rebased: boolean;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  billingAnchorDay: number | null;
}

/**
 * Decides the billing period a recovering subscription lands on.
 *
 * The distinction is whether the customer kept their access while the invoice
 * was outstanding:
 *
 * - PAST_DUE and GRACE_PERIOD are still-serving states — the grace policy
 *   decides how much access, but the subscription never stopped being live.
 *   The period they are in is the period they are being served, so a payment
 *   that lands there simply pays for it and the dates stay put.
 *
 * - UNPAID is not. Grace ran out, entitlements were revoked (see
 *   `hasServiceAccess`), and whatever time passed after that was time the
 *   customer did not have the product. Leaving the old, expired period on the
 *   row means the renewal sweep wakes up to a subscription whose period ended
 *   days or weeks ago and bills its way forward one period per pass — a daily
 *   plan that lapsed for a month generates a month of invoices for service
 *   nobody received. So a recovery from UNPAID starts a period at the payment,
 *   which is the only window the customer is actually getting.
 *
 * The rebased period can never end earlier than the one it replaces: recovery
 * always happens at or after the period it lapsed in began, so
 * `recoveredAt + interval` is always at or beyond `currentPeriodEnd`. Nothing
 * here can shorten a period a customer already paid for.
 */
export function planPaymentRecovery(input: RecoveryInput): RecoveryPlan {
  const unchanged = {
    currentPeriodStart: input.currentPeriodStart,
    currentPeriodEnd: input.currentPeriodEnd,
    billingAnchorDay: input.billingAnchorDay ?? null,
  };

  if (!isRecoverableStatus(input.status)) {
    return { recovers: false, rebased: false, ...unchanged };
  }
  if (input.status !== "UNPAID") {
    return { recovers: true, rebased: false, ...unchanged };
  }

  assertValidInterval(input.interval);

  // Re-anchor on the recovery, the same way a trial re-anchors when it
  // converts: the customer is starting a whole period here, and holding the
  // old day-of-month would bill them a full period for the stub of one left
  // between the payment and the old anchor.
  const anchorDay =
    input.interval.unit === "MONTH" || input.interval.unit === "YEAR"
      ? input.recoveredAt.getUTCDate()
      : (input.billingAnchorDay ?? null);

  return {
    recovers: true,
    rebased: true,
    currentPeriodStart: input.recoveredAt,
    currentPeriodEnd: addInterval(input.recoveredAt, input.interval, anchorDay ?? undefined),
    billingAnchorDay: anchorDay,
  };
}

/**
 * Whether a subscription's period has actually ended.
 *
 * The renewals sweep selects a batch on `currentPeriodEnd <= now` and then
 * works through it one subscription at a time, collecting payment on each as
 * it goes — so a row can be minutes stale by the time its turn comes. If
 * anything advanced that subscription in between — a recovery from UNPAID
 * rebasing the period onto the payment, a manual renew, an overlapping sweep
 * from the previous tick — renewing on the stale read opens a second period
 * over one that was already opened and charged.
 *
 * `renewSubscription` re-checks this inside the advisory lock, which is the
 * only place the answer is stable.
 */
export function isPeriodDue(currentPeriodEnd: Date, now: Date): boolean {
  return currentPeriodEnd.getTime() <= now.getTime();
}

// -- auditing the recoveries that happened before the rebase existed ---------
//
// Recoveries recorded before `planPaymentRecovery` reactivated the subscription
// onto its already-expired period, and the renewals sweep then billed the lapse
// forward one invoice per pass. These two predicates are the signature of that,
// used by `scripts/audit-unpaid-recovery.ts`. They live here, next to the
// behaviour they describe and under the test suite, rather than in the script.

export type RecoveryVerdict =
  | "AFFECTED_REPLAYING"
  | "AFFECTED_CAUGHT_UP"
  | "CLEAN_REBASED"
  | "CLEAN_IN_PERIOD"
  | "NEEDS_REVIEW";

export interface HistoricalRecovery {
  /** When the UNPAID → ACTIVE transition was recorded. */
  recoveredAt: Date;
  /** That transition's metadata; the fixed path stamps `periodRebasedOnRecovery`. */
  transitionMetadata?: Record<string, unknown> | null;
  /**
   * End of the period the subscription held at the recovery, reconstructed
   * from the invoice the payment settled. Null when it cannot be established.
   */
  periodBeforeEnd: Date | null;
  /** The subscription's period start as it stands now. */
  currentPeriodStart: Date;
}

/**
 * Whether a past recovery replayed the lapse, and whether the row still shows
 * it. Ambiguity resolves to NEEDS_REVIEW — this classifies evidence, it does
 * not guess.
 */
export function classifyHistoricalRecovery(recovery: HistoricalRecovery): RecoveryVerdict {
  if (recovery.transitionMetadata?.periodRebasedOnRecovery === true) return "CLEAN_REBASED";
  if (recovery.periodBeforeEnd === null) return "NEEDS_REVIEW";

  // Recovering inside a period that was still running left a valid period
  // behind: there was nothing for the sweep to walk forward.
  if (recovery.periodBeforeEnd.getTime() > recovery.recoveredAt.getTime()) return "CLEAN_IN_PERIOD";

  // The period on the row still opens before the recovery, so it descends from
  // the lapsed chain: never rebased, and the sweep has not billed past it yet.
  return recovery.currentPeriodStart.getTime() < recovery.recoveredAt.getTime()
    ? "AFFECTED_REPLAYING"
    : "AFFECTED_CAUGHT_UP";
}

export interface AuditedInvoice {
  createdAt: Date;
  /** The invoice's own window — never a line item's, see below. */
  billingPeriodStart: Date | null;
  /** `metadata.reason`, which marks the deliberately back-dated invoices. */
  reason?: string | null;
}

/** Invoice reasons that legitimately cover a window already under way. */
const BACKDATED_BY_DESIGN = new Set(["plan_change", "seat_change"]);

/**
 * Whether an invoice looks like a replayed period: issued after the recovery,
 * for a window that opened before it. Correct behaviour cannot produce one —
 * a period is only ever opened from the period end that precedes it, and after
 * a rebase that end is the payment itself.
 *
 * Two false positives this deliberately avoids:
 *
 * - **Usage in arrears.** A correct renewal invoice carries usage lines whose
 *   `periodStart` is the period that just closed, which is before the invoice.
 *   Only the invoice's own `billingPeriodStart` is consulted here.
 * - **Proration.** A mid-period plan or seat change bills from the change
 *   moment against the running period, so it is excluded by reason.
 *
 * `nextRecoveryAt` bounds the window when a subscription recovered more than
 * once, so no invoice is attributed to two recoveries.
 */
export function isCatchUpInvoice(
  invoice: AuditedInvoice,
  window: { recoveredAt: Date; nextRecoveryAt?: Date | null }
): boolean {
  if (invoice.createdAt.getTime() <= window.recoveredAt.getTime()) return false;
  if (window.nextRecoveryAt && invoice.createdAt.getTime() >= window.nextRecoveryAt.getTime()) {
    return false;
  }
  if (!invoice.billingPeriodStart) return false;
  if (invoice.billingPeriodStart.getTime() >= window.recoveredAt.getTime()) return false;
  if (invoice.reason && BACKDATED_BY_DESIGN.has(invoice.reason)) return false;
  return true;
}
