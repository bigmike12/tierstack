import type { Metadata } from "next";
import Link from "next/link";
import { StatusBadge } from "@/components/status-badge";
import { Pagination } from "@/components/ui/pagination";
import { EmptyState, Mono, PageHeader } from "@/components/ui/shell";
import { SearchInput } from "@/components/ui/table-toolbar";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { apiFetchOrNull } from "@/lib/api";
import { describeInterval, formatAmount, formatDate } from "@/lib/format";
import { emptyPage, listQuery, type Paged } from "@/lib/list";
import type { Subscription } from "@/lib/types";

export const metadata: Metadata = { title: "Subscriptions" };

const FILTERS = ["ACTIVE", "TRIALING", "INCOMPLETE", "GRACE_PERIOD", "UNPAID", "CANCELED"];

export default async function SubscriptionsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; page?: string; q?: string }>;
}) {
  const { status, page, q } = await searchParams;

  const result =
    (await apiFetchOrNull<Paged<Subscription>>(
      `/v1/subscriptions${listQuery({ status, page, q, limit: 25 })}`
    )) ?? emptyPage<Subscription>();

  // Changing the filter must reset the page, or filtering from page 6 lands on
  // an empty table.
  const filterHref = (next?: string) =>
    `/subscriptions${listQuery({ status: next, q })}`;

  return (
    <>
      <PageHeader
        title="Subscriptions"
        description="Every status change is recorded with its reason."
      />

      <div className="flex flex-wrap items-center justify-between gap-3 pb-4">
        <div className="flex flex-wrap gap-2">
          <Link
            href={filterHref()}
            className={`rounded-full border px-3 py-1 text-xs ${!status ? "border-foreground bg-secondary" : "border-border text-muted-foreground hover:bg-muted"}`}
          >
            All
          </Link>
          {FILTERS.map((filter) => (
            <Link
              key={filter}
              href={filterHref(filter)}
              className={`rounded-full border px-3 py-1 text-xs ${status === filter ? "border-foreground bg-secondary" : "border-border text-muted-foreground hover:bg-muted"}`}
            >
              {filter.replace("_", " ").toLowerCase()}
            </Link>
          ))}
        </div>
        <SearchInput placeholder="Search customer or plan…" />
      </div>

      {result.items.length === 0 ? (
        <EmptyState
          title="Nothing here"
          description={q ? `No subscriptions match “${q}”.` : "No subscriptions match this filter."}
        />
      ) : (
        <div className="rounded-lg border border-border bg-card">
          <Table>
            <THead>
              <TR>
                <TH>Customer</TH>
                <TH>Plan</TH>
                <TH>Amount</TH>
                <TH>Status</TH>
                <TH>Period ends</TH>
              </TR>
            </THead>
            <TBody>
              {result.items.map((sub) => (
                <TR key={sub.id}>
                  <TD className="max-w-[200px] truncate">
                    <Link href={`/subscriptions/${sub.id}`} className="underline-offset-4 hover:underline">
                      {sub.customer?.externalId ? (
                        <Mono>{sub.customer.externalId}</Mono>
                      ) : (
                        sub.customer?.email ?? "—"
                      )}
                    </Link>
                  </TD>
                  <TD>
                    {sub.price?.plan?.name ?? "—"}
                    <span className="block text-xs text-muted-foreground">
                      {sub.price ? describeInterval(sub.price.intervalUnit, sub.price.intervalCount) : ""}
                      {sub.quantity > 1 ? ` · ${sub.quantity} seats` : ""}
                    </span>
                  </TD>
                  <TD className="tabular">
                    {sub.price?.unitAmount === null || sub.price?.unitAmount === undefined
                      ? "—"
                      : formatAmount(
                          sub.price.model === "PER_SEAT"
                            ? sub.price.unitAmount * sub.quantity
                            : sub.price.unitAmount,
                          sub.price.currency
                        )}
                  </TD>
                  <TD>
                    <div className="flex items-center gap-2">
                      <StatusBadge status={sub.status} />
                      {sub.cancelAtPeriodEnd ? (
                        <span className="text-xs text-muted-foreground">ends at period</span>
                      ) : null}
                    </div>
                  </TD>
                  <TD className="tabular text-muted-foreground">{formatDate(sub.currentPeriodEnd)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
          <Pagination meta={result} basePath="/subscriptions" params={{ status, q }} />
        </div>
      )}
    </>
  );
}
