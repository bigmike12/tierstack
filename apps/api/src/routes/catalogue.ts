import type { PrismaClient } from "@tierstack/database";
import { intervalFromRequest, notifyEntitlementChange, updatePrice } from "@tierstack/billing";
import { BillingError, assertCurrency, newId, success } from "@tierstack/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireActor, requireOrganization, requireRole } from "../context";
import { recordAudit } from "../lib/audit";

const planSchema = z.object({
  code: z.string().min(1).max(64).regex(/^[a-z0-9_-]+$/i, "Use letters, numbers, dashes or underscores."),
  name: z.string().min(1).max(120),
  description: z.string().max(1000).optional(),
  features: z.record(z.union([z.boolean(), z.number(), z.string()])).default({}),
  metadata: z.record(z.unknown()).default({}),
  active: z.boolean().default(true),
});

const priceSchema = z
  .object({
    planId: z.string().min(1),
    code: z.string().min(1).max(64),
    nickname: z.string().max(120).optional(),
    model: z.enum(["FLAT_RECURRING", "PER_SEAT", "USAGE_METERED", "HYBRID"]).default("FLAT_RECURRING"),
    currency: z.string().length(3),
    /** Integer minor units. ₦10,000 is 1000000. */
    unitAmount: z.number().int().min(0).optional(),
    interval: z
      .enum([
        "DAILY",
        "WEEKLY",
        "BI_WEEKLY",
        "MONTHLY",
        "BI_MONTHLY",
        "QUARTERLY",
        "SEMI_ANNUALLY",
        "ANNUALLY",
        "CUSTOM_DAYS",
      ])
      .default("MONTHLY"),
    intervalDays: z.number().int().min(1).max(3650).optional(),
    usageMeterCode: z.string().optional(),
    usageUnitAmount: z.number().int().min(0).optional(),
    usageUnitSize: z.number().int().min(1).optional(),
    includedUnits: z.number().int().min(0).optional(),
    usageMaxAmount: z.number().int().min(0).optional(),
    trialDays: z.number().int().min(0).max(365).optional(),
    active: z.boolean().default(true),
    metadata: z.record(z.unknown()).default({}),
  })
  .refine(
    (value) => value.model === "USAGE_METERED" || value.unitAmount !== undefined,
    { message: "unitAmount is required for every model except USAGE_METERED.", path: ["unitAmount"] }
  );

// Price codes are deliberately not editable: they are public identifiers used
// by integrations. Everything that describes how the price is billed can be
// changed through this schema instead.
const priceUpdateSchema = z.object({
  nickname: z.string().max(120).nullable().optional(),
  model: z.enum(["FLAT_RECURRING", "PER_SEAT", "USAGE_METERED", "HYBRID"]).optional(),
  currency: z.string().length(3).optional(),
  unitAmount: z.number().int().min(0).nullable().optional(),
  interval: z
    .enum([
      "DAILY",
      "WEEKLY",
      "BI_WEEKLY",
      "MONTHLY",
      "BI_MONTHLY",
      "QUARTERLY",
      "SEMI_ANNUALLY",
      "ANNUALLY",
      "CUSTOM_DAYS",
    ])
    .optional(),
  intervalDays: z.number().int().min(1).max(3650).optional(),
  // Null explicitly detaches a meter when changing away from metered pricing.
  usageMeterCode: z.string().min(1).nullable().optional(),
  usageUnitAmount: z.number().int().min(0).nullable().optional(),
  usageUnitSize: z.number().int().min(1).nullable().optional(),
  includedUnits: z.number().int().min(0).nullable().optional(),
  usageMaxAmount: z.number().int().min(0).nullable().optional(),
  trialDays: z.number().int().min(0).max(365).nullable().optional(),
  active: z.boolean().optional(),
  metadata: z.record(z.unknown()).optional(),
});

/**
 * A ceiling on a charge that does not exist is a setting nobody can act on: it
 * would sit on the price looking like a protection and never fire. Rejecting it
 * here means the only way to see `usageMaxAmount` on a price is for it to mean
 * something.
 */
function assertCapIsBillable(model: string, cap: number | null | undefined): void {
  if (cap === null || cap === undefined) return;
  if (model !== "USAGE_METERED" && model !== "HYBRID") {
    throw new BillingError(
      "INVALID_REQUEST",
      `usageMaxAmount caps a metered charge, but this price uses the ${model} model, which has none. ` +
        "Remove the cap, or use USAGE_METERED or HYBRID."
    );
  }
}

export function registerCatalogueRoutes(app: FastifyInstance, prisma: PrismaClient): void {
  // -- Plans -----------------------------------------------------------------

  app.post("/v1/plans", async (request, reply) => {
    const organizationId = requireOrganization(request);
    requireRole(request, "ADMIN");
    const actor = requireActor(request);
    const body = planSchema.parse(request.body);

    const existing = await prisma.plan.findUnique({
      where: { organizationId_code: { organizationId, code: body.code } },
    });
    if (existing) {
      throw new BillingError("PLAN_CODE_ALREADY_EXISTS", `A plan with code "${body.code}" already exists.`);
    }

    const plan = await prisma.plan.create({
      data: {
        id: newId("plan"),
        organizationId,
        code: body.code,
        name: body.name,
        description: body.description ?? null,
        features: body.features as never,
        metadata: body.metadata as never,
        active: body.active,
      },
    });

    await notifyEntitlementChange(organizationId, null);
    await recordAudit(prisma, {
      organizationId,
      actorType: actor.kind,
      userId: actor.kind === "USER" ? actor.userId : null,
      action: "plan.created",
      resource: "plan",
      resourceId: plan.id,
      metadata: { code: plan.code },
      ipAddress: request.ip,
    });

    return reply.status(201).send(success(plan, request.requestId));
  });

  app.get("/v1/plans", async (request) => {
    const organizationId = requireOrganization(request);
    const query = request.query as { active?: string };
    const plans = await prisma.plan.findMany({
      where: {
        organizationId,
        deletedAt: null,
        ...(query.active === undefined ? {} : { active: query.active !== "false" }),
      },
      include: { prices: { where: { active: true } } },
      orderBy: { createdAt: "asc" },
    });
    return success(plans, request.requestId);
  });

  app.get("/v1/plans/:planId", async (request) => {
    const organizationId = requireOrganization(request);
    const { planId } = request.params as { planId: string };
    const plan = await prisma.plan.findFirst({
      where: { organizationId, deletedAt: null, OR: [{ id: planId }, { code: planId }] },
      // Archived versions are included deliberately: the plan page shows the
      // lineage. Ordering is fixed so publishing a new version does not
      // reshuffle the table under you.
      include: { prices: { orderBy: { createdAt: "asc" } } },
    });
    if (!plan) throw BillingError.notFound("PLAN_NOT_FOUND", "Plan");
    return success(plan, request.requestId);
  });

  app.patch("/v1/plans/:planId", async (request) => {
    const organizationId = requireOrganization(request);
    requireRole(request, "ADMIN");
    const { planId } = request.params as { planId: string };
    const body = planSchema.partial().omit({ code: true }).parse(request.body);

    const plan = await prisma.plan.findFirst({
      where: { organizationId, deletedAt: null, OR: [{ id: planId }, { code: planId }] },
    });
    if (!plan) throw BillingError.notFound("PLAN_NOT_FOUND", "Plan");

    const updated = await prisma.plan.update({ where: { id: plan.id }, data: body as never });
    // Feature flags live on the plan, so this can change what every subscriber
    // on it is entitled to.
    await notifyEntitlementChange(organizationId, null);
    return success(updated, request.requestId);
  });

  /**
   * Never a hard delete — a plan's prices are permanently bound to real
   * invoices and payment attempts, and the database itself refuses to drop a
   * row still referenced by one. This is the same shape as customer deletion:
   * blocked while anyone is still a live subscriber, otherwise the plan (and
   * every one of its prices) is deactivated and hidden for good. Archiving
   * first stops new signups so existing subscribers can run out naturally;
   * once none are left, the same action that would have archived it deletes
   * it instead.
   */
  app.delete("/v1/plans/:planId", async (request) => {
    const organizationId = requireOrganization(request);
    requireRole(request, "ADMIN");
    const actor = requireActor(request);
    const { planId } = request.params as { planId: string };

    const plan = await prisma.plan.findFirst({
      where: { organizationId, deletedAt: null, OR: [{ id: planId }, { code: planId }] },
      include: { prices: { select: { id: true } } },
    });
    if (!plan) throw BillingError.notFound("PLAN_NOT_FOUND", "Plan");

    const priceIds = plan.prices.map((price) => price.id);
    const liveSubscribers = priceIds.length
      ? await prisma.subscription.count({
          where: { priceId: { in: priceIds }, status: { in: ["TRIALING", "ACTIVE", "PAST_DUE", "GRACE_PERIOD"] } },
        })
      : 0;
    if (liveSubscribers > 0) {
      throw new BillingError(
        "INVALID_REQUEST",
        `${liveSubscribers} subscription${liveSubscribers === 1 ? " is" : "s are"} still active on this plan. ` +
          "Archive it to stop new signups, then delete it once every subscriber has moved on."
      );
    }

    await prisma.$transaction([
      prisma.price.updateMany({ where: { planId: plan.id }, data: { active: false } }),
      prisma.plan.update({ where: { id: plan.id }, data: { active: false, deletedAt: new Date() } }),
    ]);

    await recordAudit(prisma, {
      organizationId,
      actorType: actor.kind,
      userId: actor.kind === "USER" ? actor.userId : null,
      action: "plan.deleted",
      resource: "plan",
      resourceId: plan.id,
      metadata: { code: plan.code },
      ipAddress: request.ip,
    });

    return success({ deleted: true }, request.requestId);
  });

  // -- Prices ----------------------------------------------------------------

  /**
   * A Plan is the product; a Price is one way to buy it. Several prices per
   * plan is how multi-currency and multi-interval work without duplicating the
   * plan itself.
   */
  app.post("/v1/prices", async (request, reply) => {
    const organizationId = requireOrganization(request);
    requireRole(request, "ADMIN");
    const actor = requireActor(request);
    const body = priceSchema.parse(request.body);
    const currency = assertCurrency(body.currency);

    const plan = await prisma.plan.findFirst({
      where: { organizationId, deletedAt: null, OR: [{ id: body.planId }, { code: body.planId }] },
    });
    if (!plan) throw BillingError.notFound("PLAN_NOT_FOUND", "Plan");

    const interval = intervalFromRequest(body.interval, body.intervalDays);

    let usageMeterId: string | null = null;
    if (body.usageMeterCode) {
      const meter = await prisma.usageMeter.findUnique({
        where: { organizationId_code: { organizationId, code: body.usageMeterCode } },
      });
      if (!meter || meter.deletedAt) {
        throw new BillingError("INVALID_REQUEST", `No usage meter with code "${body.usageMeterCode}".`);
      }
      usageMeterId = meter.id;
    }

    assertCapIsBillable(body.model, body.usageMaxAmount ?? null);

    const price = await prisma.price.create({
      data: {
        id: newId("price"),
        organizationId,
        planId: plan.id,
        code: body.code,
        nickname: body.nickname ?? null,
        model: body.model,
        currency,
        unitAmount: body.unitAmount ?? null,
        intervalUnit: interval.intervalUnit,
        intervalCount: interval.intervalCount,
        usageMeterId,
        usageUnitAmount: body.usageUnitAmount ?? null,
        usageUnitSize: body.usageUnitSize ?? 1,
        includedUnits: body.includedUnits ?? null,
        usageMaxAmount: body.usageMaxAmount ?? null,
        trialDays: body.trialDays ?? null,
        active: body.active,
        metadata: body.metadata as never,
      },
    });

    await notifyEntitlementChange(organizationId, null);
    await recordAudit(prisma, {
      organizationId,
      actorType: actor.kind,
      userId: actor.kind === "USER" ? actor.userId : null,
      action: "price.created",
      resource: "price",
      resourceId: price.id,
      metadata: { code: price.code, currency, model: price.model },
      ipAddress: request.ip,
    });

    return reply.status(201).send(success(price, request.requestId));
  });

  app.get("/v1/prices", async (request) => {
    const organizationId = requireOrganization(request);
    const query = request.query as { planId?: string; currency?: string; active?: string };
    const prices = await prisma.price.findMany({
      where: {
        organizationId,
        ...(query.planId ? { planId: query.planId } : {}),
        ...(query.currency ? { currency: assertCurrency(query.currency) } : {}),
        ...(query.active === undefined ? {} : { active: query.active !== "false" }),
      },
      include: { plan: { select: { id: true, code: true, name: true } } },
      orderBy: { createdAt: "asc" },
    });
    return success(prices, request.requestId);
  });

  app.get("/v1/prices/:priceId", async (request) => {
    const organizationId = requireOrganization(request);
    const { priceId } = request.params as { priceId: string };
    const price = await prisma.price.findFirst({
      where: { organizationId, OR: [{ id: priceId }, { code: priceId }] },
      include: { plan: true },
    });
    if (!price) throw BillingError.notFound("PRICE_NOT_FOUND", "Price");
    return success(price, request.requestId);
  });

  /**
   * Edit a price.
   *
   * Presentation, the active flag and the trial length always save in place, and
   * so does an amount, an interval or a metering change — while nobody is bound
   * to the row. Once there are live subscriptions the same request publishes a
   * new version and archives this one, so the people who already signed up keep
   * paying what they agreed to until an explicit plan change moves them.
   */
  app.patch("/v1/prices/:priceId", async (request) => {
    const organizationId = requireOrganization(request);
    requireRole(request, "ADMIN");
    const actor = requireActor(request);
    const { priceId } = request.params as { priceId: string };
    const body = priceUpdateSchema.parse(request.body);

    const price = await prisma.price.findFirst({
      where: { organizationId, OR: [{ id: priceId }, { code: priceId }] },
    });
    if (!price) throw BillingError.notFound("PRICE_NOT_FOUND", "Price");

    const model = body.model ?? price.model;
    const unitAmount = body.unitAmount === undefined ? price.unitAmount : body.unitAmount;
    const usageUnitAmount =
      body.usageUnitAmount === undefined ? price.usageUnitAmount : body.usageUnitAmount;
    const usageMeterCode = body.usageMeterCode;

    if (model !== "USAGE_METERED" && unitAmount === null) {
      throw new BillingError("INVALID_REQUEST", "This pricing model needs a recurring amount.");
    }

    let usageMeterId: string | null | undefined;
    if (usageMeterCode !== undefined) {
      if (usageMeterCode === null) {
        usageMeterId = null;
      } else {
        const meter = await prisma.usageMeter.findUnique({
          where: { organizationId_code: { organizationId, code: usageMeterCode } },
        });
        if (!meter || meter.deletedAt) {
          throw new BillingError("INVALID_REQUEST", `No usage meter with code "${usageMeterCode}".`);
        }
        usageMeterId = meter.id;
      }
    }
    const effectiveUsageMeterId = usageMeterId === undefined ? price.usageMeterId : usageMeterId;

    if ((model === "USAGE_METERED" || model === "HYBRID") && !effectiveUsageMeterId) {
      throw new BillingError("INVALID_REQUEST", "A metered price must name the meter it bills against.");
    }
    if ((model === "USAGE_METERED" || model === "HYBRID") && usageUnitAmount === null) {
      throw new BillingError("INVALID_REQUEST", "A metered price needs a rate per block.");
    }
    assertCapIsBillable(
      model,
      body.usageMaxAmount === undefined ? price.usageMaxAmount : body.usageMaxAmount
    );

    const interval = body.interval ? intervalFromRequest(body.interval, body.intervalDays) : undefined;

    // The write itself decides, from the data, whether this is an in-place edit
    // or a new version — see updatePrice. Making that call here would mean the
    // rule protecting existing subscribers lived in one of several callers
    // rather than in the one place that owns the price row.
    const result = await updatePrice(prisma, {
      organizationId,
      priceId: price.id,
      nickname: body.nickname,
      active: body.active,
      trialDays: body.trialDays,
      metadata: body.metadata,
      model: body.model,
      currency: body.currency ? assertCurrency(body.currency) : undefined,
      unitAmount: body.unitAmount,
      intervalUnit: interval?.intervalUnit,
      intervalCount: interval?.intervalCount,
      usageMeterId,
      usageUnitAmount: body.usageUnitAmount,
      usageUnitSize: body.usageUnitSize,
      includedUnits: body.includedUnits,
      usageMaxAmount: body.usageMaxAmount,
    });

    await notifyEntitlementChange(organizationId, null);
    await recordAudit(prisma, {
      organizationId,
      actorType: actor.kind,
      userId: actor.kind === "USER" ? actor.userId : null,
      action: result.supersededPriceId ? "price.superseded" : "price.updated",
      resource: "price",
      resourceId: result.price.id,
      metadata: {
        code: result.price.code,
        changed: result.changed,
        supersededPriceId: result.supersededPriceId,
        subscribersRetained: result.subscribersRetained,
      },
      ipAddress: request.ip,
    });

    return success(
      {
        ...result.price,
        supersededPriceId: result.supersededPriceId,
        changed: result.changed,
        subscribersRetained: result.subscribersRetained,
      },
      request.requestId
    );
  });
}
