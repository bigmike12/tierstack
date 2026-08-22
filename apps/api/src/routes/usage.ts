import { lookupCustomer } from "@tierbase/billing";
import type { PrismaClient } from "@tierbase/database";
import { EntitlementCache } from "@tierbase/entitlements";
import { BillingError, paginated, parsePageQuery, searchFilter, success } from "@tierbase/shared";
import { createMeter, listCustomerUsage, trackUsage } from "@tierbase/usage";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireOrganization, requireSecretKeyOrUser } from "../context";
import type { AppConfig } from "../env";
import type { RedisClient } from "../lib/redis";

const trackSchema = z.object({
  customerId: z.string().min(1),
  meter: z.string().min(1),
  units: z.number().int().min(0),
  /** Unique per organization. The same event is never counted twice. */
  eventId: z.string().min(1).max(255),
  timestamp: z.string().datetime().optional(),
  metadata: z.record(z.unknown()).default({}),
});

const batchSchema = z.object({ events: z.array(trackSchema).min(1).max(500) });

const meterSchema = z.object({
  code: z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/),
  name: z.string().min(1).max(120),
  unitLabel: z.string().max(40).optional(),
  aggregation: z.enum(["SUM", "MAX", "LAST", "UNIQUE_COUNT"]).default("SUM"),
  metadata: z.record(z.unknown()).default({}),
});

export function registerUsageRoutes(
  app: FastifyInstance,
  prisma: PrismaClient,
  config: AppConfig,
  redis: RedisClient
): void {
  const cache = new EntitlementCache(redis);

  // -- Meters ----------------------------------------------------------------

  app.post("/v1/usage-meters", async (request, reply) => {
    const organizationId = requireOrganization(request);
    requireSecretKeyOrUser(request);
    const body = meterSchema.parse(request.body);

    const meter = await createMeter(prisma, { organizationId, ...body });
    // A new meter can change what a plan entitles.
    await cache.invalidateOrganization(organizationId);
    return reply.status(201).send(success(meter, request.requestId));
  });

  app.get("/v1/usage-meters", async (request) => {
    const organizationId = requireOrganization(request);
    const meters = await prisma.usageMeter.findMany({
      where: { organizationId },
      orderBy: { code: "asc" },
    });
    return success(meters, request.requestId);
  });

  // -- Ingestion -------------------------------------------------------------

  /**
   * The hot path. A developer's application calls this every time a customer
   * consumes something, so it does the minimum: validate, de-duplicate on
   * eventId, persist. Aggregation happens on read and in the worker, never here.
   */
  app.post("/v1/events/track", async (request, reply) => {
    const organizationId = requireOrganization(request);
    requireSecretKeyOrUser(request);
    const body = trackSchema.parse(request.body);

    const customer = await lookupCustomer(prisma, organizationId, body.customerId);
    const result = await trackUsage(prisma, {
      organizationId,
      customerId: customer.id,
      meterCode: body.meter,
      units: body.units,
      eventId: body.eventId,
      timestamp: body.timestamp ? new Date(body.timestamp) : undefined,
      metadata: body.metadata,
    });

    // Consumption moved, so a cached quota answer may now be wrong.
    if (result.recorded) await cache.invalidateCustomer(organizationId, customer.id);

    return reply.status(result.recorded ? 202 : 200).send(
      success(
        { eventId: result.eventId, recorded: result.recorded, duplicate: !result.recorded, units: result.units },
        request.requestId
      )
    );
  });

  /** Batched ingestion, for clients that buffer. Each event de-duplicates on its own. */
  app.post("/v1/events/track/batch", async (request, reply) => {
    const organizationId = requireOrganization(request);
    requireSecretKeyOrUser(request);
    const body = batchSchema.parse(request.body);

    const results: { eventId: string; recorded: boolean; error?: string }[] = [];
    const touched = new Set<string>();

    for (const event of body.events) {
      try {
        const customer = await lookupCustomer(prisma, organizationId, event.customerId);
        const result = await trackUsage(prisma, {
          organizationId,
          customerId: customer.id,
          meterCode: event.meter,
          units: event.units,
          eventId: event.eventId,
          timestamp: event.timestamp ? new Date(event.timestamp) : undefined,
          metadata: event.metadata,
        });
        if (result.recorded) touched.add(customer.id);
        results.push({ eventId: event.eventId, recorded: result.recorded });
      } catch (error) {
        // One bad event must not discard the rest of the batch.
        results.push({
          eventId: event.eventId,
          recorded: false,
          error: error instanceof BillingError ? error.code : "INTERNAL_ERROR",
        });
      }
    }

    for (const customerId of touched) await cache.invalidateCustomer(organizationId, customerId);

    return reply.status(202).send(
      success(
        {
          accepted: results.filter((r) => r.recorded).length,
          duplicates: results.filter((r) => !r.recorded && !r.error).length,
          failed: results.filter((r) => r.error).length,
          results,
        },
        request.requestId
      )
    );
  });

  // -- Reading ---------------------------------------------------------------

  /**
   * Consumption for one customer in their current billing period, with the
   * included allowance, what remains, and what the overage would cost if the
   * period closed now.
   */
  app.get("/v1/usage", async (request) => {
    const organizationId = requireOrganization(request);
    const query = request.query as { customerId?: string; from?: string; to?: string };
    if (!query.customerId) {
      throw new BillingError("INVALID_REQUEST", "customerId is required.");
    }

    const customer = await lookupCustomer(prisma, organizationId, query.customerId);
    const period = await resolvePeriod(prisma, organizationId, customer.id, query.from, query.to);
    const meters = await listCustomerUsage(prisma, {
      organizationId,
      customerId: customer.id,
      period,
    });

    // Overage costs are quoted in the currency of the subscription that prices
    // the meter, not a platform default.
    const subscription = await prisma.subscription.findFirst({
      where: { organizationId, customerId: customer.id },
      orderBy: { createdAt: "desc" },
      select: { price: { select: { currency: true } } },
    });

    return success(
      {
        customerId: customer.id,
        externalId: customer.externalId,
        currency: subscription?.price.currency ?? customer.currency ?? null,
        period,
        meters,
      },
      request.requestId
    );
  });

  /** Raw events, for debugging an ingestion integration. Paginated. */
  app.get("/v1/usage/events", async (request) => {
    const organizationId = requireOrganization(request);
    const query = request.query as Record<string, unknown> & { customerId?: string; meter?: string };
    const page = parsePageQuery(query, { defaultLimit: 25, maxLimit: 500 });

    const meter = query.meter
      ? await prisma.usageMeter.findUnique({
          where: { organizationId_code: { organizationId, code: query.meter } },
        })
      : null;

    const where = {
      organizationId,
      ...(query.customerId ? { customerId: query.customerId } : {}),
      ...(meter ? { meterId: meter.id } : {}),
      ...(searchFilter(page.q, ["eventId"]) ?? {}),
    };

    const [items, total] = await Promise.all([
      prisma.usageEvent.findMany({
        where,
        orderBy: { timestamp: "desc" },
        take: page.limit,
        skip: page.skip,
        include: {
          meter: { select: { code: true, unitLabel: true } },
          // The customer is included so a caller can tell which customers have
          // consumption without a lookup per event.
          customer: { select: { id: true, externalId: true, email: true, name: true } },
        },
      }),
      prisma.usageEvent.count({ where }),
    ]);

    return success(paginated(items, page, total), request.requestId);
  });
}

/**
 * Usage windows follow the subscription's billing period, because that is the
 * window the invoice will bill. An explicit from/to overrides it for ad-hoc
 * reporting.
 */
async function resolvePeriod(
  prisma: PrismaClient,
  organizationId: string,
  customerId: string,
  from?: string,
  to?: string
): Promise<{ start: Date; end: Date }> {
  if (from && to) return { start: new Date(from), end: new Date(to) };

  const subscription = await prisma.subscription.findFirst({
    where: {
      organizationId,
      customerId,
      status: { in: ["TRIALING", "ACTIVE", "PAST_DUE", "GRACE_PERIOD", "INCOMPLETE"] },
    },
    orderBy: { createdAt: "desc" },
    select: { currentPeriodStart: true, currentPeriodEnd: true },
  });

  if (subscription) {
    return { start: subscription.currentPeriodStart, end: subscription.currentPeriodEnd };
  }

  // No subscription: fall back to the calendar month so the endpoint still
  // answers something meaningful.
  const now = new Date();
  return {
    start: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
    end: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)),
  };
}
