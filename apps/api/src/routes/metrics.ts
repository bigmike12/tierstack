import type { PrismaClient } from "@billing-platform/database";
import { success } from "@billing-platform/shared";
import type { FastifyInstance } from "fastify";
import { requireOrganization } from "../context";

/**
 * Dashboard metrics, computed straight from PostgreSQL. There is no analytics
 * warehouse: at this scale a handful of indexed aggregates is both simpler and
 * more accurate than a pipeline that can fall behind.
 *
 * Every monetary figure is reported per currency. Summing NGN and USD into a
 * single headline number would be a lie, so the API does not offer one.
 */
export function registerMetricsRoutes(app: FastifyInstance, prisma: PrismaClient): void {
  app.get("/v1/metrics/overview", async (request) => {
    const organizationId = requireOrganization(request);
    const query = request.query as { days?: string };
    const windowDays = Math.min(Math.max(Number(query.days ?? 30), 1), 365);
    const since = new Date(Date.now() - windowDays * 86_400_000);

    const [
      liveSubscriptions,
      activeCount,
      trialingCount,
      graceCount,
      incompleteCount,
      canceledInWindow,
      newCustomers,
      totalCustomers,
      paidInvoices,
      openInvoices,
      attemptStats,
      recentFailures,
    ] = await Promise.all([
      prisma.subscription.findMany({
        where: { organizationId, status: { in: ["ACTIVE", "TRIALING", "PAST_DUE", "GRACE_PERIOD"] } },
        select: {
          quantity: true,
          price: {
            select: { model: true, currency: true, unitAmount: true, intervalUnit: true, intervalCount: true },
          },
        },
      }),
      prisma.subscription.count({ where: { organizationId, status: "ACTIVE" } }),
      prisma.subscription.count({ where: { organizationId, status: "TRIALING" } }),
      prisma.subscription.count({ where: { organizationId, status: "GRACE_PERIOD" } }),
      prisma.subscription.count({ where: { organizationId, status: "INCOMPLETE" } }),
      prisma.subscription.count({
        where: { organizationId, status: "CANCELED", canceledAt: { gte: since } },
      }),
      prisma.customer.count({ where: { organizationId, deletedAt: null, createdAt: { gte: since } } }),
      prisma.customer.count({ where: { organizationId, deletedAt: null } }),
      prisma.invoice.groupBy({
        by: ["currency"],
        where: { organizationId, status: "PAID", paidAt: { gte: since } },
        _sum: { amountPaid: true },
        _count: { _all: true },
      }),
      prisma.invoice.groupBy({
        by: ["currency"],
        where: { organizationId, status: "OPEN" },
        _sum: { amountDue: true },
        _count: { _all: true },
      }),
      prisma.paymentAttempt.groupBy({
        by: ["status"],
        where: { organizationId, createdAt: { gte: since } },
        _count: { _all: true },
      }),
      prisma.paymentAttempt.count({
        where: { organizationId, status: "FAILED", createdAt: { gte: since } },
      }),
    ]);

    // Monthly recurring revenue, normalised from each subscription's own
    // interval. Kept in integer minor units throughout.
    const mrrByCurrency = new Map<string, number>();
    for (const subscription of liveSubscriptions) {
      const price = subscription.price;
      if (price.unitAmount === null) continue; // usage-only price: no recurring floor
      const base =
        price.model === "PER_SEAT" ? price.unitAmount * subscription.quantity : price.unitAmount;
      const monthly = normaliseToMonthly(base, price.intervalUnit, price.intervalCount);
      mrrByCurrency.set(price.currency, (mrrByCurrency.get(price.currency) ?? 0) + monthly);
    }

    const succeeded = attemptStats.find((s) => s.status === "SUCCEEDED")?._count._all ?? 0;
    const failed = attemptStats.find((s) => s.status === "FAILED")?._count._all ?? 0;
    const settled = succeeded + failed;

    const liveAtStart = activeCount + trialingCount + graceCount + canceledInWindow;

    return success(
      {
        windowDays,
        mrr: [...mrrByCurrency.entries()].map(([currency, amount]) => ({ currency, amount })),
        subscriptions: {
          active: activeCount,
          trialing: trialingCount,
          gracePeriod: graceCount,
          incomplete: incompleteCount,
          canceledInWindow,
        },
        customers: { total: totalCustomers, new: newCustomers },
        revenue: paidInvoices.map((row) => ({
          currency: row.currency,
          amount: row._sum.amountPaid ?? 0,
          invoices: row._count._all,
        })),
        outstanding: openInvoices.map((row) => ({
          currency: row.currency,
          amount: row._sum.amountDue ?? 0,
          invoices: row._count._all,
        })),
        failedPayments: recentFailures,
        // Null rather than a misleading 0% when nothing has been attempted yet.
        paymentSuccessRate: settled === 0 ? null : Math.round((succeeded / settled) * 1000) / 10,
        churnRate: liveAtStart === 0 ? null : Math.round((canceledInWindow / liveAtStart) * 1000) / 10,
      },
      request.requestId
    );
  });
}

function normaliseToMonthly(amount: number, unit: string, count: number): number {
  const perMonth =
    unit === "DAY"
      ? 30 / count
      : unit === "WEEK"
        ? 30 / 7 / count
        : unit === "MONTH"
          ? 1 / count
          : 1 / (12 * count);
  return Math.round(amount * perMonth);
}
