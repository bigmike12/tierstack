import type { PrismaClient, TransactionClient } from "@tierstack/database";
import { BillingError, cappedFee, newId } from "@tierstack/shared";
import { assertAggregation, type UsageAggregation } from "./aggregation";
import { billableBlocks, computeQuota, type QuotaResult } from "./quota";

export interface UsagePeriod {
  start: Date;
  end: Date;
}

/** The largest value `UsageEvent.units` can hold — it is a PostgreSQL int4. */
export const MAX_UNITS = 2_147_483_647;

export interface TrackUsageInput {
  organizationId: string;
  customerId: string;
  meterCode: string;
  units: number;
  /** Caller-supplied idempotency key, unique per organization. */
  eventId: string;
  timestamp?: Date;
  metadata?: Record<string, unknown>;
}

export interface TrackUsageResult {
  eventId: string;
  /** False when this exact event was already recorded — the call was a replay. */
  recorded: boolean;
  meterId: string;
  units: number;
}

/**
 * Records one usage event.
 *
 * The unique constraint on (organizationId, eventId) is what makes this safe to
 * retry: a client that resends after a timeout gets `recorded: false` rather
 * than double-counting. This is the single most important property of a usage
 * API — a double-counted event becomes a double charge.
 */
export async function trackUsage(
  prisma: PrismaClient,
  input: TrackUsageInput
): Promise<TrackUsageResult> {
  if (!Number.isInteger(input.units) || input.units < 0) {
    throw new BillingError("VALIDATION_ERROR", "Usage units must be a non-negative integer.");
  }
  // `UsageEvent.units` is an int4 column. Without this the overflow surfaces as
  // a raw Postgres error on insert — a 500 for what is a caller mistake, and one
  // whose cause is invisible from the response. It bites in exactly one place:
  // a meter recording money in minor units, where a single ₦21.5m payment is
  // past the ceiling. Meter money in major units and the limit is ₦21bn, which
  // is why every surface that offers a percentage fee meters in naira.
  if (input.units > MAX_UNITS) {
    throw new BillingError(
      "VALIDATION_ERROR",
      `Usage units must be at most ${MAX_UNITS.toLocaleString()}, received ${input.units.toLocaleString()}. ` +
        "A meter recording money should count major units — naira, not kobo."
    );
  }
  if (!input.eventId) {
    throw new BillingError("VALIDATION_ERROR", "eventId is required so the event can be de-duplicated.");
  }

  const meter = await prisma.usageMeter.findUnique({
    where: { organizationId_code: { organizationId: input.organizationId, code: input.meterCode } },
  });
  if (!meter) {
    throw new BillingError("INVALID_REQUEST", `No usage meter with code "${input.meterCode}".`);
  }
  if (!meter.active) {
    throw new BillingError("INVALID_REQUEST", `Usage meter "${input.meterCode}" is not active.`);
  }

  const existing = await prisma.usageEvent.findUnique({
    where: { organizationId_eventId: { organizationId: input.organizationId, eventId: input.eventId } },
  });
  if (existing) {
    return { eventId: input.eventId, recorded: false, meterId: existing.meterId, units: existing.units };
  }

  try {
    await prisma.usageEvent.create({
      data: {
        id: newId("usageEvent"),
        organizationId: input.organizationId,
        customerId: input.customerId,
        meterId: meter.id,
        eventId: input.eventId,
        units: input.units,
        timestamp: input.timestamp ?? new Date(),
        metadata: (input.metadata ?? {}) as never,
      },
    });
  } catch (error) {
    // Lost a race with an identical concurrent call; that is still a replay.
    if ((error as { code?: string }).code === "P2002") {
      return { eventId: input.eventId, recorded: false, meterId: meter.id, units: input.units };
    }
    throw error;
  }

  return { eventId: input.eventId, recorded: true, meterId: meter.id, units: input.units };
}

/**
 * Aggregates a customer's usage for one meter over one window.
 *
 * The aggregation runs in PostgreSQL rather than by loading events into memory,
 * so a customer with a million events in a period costs one indexed query. The
 * pure `aggregate()` function documents the same semantics for callers that
 * already hold the events.
 */
export async function getPeriodUsage(
  db: PrismaClient | TransactionClient,
  params: {
    organizationId: string;
    customerId: string;
    meterId: string;
    aggregation: UsageAggregation;
    period: UsagePeriod;
  }
): Promise<number> {
  const where = {
    organizationId: params.organizationId,
    customerId: params.customerId,
    meterId: params.meterId,
    timestamp: { gte: params.period.start, lt: params.period.end },
  };

  switch (assertAggregation(params.aggregation)) {
    case "SUM": {
      const result = await db.usageEvent.aggregate({ where, _sum: { units: true } });
      return result._sum.units ?? 0;
    }
    case "MAX": {
      const result = await db.usageEvent.aggregate({ where, _max: { units: true } });
      return result._max.units ?? 0;
    }
    case "LAST": {
      const latest = await db.usageEvent.findFirst({
        where,
        orderBy: { timestamp: "desc" },
        select: { units: true },
      });
      return latest?.units ?? 0;
    }
    case "UNIQUE_COUNT": {
      const rows = await db.$queryRaw<{ count: bigint }[]>`
        SELECT COUNT(DISTINCT "metadata"->>'uniqueKey') AS count
        FROM "usage_events"
        WHERE "organizationId" = ${params.organizationId}
          AND "customerId" = ${params.customerId}
          AND "meterId" = ${params.meterId}
          AND "timestamp" >= ${params.period.start}
          AND "timestamp" < ${params.period.end}
          AND "metadata" ? 'uniqueKey'
      `;
      return Number(rows[0]?.count ?? 0);
    }
  }
}

export interface MeteredPrice {
  usageMeterId: string | null;
  usageUnitAmount: number | null;
  usageUnitSize: number | null;
  includedUnits: number | null;
  /** Ceiling on the charge for one billing period, in minor units. */
  usageMaxAmount?: number | null;
}

export interface UsageSnapshot extends QuotaResult {
  meterId: string;
  meterCode: string;
  meterName: string;
  unitLabel: string | null;
  aggregation: UsageAggregation;
  period: UsagePeriod;
  /** Priced blocks the overage represents, given the price's block size. */
  overageBlocks: number;
  /** What the overage costs after any cap, or null when the price has no rate. */
  overageAmount: number | null;
  /**
   * What it would have cost uncapped. Equal to `overageAmount` unless the cap
   * bit — the dashboard shows the difference, and the invoice line says so.
   */
  uncappedOverageAmount: number | null;
  /** The price's ceiling for this period, in minor units. Null means uncapped. */
  capAmount: number | null;
  /** True when the cap actually reduced the charge, not merely that one is set. */
  capApplied: boolean;
}

/**
 * Everything the dashboard, the entitlement engine and the invoice need to know
 * about one customer's consumption of one meter in the current period.
 */
export async function getUsageSnapshot(
  db: PrismaClient | TransactionClient,
  params: {
    organizationId: string;
    customerId: string;
    meterId: string;
    period: UsagePeriod;
    price?: MeteredPrice | null;
  }
): Promise<UsageSnapshot> {
  const meter = await db.usageMeter.findFirst({
    where: { id: params.meterId, organizationId: params.organizationId },
  });
  if (!meter) throw new BillingError("INVALID_REQUEST", "Usage meter was not found.");

  const aggregation = assertAggregation(meter.aggregation);
  const used = await getPeriodUsage(db, {
    organizationId: params.organizationId,
    customerId: params.customerId,
    meterId: meter.id,
    aggregation,
    period: params.period,
  });

  const quota = computeQuota({ used, includedUnits: params.price?.includedUnits });
  const blocks = billableBlocks(quota.overage, params.price?.usageUnitSize);
  const rate = params.price?.usageUnitAmount ?? null;
  const cap = params.price?.usageMaxAmount ?? null;

  // The block count stays what was actually consumed; only the money is
  // clamped. A capped period should still be able to tell you how much volume
  // went through it, which is the first thing asked when a merchant wonders
  // whether the cap is set right.
  const uncapped = rate === null ? null : blocks * rate;
  const charged = uncapped === null ? null : cappedFee(uncapped, cap);

  return {
    ...quota,
    meterId: meter.id,
    meterCode: meter.code,
    meterName: meter.name,
    unitLabel: meter.unitLabel,
    aggregation,
    period: params.period,
    overageBlocks: blocks,
    overageAmount: charged,
    uncappedOverageAmount: uncapped,
    capAmount: cap,
    capApplied: uncapped !== null && charged !== null && charged < uncapped,
  };
}

/** Every meter a customer has consumed, plus any attached to their subscriptions. */
export async function listCustomerUsage(
  prisma: PrismaClient,
  params: { organizationId: string; customerId: string; period: UsagePeriod }
): Promise<UsageSnapshot[]> {
  const meters = await prisma.usageMeter.findMany({
    where: { organizationId: params.organizationId, active: true },
    orderBy: { code: "asc" },
  });

  const snapshots: UsageSnapshot[] = [];
  for (const meter of meters) {
    // Only report a meter the customer is actually metered on — either they
    // have events, or a subscription prices this meter.
    const price = await prisma.price.findFirst({
      where: {
        organizationId: params.organizationId,
        usageMeterId: meter.id,
        subscriptions: { some: { customerId: params.customerId } },
      },
      select: {
        usageMeterId: true,
        usageUnitAmount: true,
        usageUnitSize: true,
        includedUnits: true,
        usageMaxAmount: true,
      },
    });
    const eventCount = await prisma.usageEvent.count({
      where: {
        organizationId: params.organizationId,
        customerId: params.customerId,
        meterId: meter.id,
        timestamp: { gte: params.period.start, lt: params.period.end },
      },
    });
    if (!price && eventCount === 0) continue;

    snapshots.push(
      await getUsageSnapshot(prisma, {
        organizationId: params.organizationId,
        customerId: params.customerId,
        meterId: meter.id,
        period: params.period,
        price,
      })
    );
  }
  return snapshots;
}

/**
 * Two meters that mean the same thing to whoever is reading the dashboard —
 * same name, differently cased — are as confusing as two meters with the same
 * code, so both are checked, not just the one the database itself enforces.
 */
async function assertMeterNameAvailable(
  prisma: PrismaClient,
  params: { organizationId: string; name: string; excludeMeterId?: string }
): Promise<void> {
  const clash = await prisma.usageMeter.findFirst({
    where: {
      organizationId: params.organizationId,
      deletedAt: null,
      name: { equals: params.name, mode: "insensitive" },
      ...(params.excludeMeterId ? { id: { not: params.excludeMeterId } } : {}),
    },
    select: { id: true },
  });
  if (clash) {
    throw new BillingError(
      "ALREADY_EXISTS",
      `A meter named "${params.name}" already exists. Names must be unique so the dashboard never shows two meters that look identical.`
    );
  }
}

export async function createMeter(
  prisma: PrismaClient,
  params: {
    organizationId: string;
    code: string;
    name: string;
    unitLabel?: string | null;
    aggregation?: string;
    metadata?: Record<string, unknown>;
  }
) {
  const aggregation = assertAggregation(params.aggregation ?? "SUM");

  // The (organizationId, code) unique constraint is not partial on deletedAt,
  // so a soft-deleted meter's code is never actually free — check without the
  // deletedAt filter to raise a clean ALREADY_EXISTS instead of a raw P2002.
  const existingCode = await prisma.usageMeter.findFirst({
    where: { organizationId: params.organizationId, code: params.code },
    select: { id: true, deletedAt: true },
  });
  if (existingCode) {
    throw new BillingError(
      "ALREADY_EXISTS",
      existingCode.deletedAt
        ? `Meter code "${params.code}" was used by a deleted meter and cannot be reused.`
        : `A meter with code "${params.code}" already exists. Edit it instead of creating a second one.`
    );
  }
  await assertMeterNameAvailable(prisma, { organizationId: params.organizationId, name: params.name });

  return prisma.usageMeter.create({
    data: {
      id: newId("usageMeter"),
      organizationId: params.organizationId,
      code: params.code,
      name: params.name,
      unitLabel: params.unitLabel ?? null,
      aggregation,
      metadata: (params.metadata ?? {}) as never,
    },
  });
}

export async function updateMeter(
  prisma: PrismaClient,
  params: {
    organizationId: string;
    meterId: string;
    name?: string;
    unitLabel?: string | null;
    aggregation?: string;
    active?: boolean;
  }
) {
  const meter = await prisma.usageMeter.findFirst({
    where: { id: params.meterId, organizationId: params.organizationId, deletedAt: null },
  });
  if (!meter) throw BillingError.notFound("USAGE_METER_NOT_FOUND", "Usage meter");

  if (params.name && params.name !== meter.name) {
    await assertMeterNameAvailable(prisma, {
      organizationId: params.organizationId,
      name: params.name,
      excludeMeterId: meter.id,
    });
  }

  return prisma.usageMeter.update({
    where: { id: meter.id },
    data: {
      name: params.name ?? undefined,
      unitLabel: params.unitLabel === undefined ? undefined : params.unitLabel,
      aggregation: params.aggregation ? assertAggregation(params.aggregation) : undefined,
      active: params.active ?? undefined,
    },
  });
}
