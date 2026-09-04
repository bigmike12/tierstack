import type { PrismaClient } from "@tierstack/database";
import { success } from "@tierstack/shared";
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

/**
 * The daily series and breakdowns the overview charts are drawn from.
 *
 * Separate from /overview rather than bolted onto it: the scalars there are
 * eight cheap counts that every caller wants, and these are a dozen grouped
 * scans that only the dashboard's charts need. Keeping them apart means the
 * cheap call stays cheap.
 *
 * Grouped in SQL rather than by pulling rows and bucketing them in JS. A year
 * of invoices is not a large table, but it is an unbounded one, and the whole
 * point of the aggregate is that its cost does not grow with how much the
 * business has billed. Days are UTC, matching how Prisma stores the columns.
 */
export function registerTimeseriesRoute(app: FastifyInstance, prisma: PrismaClient): void {
  app.get("/v1/metrics/timeseries", async (request) => {
    const organizationId = requireOrganization(request);
    const query = request.query as { days?: string };
    const windowDays = Math.min(Math.max(Number(query.days ?? 30), 1), 365);

    // Start of the UTC day, windowDays - 1 days back: the series covers whole
    // days including today, so a 30-day window is 30 buckets and not 31.
    const start = startOfUtcDay(new Date());
    start.setUTCDate(start.getUTCDate() - (windowDays - 1));

    const [revenueRows, movementRows, customerRows, attemptRows, planRows, invoiceStatus, topCustomerRows] =
      await Promise.all([
        prisma.$queryRaw<DayRow<{ currency: string; amount: string; invoices: number }>[]>`
          SELECT date_trunc('day', "paidAt") AS day,
                 "currency",
                 SUM("amountPaid")::text AS amount,
                 COUNT(*)::int AS invoices
          FROM "invoices"
          WHERE "organizationId" = ${organizationId}
            AND "status" = 'PAID'
            AND "paidAt" >= ${start}
          GROUP BY 1, 2
        `,
        prisma.$queryRaw<DayRow<{ kind: string; count: number }>[]>`
          SELECT date_trunc('day', "createdAt") AS day, 'created' AS kind, COUNT(*)::int AS count
          FROM "subscriptions"
          WHERE "organizationId" = ${organizationId} AND "createdAt" >= ${start}
          GROUP BY 1
          UNION ALL
          SELECT date_trunc('day', "canceledAt") AS day, 'canceled' AS kind, COUNT(*)::int AS count
          FROM "subscriptions"
          WHERE "organizationId" = ${organizationId} AND "canceledAt" >= ${start}
          GROUP BY 1
        `,
        prisma.$queryRaw<DayRow<{ count: number }>[]>`
          SELECT date_trunc('day', "createdAt") AS day, COUNT(*)::int AS count
          FROM "customers"
          WHERE "organizationId" = ${organizationId}
            AND "deletedAt" IS NULL
            AND "createdAt" >= ${start}
          GROUP BY 1
        `,
        prisma.$queryRaw<DayRow<{ status: string; count: number }>[]>`
          SELECT date_trunc('day', "createdAt") AS day, "status", COUNT(*)::int AS count
          FROM "payment_attempts"
          WHERE "organizationId" = ${organizationId} AND "createdAt" >= ${start}
          GROUP BY 1, 2
        `,
        // The live book by plan. Same shape the MRR figure is built from, so
        // the bars and the headline can never disagree.
        prisma.subscription.findMany({
          where: { organizationId, status: { in: ["ACTIVE", "TRIALING", "PAST_DUE", "GRACE_PERIOD"] } },
          select: {
            quantity: true,
            price: {
              select: {
                model: true,
                currency: true,
                unitAmount: true,
                intervalUnit: true,
                intervalCount: true,
                plan: { select: { id: true, name: true } },
              },
            },
          },
        }),
        prisma.invoice.groupBy({
          by: ["status"],
          where: { organizationId },
          _count: { _all: true },
        }),
        prisma.$queryRaw<{ id: string; name: string | null; email: string; currency: string; amount: string }[]>`
          SELECT c."id", c."name", c."email", i."currency", SUM(i."amountPaid")::text AS amount
          FROM "invoices" i
          JOIN "customers" c ON c."id" = i."customerId"
          WHERE i."organizationId" = ${organizationId}
            AND i."status" = 'PAID'
            AND i."paidAt" >= ${start}
          GROUP BY c."id", c."name", c."email", i."currency"
          ORDER BY SUM(i."amountPaid") DESC
          LIMIT 5
        `,
      ]);

    // Every series is emitted gap-filled against this spine, so the charts can
    // index straight into a fixed-length array and a quiet day is a zero
    // rather than a missing point that the line would draw straight through.
    const days: string[] = [];
    for (let i = 0; i < windowDays; i += 1) {
      const day = new Date(start);
      day.setUTCDate(day.getUTCDate() + i);
      days.push(day.toISOString().slice(0, 10));
    }
    const indexOf = new Map(days.map((day, index) => [day, index]));
    const zeroes = () => new Array<number>(windowDays).fill(0);
    // The spine is fixed-length and every index comes out of `indexOf`, so a
    // bucket always exists — but the compiler cannot see that, and writing
    // `!` at each of the six call sites would be six chances to be wrong.
    const add = (series: number[], index: number, value: number) => {
      series[index] = (series[index] ?? 0) + value;
    };

    const revenueByCurrency = new Map<string, { points: number[]; total: number; invoices: number }>();
    for (const row of revenueRows) {
      const index = indexOf.get(dayKey(row.day));
      if (index === undefined) continue;
      const series =
        revenueByCurrency.get(row.currency) ??
        revenueByCurrency.set(row.currency, { points: zeroes(), total: 0, invoices: 0 }).get(row.currency)!;
      const amount = Number(row.amount);
      add(series.points, index, amount);
      series.total += amount;
      series.invoices += Number(row.invoices);
    }

    const created = zeroes();
    const canceled = zeroes();
    for (const row of movementRows) {
      const index = indexOf.get(dayKey(row.day));
      if (index === undefined) continue;
      add(row.kind === "created" ? created : canceled, index, Number(row.count));
    }

    const newCustomers = zeroes();
    for (const row of customerRows) {
      const index = indexOf.get(dayKey(row.day));
      if (index !== undefined) add(newCustomers, index, Number(row.count));
    }

    const succeeded = zeroes();
    const failed = zeroes();
    for (const row of attemptRows) {
      const index = indexOf.get(dayKey(row.day));
      if (index === undefined) continue;
      if (row.status === "SUCCEEDED") add(succeeded, index, Number(row.count));
      else if (row.status === "FAILED") add(failed, index, Number(row.count));
    }

    // One row per plan and currency: a plan sold in naira and dollars is two
    // bars, because adding the two amounts together would be meaningless.
    const planTotals = new Map<string, { planId: string; plan: string; currency: string; subscriptions: number; mrr: number }>();
    for (const subscription of planRows) {
      const price = subscription.price;
      const plan = price.plan;
      const key = `${plan.id}:${price.currency}`;
      const row =
        planTotals.get(key) ??
        planTotals
          .set(key, { planId: plan.id, plan: plan.name, currency: price.currency, subscriptions: 0, mrr: 0 })
          .get(key)!;
      row.subscriptions += 1;
      if (price.unitAmount !== null) {
        const base =
          price.model === "PER_SEAT" ? price.unitAmount * subscription.quantity : price.unitAmount;
        row.mrr += normaliseToMonthly(base, price.intervalUnit, price.intervalCount);
      }
    }

    return success(
      {
        windowDays,
        days,
        revenue: [...revenueByCurrency.entries()]
          .map(([currency, series]) => ({ currency, ...series }))
          .sort((a, b) => b.total - a.total),
        subscriptions: { created, canceled },
        customers: { created: newCustomers },
        payments: { succeeded, failed },
        plans: [...planTotals.values()].sort((a, b) => b.mrr - a.mrr || b.subscriptions - a.subscriptions),
        invoices: invoiceStatus.map((row) => ({ status: row.status, count: row._count._all })),
        topCustomers: topCustomerRows.map((row) => ({
          id: row.id,
          name: row.name,
          email: row.email,
          currency: row.currency,
          amount: Number(row.amount),
        })),
      },
      request.requestId
    );
  });
}

type DayRow<T> = T & { day: Date | string };

/** `date_trunc` comes back as a Date on some drivers and a string on others. */
function dayKey(day: Date | string): string {
  return (day instanceof Date ? day.toISOString() : String(day)).slice(0, 10);
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
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
