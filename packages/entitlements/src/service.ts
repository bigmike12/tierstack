import type { PrismaClient } from "@tierstack/database";
import { BillingError, newId } from "@tierstack/shared";
import { getPeriodUsage } from "@tierstack/usage";
import type { EntitlementCache, CachedContext } from "./cache";
import { resolveEntitlement } from "./resolver";
import type {
  EntitlementCheck,
  EntitlementDefinition,
  EntitlementType,
  GracePeriodAccess,
  SubscriptionContext,
  SubscriptionStatus,
} from "./types";

/** Statuses that still represent a live relationship worth resolving against. */
const LIVE_STATUSES: SubscriptionStatus[] = [
  "INCOMPLETE",
  "TRIALING",
  "ACTIVE",
  "PAST_DUE",
  "GRACE_PERIOD",
  "PAUSED",
  "UNPAID",
];

/**
 * Reads everything the resolver needs out of PostgreSQL: the customer's current
 * subscription, its plan's feature flags, and every Entitlement row that could
 * apply to them.
 */
export async function loadEntitlementContext(
  prisma: PrismaClient,
  organizationId: string,
  customerId: string
): Promise<CachedContext> {
  const subscription = await prisma.subscription.findFirst({
    where: { organizationId, customerId, status: { in: LIVE_STATUSES as never } },
    orderBy: [{ createdAt: "desc" }],
    include: { price: { include: { plan: true, usageMeter: true } } },
  });

  const settings = await prisma.billingSettings.findUnique({ where: { organizationId } });

  // A subscription in a grace period carries a frozen copy of the policy that
  // was in force when its payment failed, and that copy wins here.
  //
  // The alternative — reading the organization's current setting — would let a
  // merchant who tightens access next Tuesday cut off a customer who lapsed
  // last Monday under different terms. The whole reason the snapshot is written
  // is that a recovery already under way should finish on the terms it started
  // on, and access is the half of those terms the customer actually feels.
  const frozen = (subscription?.gracePolicy ?? null) as { accessDuringGracePeriod?: string } | null;
  const accessDuringGracePeriod = ((subscription?.status === "GRACE_PERIOD" &&
    frozen?.accessDuringGracePeriod) ||
    settings?.accessDuringGracePeriod ||
    "FULL_ACCESS") as GracePeriodAccess;

  const context: SubscriptionContext = {
    subscriptionId: subscription?.id ?? null,
    status: (subscription?.status as SubscriptionStatus | undefined) ?? null,
    planId: subscription?.price.planId ?? null,
    accessDuringGracePeriod,
    currentPeriodStart: subscription?.currentPeriodStart ?? null,
    currentPeriodEnd: subscription?.currentPeriodEnd ?? null,
  };

  const definitions: EntitlementDefinition[] = [];

  // 1. The plan's feature flags — the simplest way for a developer to describe
  //    what a plan includes, without creating Entitlement rows for everything.
  if (subscription?.price.plan.features) {
    definitions.push(...featuresToDefinitions(subscription.price.plan.features));
  }

  // 2. A metered price contributes a USAGE entitlement keyed by its meter, so
  //    "am I within my included tokens?" works with no extra configuration.
  if (subscription?.price.usageMeter) {
    definitions.push({
      featureKey: subscription.price.usageMeter.code,
      type: "USAGE",
      limitValue: subscription.price.includedUnits,
      booleanValue: null,
      meterCode: subscription.price.usageMeter.code,
      source: "PLAN_ENTITLEMENT",
      expiresAt: null,
    });
  }

  // 3. Explicit Entitlement rows, from least to most specific.
  const rows = await prisma.entitlement.findMany({
    where: {
      organizationId,
      OR: [
        ...(context.planId ? [{ planId: context.planId }] : []),
        ...(context.subscriptionId ? [{ subscriptionId: context.subscriptionId }] : []),
        { customerId },
      ],
    },
  });

  for (const row of rows) {
    definitions.push({
      featureKey: row.featureKey,
      type: row.type as EntitlementType,
      limitValue: row.limitValue,
      booleanValue: row.booleanValue,
      meterCode: row.meterCode,
      source: row.customerId
        ? "CUSTOMER_OVERRIDE"
        : row.subscriptionId
          ? "SUBSCRIPTION_ENTITLEMENT"
          : "PLAN_ENTITLEMENT",
      expiresAt: row.expiresAt,
    });
  }

  return { definitions, context };
}

/**
 * A plan's `features` JSON, mapped onto entitlement definitions:
 *   true / false     -> BOOLEAN
 *   a number         -> LIMIT
 *   "unlimited"      -> UNLIMITED
 *   any other string -> BOOLEAN, granted (a descriptive tier label)
 */
export function featuresToDefinitions(features: unknown): EntitlementDefinition[] {
  if (!features || typeof features !== "object" || Array.isArray(features)) return [];

  return Object.entries(features as Record<string, unknown>).map(([featureKey, value]) => {
    if (typeof value === "number") {
      return base(featureKey, "LIMIT", { limitValue: Math.trunc(value) });
    }
    if (typeof value === "string" && value.toLowerCase() === "unlimited") {
      return base(featureKey, "UNLIMITED", {});
    }
    if (typeof value === "boolean") {
      return base(featureKey, "BOOLEAN", { booleanValue: value });
    }
    return base(featureKey, "BOOLEAN", { booleanValue: true });
  });
}

function base(
  featureKey: string,
  type: EntitlementType,
  over: Partial<EntitlementDefinition>
): EntitlementDefinition {
  return {
    featureKey,
    type,
    limitValue: null,
    booleanValue: null,
    meterCode: null,
    source: "PLAN_FEATURE",
    expiresAt: null,
    ...over,
  };
}

export interface CheckEntitlementParams {
  organizationId: string;
  /** Platform customer id or the developer's own external id. */
  customerId: string;
  featureKey: string;
  /** Units about to be consumed. Defaults to 1 for quantity-bounded features. */
  requestedUnits?: number;
  now?: Date;
}

/**
 * Resolves one feature against an already-loaded context. Split out of
 * `checkEntitlement` so a caller that has already paid for
 * `loadEntitlementContext` once (`listCustomerEntitlements`, resolving every
 * feature a customer holds) never pays for it again per feature key.
 */
async function resolveFeatureCheck(
  prisma: PrismaClient,
  organizationId: string,
  customerId: string,
  loaded: CachedContext,
  featureKey: string,
  requestedUnits?: number,
  now?: Date
): Promise<EntitlementCheck> {
  // Live usage, only for the feature actually being checked, and only when the
  // winning definition is quantity-bounded.
  const relevant = loaded.definitions.filter((d) => d.featureKey === featureKey);
  const meterCode = relevant.find((d) => d.meterCode)?.meterCode ?? null;

  let usedUnits: number | null = null;
  if (meterCode && loaded.context.currentPeriodStart && loaded.context.currentPeriodEnd) {
    const meter = await prisma.usageMeter.findUnique({
      where: { organizationId_code: { organizationId, code: meterCode } },
    });
    if (meter) {
      usedUnits = await getPeriodUsage(prisma, {
        organizationId,
        customerId,
        meterId: meter.id,
        aggregation: meter.aggregation as never,
        period: { start: loaded.context.currentPeriodStart, end: loaded.context.currentPeriodEnd },
      });
    }
  }

  return resolveEntitlement({
    featureKey,
    definitions: loaded.definitions,
    context: loaded.context,
    usedUnits,
    ...(requestedUnits === undefined ? {} : { requestedUnits }),
    ...(now ? { now } : {}),
  });
}

/**
 * The endpoint a developer's application calls before letting a customer do
 * something. Definitions come from Redis when they are warm; consumption is
 * always read live from PostgreSQL.
 */
export async function checkEntitlement(
  prisma: PrismaClient,
  cache: EntitlementCache | null,
  params: CheckEntitlementParams
): Promise<EntitlementCheck & { customerId: string; featureKey: string; cached: boolean }> {
  const customer = await prisma.customer.findFirst({
    where: {
      organizationId: params.organizationId,
      deletedAt: null,
      OR: [{ id: params.customerId }, { externalId: params.customerId }],
    },
    select: { id: true },
  });
  if (!customer) throw BillingError.notFound("CUSTOMER_NOT_FOUND", "Customer");

  let cached = true;
  let loaded = cache ? await cache.read(params.organizationId, customer.id) : null;
  if (!loaded) {
    cached = false;
    loaded = await loadEntitlementContext(prisma, params.organizationId, customer.id);
    await cache?.write(params.organizationId, customer.id, loaded);
  }

  const result = await resolveFeatureCheck(
    prisma,
    params.organizationId,
    customer.id,
    loaded,
    params.featureKey,
    params.requestedUnits,
    params.now
  );

  return { ...result, customerId: customer.id, featureKey: params.featureKey, cached };
}

/** Every feature a customer currently holds, for the dashboard and the portal. */
export async function listCustomerEntitlements(
  prisma: PrismaClient,
  organizationId: string,
  customerId: string
): Promise<{ context: SubscriptionContext; features: EntitlementCheck[] }> {
  const loaded = await loadEntitlementContext(prisma, organizationId, customerId);
  const keys = [...new Set(loaded.definitions.map((d) => d.featureKey))].sort();

  const features: EntitlementCheck[] = [];
  for (const featureKey of keys) {
    const result = await resolveFeatureCheck(prisma, organizationId, customerId, loaded, featureKey, 0);
    features.push({ ...result, customerId, featureKey, cached: false } as EntitlementCheck);
  }
  return { context: loaded.context, features };
}

export async function upsertEntitlement(
  prisma: PrismaClient,
  params: {
    organizationId: string;
    featureKey: string;
    type: EntitlementType;
    limitValue?: number | null;
    booleanValue?: boolean | null;
    meterCode?: string | null;
    planId?: string | null;
    customerId?: string | null;
    subscriptionId?: string | null;
    expiresAt?: Date | null;
  }
) {
  const targets = [params.planId, params.customerId, params.subscriptionId].filter(Boolean);
  if (targets.length !== 1) {
    throw new BillingError(
      "VALIDATION_ERROR",
      "An entitlement attaches to exactly one of planId, customerId or subscriptionId."
    );
  }
  if (params.type === "USAGE" && !params.meterCode) {
    throw new BillingError("VALIDATION_ERROR", "A USAGE entitlement needs a meterCode to count against.");
  }

  const existing = await prisma.entitlement.findFirst({
    where: {
      organizationId: params.organizationId,
      featureKey: params.featureKey,
      planId: params.planId ?? null,
      customerId: params.customerId ?? null,
      subscriptionId: params.subscriptionId ?? null,
    },
  });

  const data = {
    type: params.type,
    limitValue: params.limitValue ?? null,
    booleanValue: params.booleanValue ?? null,
    meterCode: params.meterCode ?? null,
    expiresAt: params.expiresAt ?? null,
  };

  return existing
    ? prisma.entitlement.update({ where: { id: existing.id }, data })
    : prisma.entitlement.create({
        data: {
          id: newId("entitlement"),
          organizationId: params.organizationId,
          featureKey: params.featureKey,
          planId: params.planId ?? null,
          customerId: params.customerId ?? null,
          subscriptionId: params.subscriptionId ?? null,
          ...data,
        },
      });
}
