import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { retryInvoice, voidInvoice } from "@/actions/billing";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DescriptionList, Mono, PageHeader } from "@/components/ui/shell";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { apiFetchOrNull } from "@/lib/api";
import { formatAmount, formatDate, formatDateTime, titleCase } from "@/lib/format";
import type { Invoice } from "@/lib/types";

export const metadata: Metadata = { title: "Invoice" };

export default async function InvoicePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ problem?: string }>;
}) {
  const { id } = await params;
  const { problem } = await searchParams;
  const invoice = await apiFetchOrNull<Invoice>(`/v1/invoices/${id}`);
  if (!invoice) notFound();

  const payable = invoice.status === "OPEN" && invoice.amountDue > 0;

  return (
    <>
      <PageHeader
        title={invoice.invoiceNumber}
        description={
          <span className="flex items-center gap-2">
            <StatusBadge status={invoice.status} />
            <span className="text-muted-foreground">
              {invoice.billingPeriodStart
                ? `${formatDate(invoice.billingPeriodStart)} → ${formatDate(invoice.billingPeriodEnd)}`
                : "No billing period"}
            </span>
          </span>
        }
        action={
          payable ? (
            <div className="flex gap-2">
              <form action={retryInvoice}>
                <input type="hidden" name="invoiceId" value={invoice.id} />
                <input type="hidden" name="returnTo" value={`/invoices/${invoice.id}`} />
                <Button type="submit" size="sm">
                  Attempt payment
                </Button>
              </form>
              <form action={voidInvoice}>
                <input type="hidden" name="invoiceId" value={invoice.id} />
                <Button type="submit" variant="outline" size="sm">
                  Void
                </Button>
              </form>
            </div>
          ) : null
        }
      />

      {problem ? (
        <p role="alert" className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {problem}
        </p>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle>Line items</CardTitle>
          </CardHeader>
          <CardContent className="px-0 pb-0">
            <Table>
              <THead>
                <TR>
                  <TH>Description</TH>
                  <TH>Type</TH>
                  <TH className="text-right">Qty</TH>
                  <TH className="text-right">Unit</TH>
                  <TH className="text-right">Amount</TH>
                </TR>
              </THead>
              <TBody>
                {(invoice.lineItems ?? []).map((line) => (
                  <TR key={line.id}>
                    <TD className="max-w-[280px]">{line.description}</TD>
                    <TD className="text-muted-foreground">{titleCase(line.type)}</TD>
                    <TD className="tabular text-right">{line.quantity}</TD>
                    <TD className="tabular text-right text-muted-foreground">
                      {formatAmount(line.unitAmount, line.currency)}
                    </TD>
                    <TD className={`tabular text-right ${line.amount < 0 ? "text-success" : ""}`}>
                      {formatAmount(line.amount, line.currency)}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>

            <dl className="space-y-1.5 border-t border-border px-5 py-4 text-sm">
              <Row label="Subtotal" value={formatAmount(invoice.subtotal, invoice.currency)} />
              {invoice.discountAmount > 0 ? (
                <Row label="Discount" value={`−${formatAmount(invoice.discountAmount, invoice.currency)}`} />
              ) : null}
              {invoice.creditAmount > 0 ? (
                <Row label="Credit applied" value={`−${formatAmount(invoice.creditAmount, invoice.currency)}`} />
              ) : null}
              {invoice.taxAmount > 0 ? (
                <Row label="Tax" value={formatAmount(invoice.taxAmount, invoice.currency)} />
              ) : null}
              <Row label="Total" value={formatAmount(invoice.total, invoice.currency)} strong />
              <Row label="Paid" value={formatAmount(invoice.amountPaid, invoice.currency)} />
              <Row label="Amount due" value={formatAmount(invoice.amountDue, invoice.currency)} strong />
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardContent>
            <DescriptionList
              items={[
                {
                  label: "Customer",
                  value: invoice.customer ? (
                    <Link href={`/customers/${invoice.customer.id}`} className="underline underline-offset-4">
                      {invoice.customer.externalId ?? invoice.customer.email}
                    </Link>
                  ) : (
                    "—"
                  ),
                },
                {
                  label: "Subscription",
                  value: invoice.subscription ? (
                    <Link href={`/subscriptions/${invoice.subscription.id}`} className="underline underline-offset-4">
                      Open
                    </Link>
                  ) : (
                    "One-off"
                  ),
                },
                { label: "Issued", value: formatDate(invoice.createdAt) },
                { label: "Due", value: formatDate(invoice.dueDate) },
                { label: "Paid", value: formatDate(invoice.paidAt) },
                { label: "Invoice id", value: <Mono>{invoice.id}</Mono> },
              ]}
            />
          </CardContent>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Payment attempts</CardTitle>
        </CardHeader>
        <CardContent className="px-0 pb-0">
          {invoice.attempts && invoice.attempts.length > 0 ? (
            <Table>
              <THead>
                <TR>
                  <TH>#</TH>
                  <TH>Provider</TH>
                  <TH>Amount</TH>
                  <TH>Status</TH>
                  <TH>Reason</TH>
                  <TH>When</TH>
                </TR>
              </THead>
              <TBody>
                {invoice.attempts.map((attempt) => (
                  <TR key={attempt.id}>
                    <TD className="tabular">{attempt.attemptNumber}</TD>
                    <TD className="text-muted-foreground">{attempt.provider}</TD>
                    <TD className="tabular">{formatAmount(attempt.amount, attempt.currency)}</TD>
                    <TD>
                      <StatusBadge status={attempt.status} />
                    </TD>
                    <TD className="max-w-[260px] truncate text-muted-foreground">
                      {attempt.failureReason ?? "—"}
                    </TD>
                    <TD className="tabular text-muted-foreground">{formatDateTime(attempt.createdAt)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          ) : (
            <p className="px-5 pb-5 text-sm text-muted-foreground">No payment has been attempted.</p>
          )}
        </CardContent>
      </Card>
    </>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-6">
      <dt className={strong ? "font-medium" : "text-muted-foreground"}>{label}</dt>
      <dd className={`tabular ${strong ? "font-medium" : ""}`}>{value}</dd>
    </div>
  );
}
