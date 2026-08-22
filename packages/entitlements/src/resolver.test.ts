import { describe, expect, it } from "vitest";
import { evaluateSubscriptionAccess, pickMostSpecific, resolveEntitlement } from "./resolver";
import type { EntitlementDefinition, SubscriptionContext } from "./types";

const context = (over: Partial<SubscriptionContext> = {}): SubscriptionContext => ({
  subscriptionId: "sub_1",
  status: "ACTIVE",
  planId: "plan_1",
  accessDuringGracePeriod: "FULL_ACCESS",
  currentPeriodStart: new Date("2026-08-01T00:00:00Z"),
  currentPeriodEnd: new Date("2026-09-01T00:00:00Z"),
  ...over,
});

const def = (over: Partial<EntitlementDefinition>): EntitlementDefinition => ({
  featureKey: "export_pdf",
  type: "BOOLEAN",
  limitValue: null,
  booleanValue: true,
  meterCode: null,
  source: "PLAN_FEATURE",
  expiresAt: null,
  ...over,
});

describe("subscription gating", () => {
  it("grants service while active or trialing", () => {
    expect(evaluateSubscriptionAccess(context({ status: "ACTIVE" })).allowed).toBe(true);
    expect(evaluateSubscriptionAccess(context({ status: "TRIALING" })).allowed).toBe(true);
  });

  it("refuses a subscription that has never been paid, whatever the grace policy", () => {
    for (const policy of ["FULL_ACCESS", "RESTRICTED_ACCESS", "NO_ACCESS"] as const) {
      const gate = evaluateSubscriptionAccess(
        context({ status: "INCOMPLETE", accessDuringGracePeriod: policy })
      );
      expect(gate.allowed).toBe(false);
      expect(gate.reason).toBe("PAYMENT_REQUIRED");
    }
  });

  it("applies the organization's grace policy during a grace period", () => {
    expect(
      evaluateSubscriptionAccess(context({ status: "GRACE_PERIOD", accessDuringGracePeriod: "FULL_ACCESS" }))
    ).toMatchObject({ allowed: true, restricted: false });
    expect(
      evaluateSubscriptionAccess(context({ status: "GRACE_PERIOD", accessDuringGracePeriod: "RESTRICTED_ACCESS" }))
    ).toMatchObject({ allowed: true, restricted: true });
    expect(
      evaluateSubscriptionAccess(context({ status: "GRACE_PERIOD", accessDuringGracePeriod: "NO_ACCESS" }))
    ).toMatchObject({ allowed: false });
  });

  it("refuses terminal and paused states", () => {
    for (const status of ["UNPAID", "CANCELED", "EXPIRED", "PAUSED"] as const) {
      expect(evaluateSubscriptionAccess(context({ status })).allowed).toBe(false);
    }
  });

  it("refuses when there is no subscription at all", () => {
    expect(evaluateSubscriptionAccess(context({ status: null }))).toMatchObject({
      allowed: false,
      reason: "NO_ACTIVE_SUBSCRIPTION",
    });
  });
});

describe("specificity", () => {
  it("prefers a customer override over everything else", () => {
    const winner = pickMostSpecific([
      def({ source: "PLAN_FEATURE" }),
      def({ source: "CUSTOMER_OVERRIDE" }),
      def({ source: "PLAN_ENTITLEMENT" }),
    ]);
    expect(winner?.source).toBe("CUSTOMER_OVERRIDE");
  });

  it("prefers a subscription entitlement over the plan", () => {
    const winner = pickMostSpecific([
      def({ source: "PLAN_ENTITLEMENT" }),
      def({ source: "SUBSCRIPTION_ENTITLEMENT" }),
    ]);
    expect(winner?.source).toBe("SUBSCRIPTION_ENTITLEMENT");
  });
});

describe("resolving a feature", () => {
  it("grants a boolean feature from the plan", () => {
    expect(resolveEntitlement({ featureKey: "export_pdf", definitions: [def({})], context: context() })).toEqual({
      access: true,
      remainingQuota: null,
      reason: "PLAN_FEATURE",
    });
  });

  it("denies a boolean feature that is explicitly off", () => {
    const result = resolveEntitlement({
      featureKey: "export_pdf",
      definitions: [def({ booleanValue: false })],
      context: context(),
    });
    expect(result).toMatchObject({ access: false, reason: "FEATURE_DISABLED" });
  });

  it("reports an unknown feature as not found rather than denied", () => {
    expect(
      resolveEntitlement({ featureKey: "teleport", definitions: [def({})], context: context() })
    ).toMatchObject({ access: false, reason: "FEATURE_NOT_FOUND" });
  });

  it("reports remaining quota for a usage feature", () => {
    const result = resolveEntitlement({
      featureKey: "ai_tokens",
      definitions: [def({ featureKey: "ai_tokens", type: "USAGE", limitValue: 100_000, meterCode: "AI_TOKENS" })],
      context: context(),
      usedUnits: 99_258,
    });
    expect(result).toMatchObject({ access: true, remainingQuota: 742, reason: "USAGE_QUOTA" });
  });

  it("denies once the quota is spent", () => {
    const result = resolveEntitlement({
      featureKey: "ai_tokens",
      definitions: [def({ featureKey: "ai_tokens", type: "USAGE", limitValue: 100_000 })],
      context: context(),
      usedUnits: 100_000,
    });
    expect(result).toMatchObject({ access: false, remainingQuota: 0, reason: "QUOTA_EXCEEDED" });
  });

  it("denies the next unit at exactly the boundary, but still reports the state", () => {
    const definitions = [def({ featureKey: "ai_tokens", type: "USAGE", limitValue: 100_000 })];
    // An unqualified check asks "may my user do the next thing?"
    expect(
      resolveEntitlement({ featureKey: "ai_tokens", definitions, context: context(), usedUnits: 99_999 })
    ).toMatchObject({ access: true, remainingQuota: 1 });
    // requestedUnits: 0 asks only for the current state.
    expect(
      resolveEntitlement({ featureKey: "ai_tokens", definitions, context: context(), usedUnits: 100_000, requestedUnits: 0 })
    ).toMatchObject({ access: true, remainingQuota: 0 });
  });

  it("denies a seat limit that is exactly full", () => {
    expect(
      resolveEntitlement({
        featureKey: "team_members",
        definitions: [def({ featureKey: "team_members", type: "LIMIT", limitValue: 5 })],
        context: context(),
        usedUnits: 5,
      })
    ).toMatchObject({ access: false, remainingQuota: 0, reason: "QUOTA_EXCEEDED" });
  });

  it("checks a requested amount before it is consumed", () => {
    const definitions = [def({ featureKey: "ai_tokens", type: "USAGE", limitValue: 100_000 })];
    expect(
      resolveEntitlement({ featureKey: "ai_tokens", definitions, context: context(), usedUnits: 99_000, requestedUnits: 500 })
    ).toMatchObject({ access: true });
    expect(
      resolveEntitlement({ featureKey: "ai_tokens", definitions, context: context(), usedUnits: 99_000, requestedUnits: 5_000 })
    ).toMatchObject({ access: false, reason: "QUOTA_EXCEEDED" });
  });

  it("treats a usage feature with no ceiling as billable overage, not a block", () => {
    expect(
      resolveEntitlement({
        featureKey: "ai_tokens",
        definitions: [def({ featureKey: "ai_tokens", type: "USAGE", limitValue: null })],
        context: context(),
        usedUnits: 5_000_000,
      })
    ).toMatchObject({ access: true, remainingQuota: null, reason: "UNLIMITED" });
  });

  it("reports a static limit without tracking consumption itself", () => {
    expect(
      resolveEntitlement({
        featureKey: "team_members",
        definitions: [def({ featureKey: "team_members", type: "LIMIT", limitValue: 5 })],
        context: context(),
        usedUnits: 3,
      })
    ).toMatchObject({ access: true, remainingQuota: 2, limit: 5, used: 3 });
  });

  it("denies everything once the subscription is unpaid", () => {
    expect(
      resolveEntitlement({ featureKey: "export_pdf", definitions: [def({})], context: context({ status: "UNPAID" }) })
    ).toMatchObject({ access: false, reason: "SUBSCRIPTION_INACTIVE" });
  });

  it("denies a never-paid subscription even under a full-access grace policy", () => {
    expect(
      resolveEntitlement({
        featureKey: "export_pdf",
        definitions: [def({})],
        context: context({ status: "INCOMPLETE", accessDuringGracePeriod: "FULL_ACCESS" }),
      })
    ).toMatchObject({ access: false, reason: "PAYMENT_REQUIRED" });
  });

  it("keeps boolean features but stops metered consumption when restricted", () => {
    const restricted = context({ status: "GRACE_PERIOD", accessDuringGracePeriod: "RESTRICTED_ACCESS" });

    expect(
      resolveEntitlement({ featureKey: "export_pdf", definitions: [def({})], context: restricted })
    ).toMatchObject({ access: true, restricted: true });

    expect(
      resolveEntitlement({
        featureKey: "ai_tokens",
        definitions: [def({ featureKey: "ai_tokens", type: "USAGE", limitValue: 100_000 })],
        context: restricted,
        usedUnits: 10,
      })
    ).toMatchObject({ access: false, reason: "GRACE_PERIOD_RESTRICTED", restricted: true });
  });

  it("honours a customer override even when the subscription is not in good standing", () => {
    expect(
      resolveEntitlement({
        featureKey: "export_pdf",
        definitions: [def({ source: "CUSTOMER_OVERRIDE" })],
        context: context({ status: "UNPAID" }),
      })
    ).toMatchObject({ access: true, reason: "CUSTOMER_OVERRIDE" });
  });

  it("ignores an expired entitlement and says so", () => {
    expect(
      resolveEntitlement({
        featureKey: "export_pdf",
        definitions: [def({ expiresAt: new Date("2026-01-01T00:00:00Z") })],
        context: context(),
        now: new Date("2026-08-21T00:00:00Z"),
      })
    ).toMatchObject({ access: false, reason: "ENTITLEMENT_EXPIRED" });
  });

  it("falls back to a lower-specificity definition when the override has expired", () => {
    expect(
      resolveEntitlement({
        featureKey: "export_pdf",
        definitions: [
          def({ source: "CUSTOMER_OVERRIDE", expiresAt: new Date("2026-01-01T00:00:00Z") }),
          def({ source: "PLAN_FEATURE" }),
        ],
        context: context(),
        now: new Date("2026-08-21T00:00:00Z"),
      })
    ).toMatchObject({ access: true, reason: "PLAN_FEATURE" });
  });
});
