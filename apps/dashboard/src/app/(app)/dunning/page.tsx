import type { Metadata } from "next";
import Link from "next/link";
import { retryInvoice } from "@/actions/billing";
import { CustomerCell } from "@/components/customer-cell";
import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DescriptionList, EmptyState, Mono, PageHeader, Stat } from "@/components/ui/shell";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { apiFetchOrNull } from "@/lib/api";
import { formatAmount, formatDate, relativeDays, titleCase } from "@/lib/format";
import { emptyPage, type Paged } from "@/lib/list";
import type { BillingSettings, EmailMessage, Invoice, Subscription } from "@/lib/types";

export const metadata: Metadata = { title: "Dunning" };

/** Mirrors MAX_EMAIL_ATTEMPTS in packages/notifications/src/service.ts. */
const MAX_EMAIL_ATTEMPTS = 5;

export default async function DunningPage({
  searchParams,
}: {
  searchParams: Promise<{ problem?: string }>;
}) {
  const { problem } = await searchParams;
  const [settings, inGrace, unpaidSubs, openInvoices, emails] = await Promise.all([
    apiFetchOrNull<BillingSettings>("/v1/billing-settings"),
    apiFetchOrNull<Paged<Subscription>>("/v1/subscriptions?status=GRACE_PERIOD&limit=50"),
    apiFetchOrNull<Paged<Subscription>>("/v1/subscriptions?status=UNPAID&limit=1"),
    apiFetchOrNull<Paged<Invoice>>("/v1/invoices?status=OPEN&limit=50"),
    apiFetchOrNull<Paged<EmailMessage>>("/v1/emails?limit=15"),
  ]);

  // The counts come from the API's own totals rather than the length of a page,
  // so "3 in grace" stays right when there are more than fit on one page.
  const gracePage = inGrace ?? emptyPage<Subscription>();
  const unpaidPage = unpaidSubs ?? emptyPage<Subscription>();
  const invoicePage = openInvoices ?? emptyPage<Invoice>();
  const grace = gracePage.items;
  const outstanding = invoicePage.items;

  return (
    <>
      <PageHeader
        title="Dunning"
        description="Who is behind, where each one is in the retry schedule, and what they have been told."
      />

      {problem ? (
        <p role="alert" className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {problem}
        </p>
      ) : null}

      <section aria-label="Recovery summary" className="grid gap-4 sm:grid-cols-3">
        <Stat
          label="In grace period"
          value={gracePage.total}
          sub="Failed, still recoverable"
          tone={gracePage.total > 0 ? "warning" : "default"}
        />
        <Stat
          label="Marked unpaid"
          value={unpaidPage.total}
          sub="Grace period exhausted"
          tone={unpaidPage.total > 0 ? "danger" : "default"}
        />
        <Stat label="Open invoices" value={invoicePage.total} sub="Awaiting collection" />
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
              <p className="mt-5 text-xs text-muted-foreground">
                Retries run automatically on this schedule. You can also force one from any open invoice.{" "}
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
                        <CustomerCell customer={sub.customer} />
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
          {gracePage.total > grace.length ? (
            <p className="border-t border-border px-5 py-3 text-xs text-muted-foreground">
              Showing the {grace.length} most recent of {gracePage.total.toLocaleString()} —{" "}
              <Link href="/subscriptions?status=GRACE_PERIOD" className="underline underline-offset-4">
                see all
              </Link>
              .
            </p>
          ) : null}
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
                  <TH>Retries</TH>
                  <TH>Next retry</TH>
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
                    <TD className="tabular text-muted-foreground">
                      {invoice.dunningAttempts
                        ? // dunningAttempts counts the charge that first failed, which was not
                          // a retry — showing it raw reads as "5 of 4" once the ladder is spent.
                          `${Math.min(invoice.dunningAttempts - 1, settings?.maxRetryAttempts ?? 0)} of ${settings?.maxRetryAttempts ?? "—"}`
                        : "—"}
                    </TD>
                    <TD className="tabular text-muted-foreground">
                      {invoice.nextRetryAt ? (
                        <>
                          {formatDate(invoice.nextRetryAt)}
                          <span className="block text-xs">{relativeDays(invoice.nextRetryAt)}</span>
                        </>
                      ) : invoice.dunningAttempts ? (
                        <span className="text-destructive">Attempts exhausted</span>
                      ) : (
                        "—"
                      )}
                    </TD>
                    <TD className="tabular text-muted-foreground">{formatDate(invoice.createdAt)}</TD>
                    <TD className="text-right">
                      <form action={retryInvoice}>
                        <input type="hidden" name="invoiceId" value={invoice.id} />
                        <input type="hidden" name="returnTo" value="/dunning" />
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
          {invoicePage.total > outstanding.length ? (
            <p className="border-t border-border px-5 py-3 text-xs text-muted-foreground">
              Showing the {outstanding.length} most recent of {invoicePage.total.toLocaleString()} —{" "}
              <Link href="/invoices?status=OPEN" className="underline underline-offset-4">
                see all
              </Link>
              .
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>What customers were told</CardTitle>
        </CardHeader>
        <CardContent className="px-0 pb-0">
          {(emails?.items.length ?? 0) === 0 ? (
            <div className="px-5 pb-5">
              <EmptyState
                title="Nothing sent yet"
                description="Failed payments, price changes and trials ending are emailed automatically."
              />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>To</TH>
                  <TH>Subject</TH>
                  <TH>Sent</TH>
                  <TH>Status</TH>
                </TR>
              </THead>
              <TBody>
                {(emails?.items ?? []).map((message) => (
                  <TR key={message.id}>
                    <TD className="text-muted-foreground">{message.toEmail}</TD>
                    <TD>{message.subject}</TD>
                    <TD className="tabular text-muted-foreground">
                      {formatDate(message.sentAt ?? message.createdAt)}
                      {message.provider ? (
                        <span className="block text-xs">via {message.provider.toLowerCase()}</span>
                      ) : null}
                    </TD>
                    <TD>
                      {message.status === "SENT" ? (
                        <Badge tone="success">Sent</Badge>
                      ) : message.status === "SUPPRESSED" ? (
                        <Badge>Email off</Badge>
                      ) : message.status === "FAILED" ? (
                        <Badge tone="danger" title={message.failureReason ?? undefined}>
                          {message.attempts >= MAX_EMAIL_ATTEMPTS ? "Gave up" : "Refused, retrying"}
                        </Badge>
                      ) : (
                        <Badge tone="warning">Pending</Badge>
                      )}
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
