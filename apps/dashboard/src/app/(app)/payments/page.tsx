import type { Metadata } from "next";
import Link from "next/link";
import { StatusBadge } from "@/components/status-badge";
import { Pagination } from "@/components/ui/pagination";
import { EmptyState, Mono, PageHeader } from "@/components/ui/shell";
import { SearchInput } from "@/components/ui/table-toolbar";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { apiFetchOrNull } from "@/lib/api";
import { formatAmount, formatDateTime } from "@/lib/format";
import { emptyPage, listQuery, type Paged } from "@/lib/list";
import type { PaymentAttempt } from "@/lib/types";

export const metadata: Metadata = { title: "Payments" };

export default async function PaymentsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; q?: string }>;
}) {
  const { page, q } = await searchParams;

  const result =
    (await apiFetchOrNull<Paged<PaymentAttempt>>(
      `/v1/payment-attempts${listQuery({ page, q, limit: 25 })}`
    )) ?? emptyPage<PaymentAttempt>();

  return (
    <>
      <PageHeader
        title="Payments"
        description="Every attempt to collect an invoice, in order. Nothing here is ever rewritten — this is the audit trail a payment dispute is settled with."
      />

      <div className="flex flex-wrap items-center justify-between gap-3 pb-4">
        <SearchInput placeholder="Search reference or failure…" />
        <p className="tabular text-sm text-muted-foreground">
          {result.total.toLocaleString()} attempt{result.total === 1 ? "" : "s"}
        </p>
      </div>

      {result.items.length === 0 ? (
        <EmptyState
          title="No payment attempts"
          description={q ? `Nothing matches “${q}”.` : "Nothing has been collected yet."}
        />
      ) : (
        <div className="rounded-lg border border-border bg-card">
          <Table>
            <THead>
              <TR>
                <TH>Invoice</TH>
                <TH>Attempt</TH>
                <TH>Provider</TH>
                <TH>Amount</TH>
                <TH>Status</TH>
                <TH>Failure</TH>
                <TH>When</TH>
              </TR>
            </THead>
            <TBody>
              {result.items.map((attempt) => (
                <TR key={attempt.id}>
                  <TD>
                    <Link href={`/invoices/${attempt.invoiceId}`} className="underline-offset-4 hover:underline">
                      <Mono>{attempt.invoiceId.slice(0, 14)}…</Mono>
                    </Link>
                  </TD>
                  <TD className="tabular">#{attempt.attemptNumber}</TD>
                  <TD className="text-muted-foreground">{attempt.provider}</TD>
                  <TD className="tabular">{formatAmount(attempt.amount, attempt.currency)}</TD>
                  <TD>
                    <StatusBadge status={attempt.status} />
                  </TD>
                  <TD className="max-w-[240px] truncate text-muted-foreground">
                    {attempt.failureCode ? `${attempt.failureCode}: ${attempt.failureReason ?? ""}` : "—"}
                  </TD>
                  <TD className="tabular text-muted-foreground">{formatDateTime(attempt.createdAt)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
          <Pagination meta={result} basePath="/payments" params={{ q }} />
        </div>
      )}
    </>
  );
}
