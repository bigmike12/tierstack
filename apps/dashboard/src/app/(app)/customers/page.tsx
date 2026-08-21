import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState, Mono, PageHeader } from "@/components/ui/shell";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { apiFetchOrNull } from "@/lib/api";
import { formatDate } from "@/lib/format";
import type { Customer } from "@/lib/types";

export const metadata: Metadata = { title: "Customers" };

export default async function CustomersPage() {
  const result = await apiFetchOrNull<{ items: Customer[]; nextCursor: string | null }>("/v1/customers?limit=100");
  const customers = result?.items ?? [];

  return (
    <>
      <PageHeader
        title="Customers"
        description="Your application stays the source of truth for identity. The external id is the join key back to it — most integrations never touch the platform id at all."
      />

      {customers.length === 0 ? (
        <EmptyState
          title="No customers yet"
          description="Customers are created automatically the first time you subscribe one, so there is usually nothing to do here."
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
              {customers.map((customer) => (
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
        </div>
      )}
    </>
  );
}
