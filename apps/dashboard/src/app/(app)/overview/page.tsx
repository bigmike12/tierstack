import type { Metadata } from "next";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, PageHeader, Stat } from "@/components/ui/shell";
import { CustomerCell } from "@/components/customer-cell";
import { StatusBadge } from "@/components/status-badge";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { apiFetchOrNull } from "@/lib/api";
import { formatAmount, formatDate } from "@/lib/format";
import type { Paged } from "@/lib/list";
import type { Invoice, OverviewMetrics, Subscription } from "@/lib/types";

export const metadata: Metadata = { title: "Overview" };

export default async function OverviewPage() {
  const [metrics, subscriptionPage, invoicePage] = await Promise.all([
    apiFetchOrNull<OverviewMetrics>("/v1/metrics/overview"),
    apiFetchOrNull<Paged<Subscription>>("/v1/subscriptions?limit=6"),
    apiFetchOrNull<Paged<Invoice>>("/v1/invoices?limit=6"),
  ]);

  const subscriptions = subscriptionPage?.items ?? null;
  const invoices = invoicePage?.items ?? null;

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

  const hasAnything = metrics.customers.total > 0 || metrics.subscriptions.active > 0;

  return (
    <>
      <PageHeader
        title="Overview"
        description={`Computed directly from PostgreSQL over the last ${metrics.windowDays} days. Money is reported per currency — summing across currencies would not mean anything.`}
      />

      {!hasAnything ? (
        <EmptyState
          title="Nothing has been billed yet"
          description="Create a plan and a price, then subscribe a customer. With the mock provider configured you can run the whole lifecycle without any provider credentials."
        />
      ) : null}

      <section aria-label="Key metrics" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="MRR"
          value={
            metrics.mrr.length === 0 ? (
              "—"
            ) : (
              <span className="flex flex-col gap-0.5">
                {metrics.mrr.map((row) => (
                  <span key={row.currency}>{formatAmount(row.amount, row.currency)}</span>
                ))}
              </span>
            )
          }
          sub="Normalised from each subscription's own interval"
        />
        <Stat
          label="Active subscriptions"
          value={metrics.subscriptions.active}
          sub={`${metrics.subscriptions.trialing} trialing · ${metrics.subscriptions.incomplete} never paid`}
        />
        <Stat
          label="Revenue collected"
          value={
            metrics.revenue.length === 0 ? (
              "—"
            ) : (
              <span className="flex flex-col gap-0.5">
                {metrics.revenue.map((row) => (
                  <span key={row.currency}>{formatAmount(row.amount, row.currency)}</span>
                ))}
              </span>
            )
          }
          sub={`${metrics.revenue.reduce((sum, r) => sum + r.invoices, 0)} invoices paid`}
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
      </section>

      <section aria-label="Secondary metrics" className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          label="Outstanding"
          value={
            metrics.outstanding.length === 0 ? (
              "—"
            ) : (
              <span className="flex flex-col gap-0.5">
                {metrics.outstanding.map((row) => (
                  <span key={row.currency}>{formatAmount(row.amount, row.currency)}</span>
                ))}
              </span>
            )
          }
          sub={`${metrics.outstanding.reduce((sum, r) => sum + r.invoices, 0)} open invoices`}
          tone={metrics.outstanding.length > 0 ? "warning" : "default"}
        />
        <Stat
          label="In grace period"
          value={metrics.subscriptions.gracePeriod}
          sub="Failed payment, still recoverable"
          tone={metrics.subscriptions.gracePeriod > 0 ? "warning" : "default"}
        />
        <Stat label="New customers" value={metrics.customers.new} sub={`${metrics.customers.total} in total`} />
        <Stat
          label="Churn"
          value={metrics.churnRate === null ? "—" : `${metrics.churnRate}%`}
          sub={`${metrics.subscriptions.canceledInWindow} canceled`}
          tone={metrics.churnRate !== null && metrics.churnRate > 10 ? "danger" : "default"}
        />
      </section>

      <div className="mt-6 grid gap-4 xl:grid-cols-2">
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
      </div>
    </>
  );
}
