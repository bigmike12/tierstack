import type { PrismaClient } from "@tierstack/database";
import type { EntitlementCache } from "@tierstack/entitlements";

export interface UsageJobContext {
  prisma: PrismaClient;
  cache: EntitlementCache;
  log: (message: string, meta?: Record<string, unknown>) => void;
}

/**
 * A note on what this worker does and does not do.
 *
 * It does **not** maintain a running per-period counter. Aggregation happens in
 * PostgreSQL at read time, over the events themselves. That is a deliberate
 * choice: the events are the financial record, and a materialised counter is
 * one more thing that can silently drift away from them — a drifted counter
 * means a wrong invoice, and you would not find out until a customer disputed
 * it. An indexed SUM over one customer's events for one period is cheap, and it
 * cannot disagree with the events it is computed from.
 *
 * What the worker does is stamp ingestion so lag is observable, and act as a
 * backstop for cache invalidation when events arrive by a path that did not go
 * through the API.
 */
export async function markEventsProcessed(ctx: UsageJobContext, batchSize = 1000) {
  const pending = await ctx.prisma.usageEvent.findMany({
    where: { processedAt: null },
    select: { id: true, organizationId: true, customerId: true },
    take: batchSize,
    orderBy: { createdAt: "asc" },
  });
  if (pending.length === 0) return { processed: 0, customers: 0 };

  const now = new Date();
  await ctx.prisma.usageEvent.updateMany({
    where: { id: { in: pending.map((event) => event.id) } },
    data: { processedAt: now },
  });

  // Belt and braces: ingestion already invalidates, but an event written by a
  // migration or a backfill would not have.
  const touched = new Map<string, Set<string>>();
  for (const event of pending) {
    const set = touched.get(event.organizationId) ?? new Set<string>();
    set.add(event.customerId);
    touched.set(event.organizationId, set);
  }
  for (const [organizationId, customers] of touched) {
    for (const customerId of customers) {
      await ctx.cache.invalidateCustomer(organizationId, customerId);
    }
  }

  ctx.log("usage events processed", {
    events: pending.length,
    customers: [...touched.values()].reduce((sum, set) => sum + set.size, 0),
  });

  return {
    processed: pending.length,
    customers: [...touched.values()].reduce((sum, set) => sum + set.size, 0),
  };
}

/**
 * Reports how far behind ingestion is running, so a stuck pipeline is visible
 * before it shows up as an under-billed invoice.
 */
export async function reportIngestionLag(ctx: UsageJobContext) {
  const oldest = await ctx.prisma.usageEvent.findFirst({
    where: { processedAt: null },
    orderBy: { createdAt: "asc" },
    select: { createdAt: true },
  });
  if (!oldest) return { lagSeconds: 0, backlog: 0 };

  const backlog = await ctx.prisma.usageEvent.count({ where: { processedAt: null } });
  const lagSeconds = Math.round((Date.now() - oldest.createdAt.getTime()) / 1000);

  if (lagSeconds > 300) {
    ctx.log("usage ingestion is falling behind", { lagSeconds, backlog });
  }
  return { lagSeconds, backlog };
}
