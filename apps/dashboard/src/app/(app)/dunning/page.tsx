import type { Metadata } from "next";
import Link from "next/link";
import { retryInvoice } from "@/actions/billing";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DescriptionList, EmptyState, Mono, PageHeader, Stat } from "@/components/ui/shell";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { apiFetchOrNull } from "@/lib/api";
import { formatAmount, formatDate, relativeDays, titleCase } from "@/lib/format";
import type { BillingSettings, Invoice, Subscription } from "@/lib/types";

export const metadata: Metadata = { title: "Dunning" };

export default async function DunningPage() {
  const [settings, inGrace, unpaidSubs, openInvoices] = await Promise.all([
    apiFetchOrNull<BillingSettings>("/v1/billing-settings"),
    apiFetchOrNull<Subscription[]>("/v1/subscriptions?status=GRACE_PERIOD&limit=100"),
    apiFetchOrNull<Subscription[]>("/v1/subscriptions?status=UNPAID&limit=100"),
    apiFetchOrNull<Invoice[]>("/v1/invoices?status=OPEN&limit=100"),
  ]);

  const grace = inGrace ?? [];
  const unpaid = unpaidSubs ?? [];
  const outstanding = openInvoices ?? [];

  return (
    <>
      <PageHeader
        title="Dunning"
        description="Recovery runs on your policy, not ours. These values are read at the moment a payment fails and frozen onto the subscription, so changing them never alters a grace period already running."
      />

      <section aria-label="Recovery summary" className="grid gap-4 sm:grid-cols-3">
        <Stat
          label="In grace period"
          value={grace.length}
          sub="Failed, still recoverable"
          tone={grace.length > 0 ? "warning" : "default"}
        />
        <Stat
          label="Marked unpaid"
          value={unpaid.length}
          sub="Grace period exhausted"
          tone={unpaid.length > 0 ? "danger" : "default"}
        />
        <Stat label="Open invoices" value={outstanding.length} sub="Awaiting collection" />
      </section>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Your configured policy</CardTitle>
        </CardHeader>
        <CardContent>
          {settings ? (
            <>
              <DescriptionList
                items={[
                  { label: "Grace period", value: `${settings.gracePeriodDays} days` },
                  { label: "Access during grace", value: titleCase(settings.accessDuringGracePeriod) },
                  { label: "Maximum retries", value: settings.maxRetryAttempts },
                  {
                    label: "Retry schedule",
                    value: settings.retryIntervals.length
                      ? settings.retryIntervals.map((d) => (d === 0 ? "immediately" : `day ${d}`)).join(", ")
                      : "—",
                  },
                  { label: "When recovery fails", value: titleCase(settings.failureAction) },
                  {
                    label: "Abandoned checkout expires",
                    value:
                      settings.incompleteExpiryHours === 0
                        ? "Never"
                        : `after ${settings.incompleteExpiryHours} hours`,
                  },
                ]}
              />
              <p className="mt-5 text-xs leading-relaxed text-muted-foreground">
                The scheduled retry ladder is phase 4. Grace periods open and close on this policy today;
                retries are triggered from an invoice or through <Mono>POST /v1/invoices/:id/pay</Mono>.{" "}
                <Link href="/settings" className="underline underline-offset-4">
                  Change the policy
                </Link>
                .
              </p>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">Could not load billing settings.</p>
          )}
        </CardContent>
      </Card>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Customers in a grace period</CardTitle>
        </CardHeader>
        <CardContent className="px-0 pb-0">
          {grace.length === 0 ? (
            <div className="px-5 pb-5">
              <EmptyState title="Nobody is behind" description="No subscription is currently in recovery." />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Customer</TH>
                  <TH>Plan</TH>
                  <TH>Grace ends</TH>
                  <TH>Then</TH>
                  <TH>Status</TH>
                </TR>
              </THead>
              <TBody>
                {grace.map((sub) => (
                  <TR key={sub.id}>
                    <TD>
                      <Link href={`/subscriptions/${sub.id}`} className="underline-offset-4 hover:underline">
                        {sub.customer?.externalId ?? sub.customer?.email ?? "—"}
                      </Link>
                    </TD>
                    <TD className="text-muted-foreground">{sub.price?.plan?.name ?? "—"}</TD>
                    <TD className="tabular">
                      {formatDate(sub.gracePeriodEnd)}
                      <span className="block text-xs text-muted-foreground">
                        {relativeDays(sub.gracePeriodEnd)}
                      </span>
                    </TD>
                    <TD className="text-muted-foreground">
                      {titleCase(sub.gracePolicy?.failureAction ?? "MARK_UNPAID")}
                    </TD>
                    <TD>
                      <StatusBadge status={sub.status} />
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Open invoices</CardTitle>
        </CardHeader>
        <CardContent className="px-0 pb-0">
          {outstanding.length === 0 ? (
            <p className="px-5 pb-5 text-sm text-muted-foreground">Nothing outstanding.</p>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Number</TH>
                  <TH>Due</TH>
                  <TH>Issued</TH>
                  <TH />
                </TR>
              </THead>
              <TBody>
                {outstanding.map((invoice) => (
                  <TR key={invoice.id}>
                    <TD>
                      <Link
                        href={`/invoices/${invoice.id}`}
                        className="font-mono text-xs underline-offset-4 hover:underline"
                      >
                        {invoice.invoiceNumber}
                      </Link>
                    </TD>
                    <TD className="tabular">{formatAmount(invoice.amountDue, invoice.currency)}</TD>
                    <TD className="tabular text-muted-foreground">{formatDate(invoice.createdAt)}</TD>
                    <TD className="text-right">
                      <form action={retryInvoice}>
                        <input type="hidden" name="invoiceId" value={invoice.id} />
                        <Button type="submit" variant="outline" size="sm">
                          Retry
                        </Button>
                      </form>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </>
  );
}
