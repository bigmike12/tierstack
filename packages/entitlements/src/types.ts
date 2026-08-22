export type EntitlementType = "BOOLEAN" | "LIMIT" | "UNLIMITED" | "USAGE";

export type GracePeriodAccess = "FULL_ACCESS" | "RESTRICTED_ACCESS" | "NO_ACCESS";

export type SubscriptionStatus =
  | "INCOMPLETE"
  | "TRIALING"
  | "ACTIVE"
  | "PAST_DUE"
  | "GRACE_PERIOD"
  | "PAUSED"
  | "UNPAID"
  | "CANCELED"
  | "EXPIRED";

/** Where a resolved entitlement came from. Most specific source wins. */
export type EntitlementSource =
  | "CUSTOMER_OVERRIDE"
  | "SUBSCRIPTION_ENTITLEMENT"
  | "PLAN_ENTITLEMENT"
  | "PLAN_FEATURE";

/** Why the engine answered the way it did. Stable — the SDK switches on these. */
export type EntitlementReason =
  | "CUSTOMER_OVERRIDE"
  | "SUBSCRIPTION_ENTITLEMENT"
  | "PLAN_ENTITLEMENT"
  | "PLAN_FEATURE"
  | "USAGE_QUOTA"
  | "UNLIMITED"
  | "QUOTA_EXCEEDED"
  | "FEATURE_DISABLED"
  | "FEATURE_NOT_FOUND"
  | "NO_ACTIVE_SUBSCRIPTION"
  | "SUBSCRIPTION_INACTIVE"
  | "PAYMENT_REQUIRED"
  | "GRACE_PERIOD_RESTRICTED"
  | "ENTITLEMENT_EXPIRED";

/** One resolved entitlement definition, before live usage is applied. */
export interface EntitlementDefinition {
  featureKey: string;
  type: EntitlementType;
  /** Numeric ceiling for LIMIT and USAGE. Null for BOOLEAN and UNLIMITED. */
  limitValue: number | null;
  /** Value for BOOLEAN entitlements. */
  booleanValue: boolean | null;
  /** Meter this feature consumes, for USAGE entitlements. */
  meterCode: string | null;
  source: EntitlementSource;
  expiresAt: Date | null;
}

export interface SubscriptionContext {
  subscriptionId: string | null;
  status: SubscriptionStatus | null;
  planId: string | null;
  /** The organization's configured behaviour during a grace period. */
  accessDuringGracePeriod: GracePeriodAccess;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
}

export interface EntitlementCheck {
  access: boolean;
  /** Units left. Null when the feature is not quantity-bounded. */
  remainingQuota: number | null;
  reason: EntitlementReason;
  /** Present for LIMIT and USAGE features. */
  limit?: number | null;
  used?: number | null;
  /** True when service is degraded rather than fully granted. */
  restricted?: boolean;
}
