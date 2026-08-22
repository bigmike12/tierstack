import type {
  EntitlementCheck,
  EntitlementDefinition,
  EntitlementSource,
  SubscriptionContext,
} from "./types";

/**
 * Specificity order. A customer override beats anything set on their
 * subscription, which beats the plan, which beats the plan's feature flags.
 * This is what lets support grant one customer an exception without editing a
 * plan that everyone else is on.
 */
const SPECIFICITY: Record<EntitlementSource, number> = {
  CUSTOMER_OVERRIDE: 4,
  SUBSCRIPTION_ENTITLEMENT: 3,
  PLAN_ENTITLEMENT: 2,
  PLAN_FEATURE: 1,
};

export function pickMostSpecific(
  definitions: readonly EntitlementDefinition[]
): EntitlementDefinition | null {
  let winner: EntitlementDefinition | null = null;
  for (const definition of definitions) {
    if (!winner || SPECIFICITY[definition.source] > SPECIFICITY[winner.source]) {
      winner = definition;
    }
  }
  return winner;
}

/**
 * Whether the subscription's state permits service at all, before the specific
 * feature is even considered.
 *
 * RESTRICTED_ACCESS is deliberately defined here rather than left vague: during
 * a grace period a restricted customer keeps their boolean features but cannot
 * consume any more metered usage. That draws the line where it costs the
 * developer money — a lapsed customer can keep reading, but cannot keep
 * spending someone else's inference budget.
 */
export function evaluateSubscriptionAccess(context: SubscriptionContext): {
  allowed: boolean;
  restricted: boolean;
  reason: EntitlementCheck["reason"] | null;
} {
  const { status } = context;

  if (status === null) return { allowed: false, restricted: false, reason: "NO_ACTIVE_SUBSCRIPTION" };

  switch (status) {
    case "ACTIVE":
    case "TRIALING":
      return { allowed: true, restricted: false, reason: null };

    // Never paid: there is nothing to be gracious about, so the grace policy
    // does not apply.
    case "INCOMPLETE":
      return { allowed: false, restricted: false, reason: "PAYMENT_REQUIRED" };

    case "PAST_DUE":
    case "GRACE_PERIOD": {
      if (context.accessDuringGracePeriod === "FULL_ACCESS") {
        return { allowed: true, restricted: false, reason: null };
      }
      if (context.accessDuringGracePeriod === "RESTRICTED_ACCESS") {
        return { allowed: true, restricted: true, reason: null };
      }
      return { allowed: false, restricted: false, reason: "PAYMENT_REQUIRED" };
    }

    case "PAUSED":
    case "UNPAID":
    case "CANCELED":
    case "EXPIRED":
      return { allowed: false, restricted: false, reason: "SUBSCRIPTION_INACTIVE" };
  }
}

export interface ResolveInput {
  featureKey: string;
  definitions: readonly EntitlementDefinition[];
  context: SubscriptionContext;
  /** Live consumption for the definition's meter. Never cached. */
  usedUnits?: number | null;
  /**
   * Units the caller is about to consume.
   *
   * Defaults to 1 for quantity-bounded features, because an unqualified check
   * means "may my user do the next thing?" — so a customer who has spent
   * exactly their allowance is denied. Pass 0 to ask only for the current
   * state without testing a further unit.
   */
  requestedUnits?: number;
  now?: Date;
}

/**
 * The whole entitlement decision, as a pure function.
 *
 * Everything it needs is passed in, so the rules can be tested exhaustively
 * without a database, a cache, or a subscription in a particular state.
 */
export function resolveEntitlement(input: ResolveInput): EntitlementCheck {
  const now = input.now ?? new Date();
  const gate = evaluateSubscriptionAccess(input.context);

  const candidates = input.definitions.filter(
    (definition) =>
      definition.featureKey === input.featureKey &&
      (definition.expiresAt === null || definition.expiresAt.getTime() > now.getTime())
  );

  const expiredOnly =
    candidates.length === 0 &&
    input.definitions.some((definition) => definition.featureKey === input.featureKey);

  const definition = pickMostSpecific(candidates);

  if (!definition) {
    return {
      access: false,
      remainingQuota: null,
      reason: expiredOnly ? "ENTITLEMENT_EXPIRED" : "FEATURE_NOT_FOUND",
    };
  }

  // A customer override is honoured even when the subscription is not in good
  // standing — that is what an override is for. Everything else is gated.
  const overrides = definition.source === "CUSTOMER_OVERRIDE";
  if (!gate.allowed && !overrides) {
    return { access: false, remainingQuota: null, reason: gate.reason ?? "SUBSCRIPTION_INACTIVE" };
  }

  const restricted = gate.restricted && !overrides;

  switch (definition.type) {
    case "BOOLEAN": {
      const enabled = definition.booleanValue !== false;
      return {
        access: enabled,
        remainingQuota: null,
        reason: enabled ? definition.source : "FEATURE_DISABLED",
        ...(restricted ? { restricted: true } : {}),
      };
    }

    case "UNLIMITED":
      return {
        access: true,
        remainingQuota: null,
        reason: "UNLIMITED",
        ...(restricted ? { restricted: true } : {}),
      };

    // A static ceiling the developer's own application counts against — seats,
    // projects, team members. The platform reports the number; it does not
    // track consumption of it.
    case "LIMIT": {
      const limit = definition.limitValue ?? 0;
      const used = input.usedUnits ?? 0;
      const remaining = Math.max(limit - used, 0);
      const requested = input.requestedUnits ?? 1;
      const withinLimit = used + requested <= limit;
      return {
        access: withinLimit,
        remainingQuota: remaining,
        limit,
        used,
        reason: withinLimit ? definition.source : "QUOTA_EXCEEDED",
        ...(restricted ? { restricted: true } : {}),
      };
    }

    // Metered consumption against an included allowance.
    case "USAGE": {
      const limit = definition.limitValue;
      const used = input.usedUnits ?? 0;
      const requested = input.requestedUnits ?? 1;

      // A restricted customer keeps what they have but consumes nothing more.
      if (restricted) {
        return {
          access: false,
          remainingQuota: limit === null ? null : Math.max(limit - used, 0),
          limit,
          used,
          reason: "GRACE_PERIOD_RESTRICTED",
          restricted: true,
        };
      }

      // No ceiling set means metered but uncapped — overage is billed rather
      // than blocked, so access stays open.
      if (limit === null) {
        return { access: true, remainingQuota: null, limit: null, used, reason: "UNLIMITED" };
      }

      const remaining = Math.max(limit - used, 0);
      const withinQuota = used + requested <= limit;
      return {
        access: withinQuota,
        remainingQuota: remaining,
        limit,
        used,
        reason: withinQuota ? "USAGE_QUOTA" : "QUOTA_EXCEEDED",
      };
    }
  }
}
