import { addDays } from "@billing-platform/shared";

export type GracePeriodAccess = "FULL_ACCESS" | "RESTRICTED_ACCESS" | "NO_ACCESS";
export type DunningFailureAction = "MARK_UNPAID" | "CANCEL" | "PAUSE";

/** The organization's dunning policy, exactly as the developer configured it. */
export interface DunningPolicy {
  gracePeriodDays: number;
  maxRetryAttempts: number;
  retryIntervals: number[];
  accessDuringGracePeriod: GracePeriodAccess;
  failureAction: DunningFailureAction;
  invoiceDueDays: number;
  /** Hours an unpaid first invoice keeps its subscription alive. 0 disables. */
  incompleteExpiryHours: number;
}

export interface GracePeriodWindow {
  gracePeriodStart: Date;
  gracePeriodEnd: Date;
  /**
   * A frozen copy of the policy in force at the moment of failure. Storing it
   * on the subscription means a later settings change cannot retroactively
   * shorten or lengthen a grace period that is already running.
   */
  snapshot: DunningPolicy;
}

/**
 * There is no default grace period baked into the engine. The number comes from
 * the organization's BillingSettings, whatever the developer chose — 1 day, 30
 * days, or zero.
 */
export function openGracePeriod(policy: DunningPolicy, failedAt = new Date()): GracePeriodWindow {
  return {
    gracePeriodStart: failedAt,
    gracePeriodEnd: addDays(failedAt, policy.gracePeriodDays),
    snapshot: { ...policy, retryIntervals: [...policy.retryIntervals] },
  };
}

export function isGracePeriodExpired(gracePeriodEnd: Date | null, now = new Date()): boolean {
  return gracePeriodEnd !== null && gracePeriodEnd.getTime() <= now.getTime();
}

/**
 * When the next retry should run, from the developer's retry schedule. The
 * schedule is expressed in days after the first failure; attempts beyond the
 * end of the schedule reuse its final interval.
 */
export function nextRetryAt(
  policy: DunningPolicy,
  firstFailureAt: Date,
  attemptsSoFar: number
): Date | null {
  if (attemptsSoFar >= policy.maxRetryAttempts) return null;
  const schedule = policy.retryIntervals.length > 0 ? policy.retryIntervals : [0];
  const offsetDays = schedule[attemptsSoFar] ?? schedule[schedule.length - 1] ?? 0;
  return addDays(firstFailureAt, offsetDays);
}

/** The terminal status implied by the developer's configured failure action. */
export function statusForFailureAction(
  action: DunningFailureAction
): "UNPAID" | "CANCELED" | "PAUSED" {
  switch (action) {
    case "MARK_UNPAID":
      return "UNPAID";
    case "CANCEL":
      return "CANCELED";
    case "PAUSE":
      return "PAUSED";
  }
}
