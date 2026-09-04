import type { Metadata } from "next";
import Link from "next/link";
import { ChartCard, ChartLegend, DataTable, Headline } from "@/components/charts/chrome";
import { BarList, HealthBar, MovementColumns, OutcomeColumns, Sparkline } from "@/components/charts/plots";
import { RangeFilter } from "@/components/charts/range-filter";
import { RevenueCard } from "@/components/charts/revenue-card";
import { CustomerCell } from "@/components/customer-cell";
import { StatusBadge } from "@/components/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, PageHeader, Stat } from "@/components/ui/shell";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { apiFetchOrNull } from "@/lib/api";
import { formatAmount, formatCompact, formatDate, titleCase } from "@/lib/format";
import type { Paged } from "@/lib/list";
import type { Invoice, OverviewMetrics, Subscription, TimeseriesMetrics } from "@/lib/types";
import { cn } from "@/lib/utils";
import { dayLabel } from "@/lib/viz";

export const metadata: Metadata = { title: "Overview" };

const ALLOWED_WINDOWS = [7, 30, 90, 365];

/**
 * The page a business owner lands on.
 *
 * It answers five questions in the order they get asked: how much am I making,
 * is that going up or down, how healthy is the book underneath it, where is
 * the money coming from, and what happened most recently. Everything is
 * computed over one window, chosen once at the top, so no two cards on the
 * page can be reporting different fortnights.
 *
 * Money is never summed across currencies anywhere on this page — not in a
 * headline, not in a bar, not in a chart. A naira and a dollar added together
 * make a number that is not an amount of anything, and a dashboard that prints
 * one is worse than a dashboard that prints nothing.
 */
export default async function OverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>;
}) {
  const requested = Number((await searchParams).days);
  const windowDays = ALLOWED_WINDOWS.includes(requested) ? requested : 30;

  const [metrics, series, subscriptionPage, invoicePage] = await Promise.all([
    apiFetchOrNull<OverviewMetrics>(`/v1/metrics/overview?days=${windowDays}`),
    apiFetchOrNull<TimeseriesMetrics>(`/v1/metrics/timeseries?days=${windowDays}`),
    apiFetchOrNull<Paged<Subscription>>("/v1/subscriptions?limit=6"),
    apiFetchOrNull<Paged<Invoice>>("/v1/invoices?limit=6"),
  ]);

  if (!metrics) {
    return (
      <>
        <PageHeader title="Overview" />
        <EmptyState
          title="The API is not reachable"
          description="Start it with npm run dev, and check that API_URL points at it."
        />
      </>
    );
  }

  const subscriptions = subscriptionPage?.items ?? null;
  const invoices = invoicePage?.items ?? null;
  const hasAnything = metrics.customers.total > 0 || metrics.subscriptions.active > 0;

  const days = series?.days ?? [];
  const created = series?.subscriptions.created ?? [];
  const canceled = series?.subscriptions.canceled ?? [];
  const netAdds = sum(created) - sum(canceled);

  // The three groups the book is actually judged by. The five raw statuses are
  // spelled out underneath each one rather than being given five hues nobody's
  // colour vision can reliably separate.
  const healthy = metrics.subscriptions.active + metrics.subscriptions.trialing;
  const atRisk = metrics.subscriptions.gracePeriod;
  const idle = metrics.subscriptions.incomplete;

  return (
    <>
      <PageHeader
        title="Overview"
        description="Everything below is computed over the selected window. Money is reported per currency."
        action={<RangeFilter active={windowDays} />}
      />

      {!hasAnything ? (
        <EmptyState
          title="Nothing has been billed yet"
          description="Create a plan and a price, then subscribe a customer. With the mock provider configured you can run the whole lifecycle without any provider credentials."
        />
      ) : null}

      {/* -- What am I making, and is it moving? ---------------------------- */}
      <section aria-label="Revenue" className="grid gap-4 lg:grid-cols-3">
        <MrrCard metrics={metrics} />
        <div className="lg:col-span-2">
          {series ? (
            <RevenueCard series={series.revenue} days={series.days} windowDays={windowDays} />
          ) : (
            <ChartUnavailable title="Revenue collected" />
          )}
        </div>
      </section>

      <section aria-label="Key metrics" className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {/* Deliberately not "net adds" here: the net figure counts every
            subscription started in the window, most of which are no longer
            active, so printing it beside the active count invites the reader
            to subtract two numbers that do not relate. It lives on the
            movement chart, where the bars explain it. */}
        <Stat
          label="Active subscriptions"
          value={metrics.subscriptions.active}
          sub={`${metrics.subscriptions.trialing} trialing · ${metrics.subscriptions.gracePeriod} in a grace period`}
        />
        <Stat
          label="Payment success rate"
          value={metrics.paymentSuccessRate === null ? "—" : `${metrics.paymentSuccessRate}%`}
          sub={
            metrics.paymentSuccessRate === null
              ? "No payments attempted yet"
              : `${metrics.failedPayments} failed attempts`
          }
          tone={metrics.paymentSuccessRate !== null && metrics.paymentSuccessRate < 80 ? "warning" : "default"}
        />
        <Stat
          label="Outstanding"
          value={<AmountStack rows={metrics.outstanding} />}
          sub={`${metrics.outstanding.reduce((total, row) => total + row.invoices, 0)} open invoices`}
          tone={metrics.outstanding.length > 0 ? "warning" : "default"}
        />
        <Stat
          label="New customers"
          value={
            <span className="flex items-center justify-between gap-3">
              {metrics.customers.new}
              {series ? <Sparkline values={series.customers.created} /> : null}
            </span>
          }
          sub={`${metrics.customers.total} in total`}
        />
      </section>

      {/* -- How healthy is the book underneath it? ------------------------- */}
      <section aria-label="Subscription health" className="mt-4">
        <ChartCard
          title="Health of the book"
          description="Every live subscription, grouped by whether it is paying, at risk, or never got started."
          table={
            <DataTable
              columns={["Status", "Subscriptions"]}
              rows={[
                ["Active", metrics.subscriptions.active],
                ["Trialing", metrics.subscriptions.trialing],
                ["In a grace period", metrics.subscriptions.gracePeriod],
                ["Never paid", metrics.subscriptions.incomplete],
                ["Canceled in window", metrics.subscriptions.canceledInWindow],
              ]}
            />
          }
        >
          <div className="px-3 pb-4 pt-1">
            <HealthBar
              segments={[
                {
                  label: "Paying",
                  value: healthy,
                  color: "var(--viz-healthy)",
                  detail: `${metrics.subscriptions.active} active · ${metrics.subscriptions.trialing} trialing`,
                },
                {
                  label: "At risk",
                  value: atRisk,
                  color: "var(--viz-risk)",
                  detail: "In a grace period after a failed payment — still recoverable",
                },
                {
                  label: "Never started",
                  value: idle,
                  color: "var(--viz-idle)",
                  detail: "Signed up but the first payment never went through",
                },
              ]}
            />
          </div>
        </ChartCard>
      </section>

      {/* -- What moved, and did the money arrive? -------------------------- */}
      <section aria-label="Movement and payments" className="mt-4 grid gap-4 xl:grid-cols-2">
        {series ? (
          <ChartCard
            title="Subscriptions started and cancelled"
            description="Starts sit above the line, cancellations below it."
            headline={
              <Headline
                value={`${netAdds >= 0 ? "+" : ""}${netAdds}`}
                note={`net over ${windowDays} days · ${sum(created)} started, ${sum(canceled)} cancelled`}
              />
            }
            legend={
              <ChartLegend
                items={[
                  { label: "Started", color: "var(--viz-gain)" },
                  { label: "Cancelled", color: "var(--viz-loss)" },
                ]}
              />
            }
            table={
              <DataTable
                columns={["Day", "Started", "Cancelled"]}
                rows={days.map((day, index) => [
                  dayLabel(day),
                  created[index] ?? 0,
                  canceled[index] ?? 0,
                ])}
              />
            }
          >
            <MovementColumns
              days={days}
              gains={created}
              losses={canceled}
              gainLabel="Started"
              lossLabel="Cancelled"
            />
          </ChartCard>
        ) : (
          <ChartUnavailable title="Subscriptions started and cancelled" />
        )}

        {series ? (
          <ChartCard
            title="Payment attempts"
            description="Every charge sent to your provider, and how it came back."
            headline={
              <Headline
                value={metrics.paymentSuccessRate === null ? "—" : `${metrics.paymentSuccessRate}%`}
                note={`${sum(series.payments.succeeded)} succeeded, ${sum(series.payments.failed)} failed`}
              />
            }
            legend={
              <ChartLegend
                items={[
                  { label: "Succeeded", color: "var(--viz-healthy)" },
                  { label: "Failed", color: "var(--viz-loss)" },
                ]}
              />
            }
            table={
              <DataTable
                columns={["Day", "Succeeded", "Failed"]}
                rows={days.map((day, index) => [
                  dayLabel(day),
                  series.payments.succeeded[index] ?? 0,
                  series.payments.failed[index] ?? 0,
                ])}
              />
            }
          >
            <OutcomeColumns
              days={days}
              lower={series.payments.succeeded}
              upper={series.payments.failed}
              lowerLabel="Succeeded"
              upperLabel="Failed"
              height={200}
            />
          </ChartCard>
        ) : (
          <ChartUnavailable title="Payment attempts" />
        )}
      </section>

      {/* -- Where is the money coming from? -------------------------------- */}
      <section aria-label="Revenue sources" className="mt-4 grid gap-4 xl:grid-cols-2">
        {series && series.plans.length > 0 ? (
          <ChartCard
            title="Recurring revenue by plan"
            description="The live book, normalised to a monthly figure. One row per plan and currency."
            table={
              <DataTable
                columns={["Plan", "Subscriptions", "MRR"]}
                rows={series.plans.map((plan) => [
                  `${plan.plan} (${plan.currency})`,
                  plan.subscriptions,
                  formatAmount(plan.mrr, plan.currency),
                ])}
              />
            }
          >
            <CurrencyGroups
              rows={series.plans}
              limit={6}
              render={(rows) => (
                <BarList
                  items={rows.map((plan) => ({
                    label: plan.plan,
                    value: plan.mrr,
                    display: formatCompact(plan.mrr, plan.currency),
                    note: `${plan.subscriptions} ${plan.subscriptions === 1 ? "subscription" : "subscriptions"}`,
                  }))}
                />
              )}
            />
          </ChartCard>
        ) : (
          <ChartUnavailable title="Recurring revenue by plan" />
        )}

        {series && series.topCustomers.length > 0 ? (
          <ChartCard
            title="Biggest customers this window"
            description="By what they actually paid, not by what they were billed."
            table={
              <DataTable
                columns={["Customer", "Paid"]}
                rows={series.topCustomers.map((customer) => [
                  customer.name ?? customer.email,
                  formatAmount(customer.amount, customer.currency),
                ])}
              />
            }
          >
            <CurrencyGroups
              rows={series.topCustomers}
              limit={5}
              render={(rows) => (
                <BarList
                  items={rows.map((customer) => ({
                    label: customer.name ?? customer.email,
                    value: customer.amount,
                    display: formatCompact(customer.amount, customer.currency),
                  }))}
                />
              )}
            />
          </ChartCard>
        ) : (
          <ChartUnavailable title="Biggest customers this window" />
        )}
      </section>

      {/* -- What happened most recently? ----------------------------------- */}
      <section aria-label="Recent activity" className="mt-4 grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Recent subscriptions</CardTitle>
            <Link href="/subscriptions" className="text-xs text-muted-foreground underline underline-offset-4">
              View all
            </Link>
          </CardHeader>
          <CardContent className="px-0 pb-0">
            {subscriptions && subscriptions.length > 0 ? (
              <Table>
                <THead>
                  <TR>
                    <TH>Customer</TH>
                    <TH>Plan</TH>
                    <TH>Status</TH>
                    <TH>Renews</TH>
                  </TR>
                </THead>
                <TBody>
                  {subscriptions.map((sub) => (
                    <TR key={sub.id}>
                      <TD className="max-w-[200px]">
                        <Link href={`/subscriptions/${sub.id}`} className="underline-offset-4 hover:underline">
                          <CustomerCell customer={sub.customer} />
                        </Link>
                      </TD>
                      <TD className="text-muted-foreground">{sub.price?.plan?.name ?? "—"}</TD>
                      <TD>
                        <StatusBadge status={sub.status} />
                      </TD>
                      <TD className="tabular text-muted-foreground">{formatDate(sub.currentPeriodEnd)}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            ) : (
              <p className="px-5 pb-5 text-sm text-muted-foreground">No subscriptions yet.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Recent invoices</CardTitle>
            <Link href="/invoices" className="text-xs text-muted-foreground underline underline-offset-4">
              View all
            </Link>
          </CardHeader>
          <CardContent className="px-0 pb-0">
            {invoices && invoices.length > 0 ? (
              <Table>
                <THead>
                  <TR>
                    <TH>Number</TH>
                    <TH>Total</TH>
                    <TH>Status</TH>
                    <TH>Issued</TH>
                  </TR>
                </THead>
                <TBody>
                  {invoices.map((invoice) => (
                    <TR key={invoice.id}>
                      <TD>
                        <Link href={`/invoices/${invoice.id}`} className="font-mono text-xs underline-offset-4 hover:underline">
                          {invoice.invoiceNumber}
                        </Link>
                      </TD>
                      <TD className="tabular">{formatAmount(invoice.total, invoice.currency)}</TD>
                      <TD>
                        <StatusBadge status={invoice.status} />
                      </TD>
                      <TD className="tabular text-muted-foreground">{formatDate(invoice.createdAt)}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            ) : (
              <p className="px-5 pb-5 text-sm text-muted-foreground">No invoices yet.</p>
            )}
          </CardContent>
        </Card>
      </section>

      {series && series.invoices.length > 0 ? (
        <section aria-label="Invoices by status" className="mt-4">
          <Card className="flex flex-wrap items-center gap-x-8 gap-y-4 px-5 py-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              All invoices
            </p>
            {series.invoices.map((row) => (
              <p key={row.status} className="text-sm">
                <span className="tabular font-semibold">{row.count}</span>{" "}
                <span className="text-muted-foreground">{titleCase(row.status)}</span>
              </p>
            ))}
          </Card>
        </section>
      ) : null}
    </>
  );
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

/**
 * Splits rows by currency and draws a separate bar chart for each.
 *
 * Bar length is only meaningful against a shared scale, and amounts in
 * different currencies do not share one. Charted together, a ₦48,300 plan and
 * a US$29 plan are 4,830,000 and 2,900 minor units, so the dollar plan renders
 * as a two-pixel stub — not "smaller", but measured against the wrong ruler.
 * Each currency gets its own group and its own maximum instead, which is the
 * same rule the rest of the page follows for money.
 */
function CurrencyGroups<T extends { currency: string }>({
  rows,
  limit,
  render,
}: {
  rows: T[];
  limit: number;
  render: (rows: T[]) => React.ReactNode;
}) {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const existing = groups.get(row.currency);
    if (existing) existing.push(row);
    else groups.set(row.currency, [row]);
  }
  const entries = [...groups.entries()];

  return (
    <div className="space-y-5 px-3 pb-4 pt-2">
      {entries.map(([currency, currencyRows]) => (
        <div key={currency}>
          {entries.length > 1 ? (
            <p className="mb-2.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              {currency}
            </p>
          ) : null}
          {render(currencyRows.slice(0, limit))}
        </div>
      ))}
    </div>
  );
}

/**
 * The one hero figure on the page. Nothing else is set this large, because a
 * second hero is not a hero.
 */
function MrrCard({ metrics }: { metrics: OverviewMetrics }) {
  const live =
    metrics.subscriptions.active + metrics.subscriptions.trialing + metrics.subscriptions.gracePeriod;

  return (
    <Card className="flex flex-col px-5 py-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Monthly recurring revenue
      </p>
      {metrics.mrr.length === 0 ? (
        <p className="mt-3 text-4xl font-semibold leading-none tracking-tight">—</p>
      ) : (
        <div className="mt-3 space-y-1.5">
          {metrics.mrr.map((row) => (
            <p key={row.currency} className="text-4xl font-semibold leading-none tracking-tight">
              {formatAmount(row.amount, row.currency)}
            </p>
          ))}
        </div>
      )}
      <p className="mt-2.5 text-xs text-muted-foreground">
        Normalised from each subscription&rsquo;s own billing interval.
      </p>

      {/* Two figures MRR is meaningless without: what it is spread across, and
          how fast that base is leaking. `mt-auto` puts them against the bottom
          of the card, which is as tall as the chart beside it. */}
      <dl className="mt-auto grid grid-cols-2 gap-4 border-t border-border pt-4">
        <div>
          <dt className="text-xs text-muted-foreground">Live subscriptions</dt>
          <dd className="tabular mt-1 text-xl font-semibold leading-none">{live}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Churn</dt>
          <dd
            className={cn(
              "tabular mt-1 text-xl font-semibold leading-none",
              metrics.churnRate !== null && metrics.churnRate > 10 && "text-destructive"
            )}
          >
            {metrics.churnRate === null ? "—" : `${metrics.churnRate}%`}
          </dd>
        </div>
      </dl>
      <p className="mt-2 text-xs text-muted-foreground">
        {metrics.subscriptions.canceledInWindow} cancelled in this window ·{" "}
        {metrics.customers.total} customers
      </p>
    </Card>
  );
}

/** Money, one line per currency — never one line with a total across them. */
function AmountStack({ rows }: { rows: { currency: string; amount: number }[] }) {
  if (rows.length === 0) return <>—</>;
  return (
    <span className="flex flex-col gap-0.5">
      {rows.map((row) => (
        <span key={row.currency}>{formatAmount(row.amount, row.currency)}</span>
      ))}
    </span>
  );
}

/**
 * Shown when the timeseries call fails but the scalar metrics did. The card
 * says the chart is missing rather than drawing an empty plot, which would
 * read as "you have no revenue" when it means "the request did not land".
 */
function ChartUnavailable({ title }: { title: string }) {
  return (
    <Card className="flex min-h-[220px] flex-col items-center justify-center gap-1.5 p-6 text-center">
      <p className="text-sm font-medium">{title}</p>
      <p className="max-w-xs text-xs text-muted-foreground">
        The chart data could not be loaded. The figures above are unaffected.
      </p>
    </Card>
  );
}
