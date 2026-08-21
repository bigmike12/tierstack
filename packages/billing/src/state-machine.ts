import { BillingError } from "@billing-platform/shared";

export type SubscriptionStatus =
  | "TRIALING"
  | "ACTIVE"
  | "PAST_DUE"
  | "GRACE_PERIOD"
  | "PAUSED"
  | "UNPAID"
  | "CANCELED"
  | "EXPIRED";

/**
 * The complete set of legal moves. Status is never assigned directly anywhere
 * in the codebase — every change goes through `transition`, which rejects a
 * move that is not in this table and records why the move happened.
 */
const TRANSITIONS: Record<SubscriptionStatus, SubscriptionStatus[]> = {
  TRIALING: ["ACTIVE", "PAST_DUE", "PAUSED", "CANCELED", "EXPIRED"],
  ACTIVE: ["ACTIVE", "PAST_DUE", "PAUSED", "CANCELED", "EXPIRED"],
  PAST_DUE: ["GRACE_PERIOD", "ACTIVE", "UNPAID", "PAUSED", "CANCELED"],
  GRACE_PERIOD: ["ACTIVE", "UNPAID", "PAUSED", "CANCELED"],
  PAUSED: ["ACTIVE", "CANCELED", "EXPIRED"],
  UNPAID: ["ACTIVE", "CANCELED", "EXPIRED"],
  CANCELED: [],
  EXPIRED: [],
};

/** States in which the customer is holding a live subscription. */
export const LIVE_STATUSES: SubscriptionStatus[] = [
  "TRIALING",
  "ACTIVE",
  "PAST_DUE",
  "GRACE_PERIOD",
  "PAUSED",
];

export const TERMINAL_STATUSES: SubscriptionStatus[] = ["CANCELED", "EXPIRED"];

export function isTerminal(status: SubscriptionStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

export function canTransition(from: SubscriptionStatus, to: SubscriptionStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function allowedTransitions(from: SubscriptionStatus): SubscriptionStatus[] {
  return [...TRANSITIONS[from]];
}

export interface TransitionResult {
  from: SubscriptionStatus;
  to: SubscriptionStatus;
  reason: string;
}

/**
 * Validate a status change. Callers persist both the new status and the
 * returned record, so the subscription's history is reconstructible.
 */
export function transition(
  from: SubscriptionStatus,
  to: SubscriptionStatus,
  reason: string
): TransitionResult {
  if (!canTransition(from, to)) {
    throw new BillingError(
      "INVALID_STATE_TRANSITION",
      `A subscription cannot move from ${from} to ${to}.`,
      { from, to, allowed: TRANSITIONS[from] }
    );
  }
  return { from, to, reason };
}

/**
 * Whether an entitlement check should currently pass, given the subscription
 * status and the organization's configured grace-period access policy.
 */
export function hasServiceAccess(
  status: SubscriptionStatus,
  accessDuringGracePeriod: "FULL_ACCESS" | "RESTRICTED_ACCESS" | "NO_ACCESS"
): { access: boolean; restricted: boolean } {
  switch (status) {
    case "TRIALING":
    case "ACTIVE":
      return { access: true, restricted: false };
    case "PAST_DUE":
    case "GRACE_PERIOD":
      if (accessDuringGracePeriod === "FULL_ACCESS") return { access: true, restricted: false };
      if (accessDuringGracePeriod === "RESTRICTED_ACCESS") return { access: true, restricted: true };
      return { access: false, restricted: false };
    case "PAUSED":
    case "UNPAID":
    case "CANCELED":
    case "EXPIRED":
      return { access: false, restricted: false };
  }
}
