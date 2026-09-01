import type { Metadata } from "next";
import Link from "next/link";
import { StatusBadge } from "@/components/status-badge";
import { Pagination } from "@/components/ui/pagination";
import { EmptyState, PageHeader } from "@/components/ui/shell";
import { SearchInput } from "@/components/ui/table-toolbar";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { apiFetchOrNull } from "@/lib/api";
import { formatAmount, formatDate } from "@/lib/format";
import { emptyPage, listQuery, type Paged } from "@/lib/list";
import type { Invoice } from "@/lib/types";

export const metadata: Metadata = { title: "Invoices" };

const FILTERS = ["OPEN", "PAID", "VOID", "UNCOLLECTIBLE"];

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; page?: string; q?: string }>;
}) {
  const { status, page, q } = await searchParams;

  const result =
    (await apiFetchOrNull<Paged<Invoice>>(`/v1/invoices${listQuery({ status, page, q, limit: 25 })}`)) ??
    emptyPage<Invoice>();

  const filterHref = (next?: string) => `/invoices${listQuery({ status: next, q })}`;

  return (
    <>
      <PageHeader
        title="Invoices"
        description="Every billing cycle produces one. Numbers are sequential per organization per year."
      />

      <div className="flex flex-wrap items-center justify-between gap-3 pb-4">
        <div className="flex flex-wrap gap-2">
          <Link
            href={filterHref()}
            className={`rounded-full border px-3 py-1 text-xs ${!status ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-muted"}`}
          >
            All
          </Link>
          {FILTERS.map((filter) => (
            <Link
              key={filter}
              href={filterHref(filter)}
              className={`rounded-full border px-3 py-1 text-xs ${status === filter ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-muted"}`}
            >
              {filter.toLowerCase()}
            </Link>
          ))}
        </div>
        <SearchInput placeholder="Search number or customer…" />
      </div>

      {result.items.length === 0 ? (
        <EmptyState
          title="No invoices"
          description={q ? `Nothing matches “${q}”.` : "Nothing matches this filter yet."}
        />
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
              {result.items.map((invoice) => (
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
          <Pagination meta={result} basePath="/invoices" params={{ status, q }} />
        </div>
      )}
    </>
  );
}
