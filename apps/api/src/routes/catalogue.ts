import type { PrismaClient } from "@tierstack/database";
import { intervalFromRequest, notifyEntitlementChange } from "@tierstack/billing";
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
  trialDays: z.number().int().min(0).max(365).nullable().optional(),
  active: z.boolean().optional(),
  metadata: z.record(z.unknown()).optional(),
});

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
      where: { organizationId, OR: [{ id: planId }, { code: planId }] },
      include: { prices: true },
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
      where: { organizationId, OR: [{ id: planId }, { code: planId }] },
    });
    if (!plan) throw BillingError.notFound("PLAN_NOT_FOUND", "Plan");

    const updated = await prisma.plan.update({ where: { id: plan.id }, data: body as never });
    // Feature flags live on the plan, so this can change what every subscriber
    // on it is entitled to.
    await notifyEntitlementChange(organizationId, null);
    return success(updated, request.requestId);
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
      where: { organizationId, OR: [{ id: body.planId }, { code: body.planId }] },
    });
    if (!plan) throw BillingError.notFound("PLAN_NOT_FOUND", "Plan");

    const interval = intervalFromRequest(body.interval, body.intervalDays);

    let usageMeterId: string | null = null;
    if (body.usageMeterCode) {
      const meter = await prisma.usageMeter.findUnique({
        where: { organizationId_code: { organizationId, code: body.usageMeterCode } },
      });
      if (!meter) {
        throw new BillingError("INVALID_REQUEST", `No usage meter with code "${body.usageMeterCode}".`);
      }
      usageMeterId = meter.id;
    }

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
        if (!meter) {
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

    const interval = body.interval ? intervalFromRequest(body.interval, body.intervalDays) : undefined;
    const { interval: _interval, intervalDays: _intervalDays, usageMeterCode: _usageMeterCode, ...data } = body;
    const updated = await prisma.price.update({
      where: { id: price.id },
      data: {
        ...data,
        ...(body.currency ? { currency: assertCurrency(body.currency) } : {}),
        ...(interval ?? {}),
        ...(usageMeterId === undefined ? {} : { usageMeterId }),
      } as never,
    });

    await notifyEntitlementChange(organizationId, null);
    await recordAudit(prisma, {
      organizationId,
      actorType: actor.kind,
      userId: actor.kind === "USER" ? actor.userId : null,
      action: "price.updated",
      resource: "price",
      resourceId: price.id,
      metadata: { code: price.code, changed: Object.keys(body) },
      ipAddress: request.ip,
    });
    return success(updated, request.requestId);
  });
}
