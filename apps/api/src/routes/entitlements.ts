import { lookupCustomer } from "@tierbase/billing";
import type { PrismaClient } from "@tierbase/database";
import {
  EntitlementCache,
  checkEntitlement,
  listCustomerEntitlements,
  upsertEntitlement,
} from "@tierbase/entitlements";
import { BillingError, success } from "@tierbase/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireOrganization, requireRole, requireSecretKeyOrUser } from "../context";
import type { RedisClient } from "../lib/redis";

const checkSchema = z.object({
  customerId: z.string().min(1),
  featureKey: z.string().min(1).max(120),
  /** Units about to be consumed. Defaults to 1 for quantity-bounded features. */
  requestedUnits: z.number().int().min(0).optional(),
});

const upsertSchema = z
  .object({
    featureKey: z.string().min(1).max(120),
    type: z.enum(["BOOLEAN", "LIMIT", "UNLIMITED", "USAGE"]),
    limitValue: z.number().int().min(0).nullable().optional(),
    booleanValue: z.boolean().nullable().optional(),
    meterCode: z.string().max(64).nullable().optional(),
    planId: z.string().nullable().optional(),
    customerId: z.string().nullable().optional(),
    subscriptionId: z.string().nullable().optional(),
    expiresAt: z.string().datetime().nullable().optional(),
  })
  .refine(
    (value) => [value.planId, value.customerId, value.subscriptionId].filter(Boolean).length === 1,
    { message: "Attach the entitlement to exactly one of planId, customerId or subscriptionId." }
  );

export function registerEntitlementRoutes(
  app: FastifyInstance,
  prisma: PrismaClient,
  redis: RedisClient
): void {
  const cache = new EntitlementCache(redis);

  /**
   * The call a developer's application makes before letting a customer do
   * something. Definitions come from Redis when warm; consumption is always
   * read live from PostgreSQL, because a stale quota becomes a wrong invoice.
   */
  app.post("/v1/entitlements/check", async (request) => {
    const organizationId = requireOrganization(request);
    const body = checkSchema.parse(request.body);

    const result = await checkEntitlement(prisma, cache, {
      organizationId,
      customerId: body.customerId,
      featureKey: body.featureKey,
      ...(body.requestedUnits === undefined ? {} : { requestedUnits: body.requestedUnits }),
    });

    return success(
      {
        access: result.access,
        remainingQuota: result.remainingQuota,
        reason: result.reason,
        ...(result.limit === undefined ? {} : { limit: result.limit }),
        ...(result.used === undefined ? {} : { used: result.used }),
        ...(result.restricted ? { restricted: true } : {}),
      },
      request.requestId
    );
  });

  /** Batched checks, so a page render costs one round trip instead of six. */
  app.post("/v1/entitlements/check/batch", async (request) => {
    const organizationId = requireOrganization(request);
    const body = z
      .object({
        customerId: z.string().min(1),
        featureKeys: z.array(z.string().min(1)).min(1).max(50),
      })
      .parse(request.body);

    const results: Record<string, unknown> = {};
    for (const featureKey of body.featureKeys) {
      const result = await checkEntitlement(prisma, cache, {
        organizationId,
        customerId: body.customerId,
        featureKey,
        requestedUnits: 0,
      });
      results[featureKey] = {
        access: result.access,
        remainingQuota: result.remainingQuota,
        reason: result.reason,
      };
    }
    return success(results, request.requestId);
  });

  /** Everything a customer currently holds — used by the dashboard and portal. */
  app.get("/v1/entitlements", async (request) => {
    const organizationId = requireOrganization(request);
    const query = request.query as { customerId?: string; planId?: string };

    if (query.customerId) {
      const customer = await lookupCustomer(prisma, organizationId, query.customerId);
      const resolved = await listCustomerEntitlements(prisma, organizationId, customer.id);
      return success(
        { customerId: customer.id, externalId: customer.externalId, ...resolved },
        request.requestId
      );
    }

    const rows = await prisma.entitlement.findMany({
      where: { organizationId, ...(query.planId ? { planId: query.planId } : {}) },
      orderBy: [{ featureKey: "asc" }],
      include: {
        plan: { select: { id: true, code: true, name: true } },
        customer: { select: { id: true, externalId: true, email: true } },
      },
    });
    return success(rows, request.requestId);
  });

  app.post("/v1/entitlements", async (request, reply) => {
    const organizationId = requireOrganization(request);
    requireSecretKeyOrUser(request);
    requireRole(request, "ADMIN");
    const body = upsertSchema.parse(request.body);

    // Resolve the developer's own customer id if that is what was sent.
    let customerId = body.customerId ?? null;
    if (customerId) {
      customerId = (await lookupCustomer(prisma, organizationId, customerId)).id;
    }

    if (body.planId) {
      const plan = await prisma.plan.findFirst({
        where: { organizationId, OR: [{ id: body.planId }, { code: body.planId }] },
        select: { id: true },
      });
      if (!plan) throw BillingError.notFound("PLAN_NOT_FOUND", "Plan");
      body.planId = plan.id;
    }

    const entitlement = await upsertEntitlement(prisma, {
      organizationId,
      featureKey: body.featureKey,
      type: body.type,
      limitValue: body.limitValue ?? null,
      booleanValue: body.booleanValue ?? null,
      meterCode: body.meterCode ?? null,
      planId: body.planId ?? null,
      customerId,
      subscriptionId: body.subscriptionId ?? null,
      expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
    });

    // A plan-level change affects every customer on it; a customer override
    // affects one. Invalidate at the right blast radius.
    if (customerId) {
      await cache.invalidateCustomer(organizationId, customerId);
    } else {
      await cache.invalidateOrganization(organizationId);
    }

    return reply.status(201).send(success(entitlement, request.requestId));
  });

  app.delete("/v1/entitlements/:entitlementId", async (request) => {
    const organizationId = requireOrganization(request);
    requireSecretKeyOrUser(request);
    requireRole(request, "ADMIN");
    const { entitlementId } = request.params as { entitlementId: string };

    const existing = await prisma.entitlement.findFirst({
      where: { id: entitlementId, organizationId },
    });
    if (!existing) throw BillingError.notFound("PLAN_NOT_FOUND", "Entitlement");

    await prisma.entitlement.delete({ where: { id: existing.id } });

    if (existing.customerId) {
      await cache.invalidateCustomer(organizationId, existing.customerId);
    } else {
      await cache.invalidateOrganization(organizationId);
    }

    return success({ deleted: true }, request.requestId);
  });
}
