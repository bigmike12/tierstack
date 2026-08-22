import type { Metadata } from "next";
import Link from "next/link";
import { Pagination } from "@/components/ui/pagination";
import { EmptyState, Mono, PageHeader } from "@/components/ui/shell";
import { SearchInput } from "@/components/ui/table-toolbar";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { apiFetchOrNull } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { emptyPage, listQuery, type Paged } from "@/lib/list";
import type { Customer } from "@/lib/types";

export const metadata: Metadata = { title: "Customers" };

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; q?: string }>;
}) {
  const { page, q } = await searchParams;

  const result =
    (await apiFetchOrNull<Paged<Customer>>(`/v1/customers${listQuery({ page, q, limit: 25 })}`)) ??
    emptyPage<Customer>();

  return (
    <>
      <PageHeader
        title="Customers"
        description="Your application stays the source of truth for identity. The external id is the join key back to it — most integrations never touch the platform id at all."
      />

      <div className="flex flex-wrap items-center justify-between gap-3 pb-4">
        <SearchInput placeholder="Search id, email or name…" />
        <p className="tabular text-sm text-muted-foreground">
          {result.total.toLocaleString()} customer{result.total === 1 ? "" : "s"}
        </p>
      </div>

      {result.items.length === 0 ? (
        <EmptyState
          title={q ? "No matches" : "No customers yet"}
          description={
            q
              ? `Nothing matches “${q}”.`
              : "Customers are created automatically the first time you subscribe one, so there is usually nothing to do here."
          }
        />
      ) : (
        <div className="rounded-lg border border-border bg-card">
          <Table>
            <THead>
              <TR>
                <TH>External id</TH>
                <TH>Email</TH>
                <TH>Name</TH>
                <TH>Country</TH>
                <TH>Created</TH>
              </TR>
            </THead>
            <TBody>
              {result.items.map((customer) => (
                <TR key={customer.id}>
                  <TD>
                    <Link href={`/customers/${customer.id}`} className="underline-offset-4 hover:underline">
                      {customer.externalId ? <Mono>{customer.externalId}</Mono> : <Mono>{customer.id}</Mono>}
                    </Link>
                  </TD>
                  <TD className="text-muted-foreground">{customer.email}</TD>
                  <TD>{customer.name ?? "—"}</TD>
                  <TD className="text-muted-foreground">{customer.country ?? "—"}</TD>
                  <TD className="tabular text-muted-foreground">{formatDate(customer.createdAt)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
          <Pagination meta={result} basePath="/customers" params={{ q }} />
        </div>
      )}
    </>
  );
}
