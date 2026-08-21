import type { Metadata } from "next";
import Link from "next/link";
import { StatusBadge } from "@/components/status-badge";
import { EmptyState, PageHeader } from "@/components/ui/shell";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { apiFetchOrNull } from "@/lib/api";
import { formatAmount, formatDate } from "@/lib/format";
import type { Invoice } from "@/lib/types";

export const metadata: Metadata = { title: "Invoices" };

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;
  const query = status ? `?status=${encodeURIComponent(status)}&limit=100` : "?limit=100";
  const invoices = (await apiFetchOrNull<Invoice[]>(`/v1/invoices${query}`)) ?? [];

  return (
    <>
      <PageHeader
        title="Invoices"
        description="Every billing cycle produces one. Numbers are sequential per organization per year."
      />

      <div className="flex flex-wrap gap-2 pb-4">
        <Link
          href="/invoices"
          className={`rounded-full border px-3 py-1 text-xs ${!status ? "border-foreground bg-secondary" : "border-border text-muted-foreground hover:bg-muted"}`}
        >
          All
        </Link>
        {["OPEN", "PAID", "VOID", "UNCOLLECTIBLE"].map((filter) => (
          <Link
            key={filter}
            href={`/invoices?status=${filter}`}
            className={`rounded-full border px-3 py-1 text-xs ${status === filter ? "border-foreground bg-secondary" : "border-border text-muted-foreground hover:bg-muted"}`}
          >
            {filter.toLowerCase()}
          </Link>
        ))}
      </div>

      {invoices.length === 0 ? (
        <EmptyState title="No invoices" description="Nothing matches this filter yet." />
      ) : (
        <div className="rounded-lg border border-border bg-card">
          <Table>
            <THead>
              <TR>
                <TH>Number</TH>
                <TH>Period</TH>
                <TH>Total</TH>
                <TH>Paid</TH>
                <TH>Due</TH>
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
                  <TD className="text-muted-foreground">
                    {invoice.billingPeriodStart ? formatDate(invoice.billingPeriodStart) : "—"}
                  </TD>
                  <TD className="tabular">{formatAmount(invoice.total, invoice.currency)}</TD>
                  <TD className="tabular text-muted-foreground">
                    {formatAmount(invoice.amountPaid, invoice.currency)}
                  </TD>
                  <TD className="tabular">{formatAmount(invoice.amountDue, invoice.currency)}</TD>
                  <TD>
                    <StatusBadge status={invoice.status} />
                  </TD>
                  <TD className="tabular text-muted-foreground">{formatDate(invoice.createdAt)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </div>
      )}
    </>
  );
}
