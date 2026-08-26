import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { StatusBadge } from "@/components/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DescriptionList, Mono, PageHeader } from "@/components/ui/shell";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { apiFetchOrNull } from "@/lib/api";
import { formatAmount, formatDate } from "@/lib/format";
import type { Customer } from "@/lib/types";

export const metadata: Metadata = { title: "Customer" };

export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const customer = await apiFetchOrNull<Customer>(`/v1/customers/${id}`);
  if (!customer) notFound();

  return (
    <>
      <PageHeader title={customer.name ?? customer.email} description={customer.email} />

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle>Identity</CardTitle>
          </CardHeader>
          <CardContent>
            <DescriptionList
              items={[
                { label: "Your id", value: customer.externalId ? <Mono>{customer.externalId}</Mono> : "—" },
                { label: "Platform id", value: <Mono>{customer.id}</Mono> },
                { label: "Email", value: customer.email },
                { label: "Phone", value: customer.phone ?? "—" },
                { label: "Country", value: customer.country ?? "—" },
                { label: "Currency", value: customer.currency ?? "—" },
                { label: "Created", value: formatDate(customer.createdAt) },
              ]}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Payment methods</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {customer.paymentMethods && customer.paymentMethods.length > 0 ? (
              customer.paymentMethods.map((method) => (
                <div key={method.id} className="rounded-md border border-border px-3 py-2 text-sm">
                  <p className="font-medium">
                    {method.brand ? method.brand.toUpperCase() : method.type}
                    {method.last4 ? ` •••• ${method.last4}` : ""}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {method.provider}
                    {method.expMonth && method.expYear
                      ? ` · expires ${String(method.expMonth).padStart(2, "0")}/${method.expYear}`
                      : ""}
                    {method.isDefault ? " · default" : ""}
                  </p>
                </div>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">
                None stored.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Subscriptions</CardTitle>
        </CardHeader>
        <CardContent className="px-0 pb-0">
          {customer.subscriptions && customer.subscriptions.length > 0 ? (
            <Table>
              <THead>
                <TR>
                  <TH>Plan</TH>
                  <TH>Status</TH>
                  <TH>Qty</TH>
                  <TH>Current period ends</TH>
                </TR>
              </THead>
              <TBody>
                {customer.subscriptions.map((sub) => (
                  <TR key={sub.id}>
                    <TD>
                      <Link href={`/subscriptions/${sub.id}`} className="underline-offset-4 hover:underline">
                        {sub.price?.plan?.name ?? "—"}
                      </Link>
                    </TD>
                    <TD>
                      <StatusBadge status={sub.status} />
                    </TD>
                    <TD className="tabular">{sub.quantity}</TD>
                    <TD className="tabular text-muted-foreground">{formatDate(sub.currentPeriodEnd)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          ) : (
            <p className="px-5 pb-5 text-sm text-muted-foreground">No subscriptions.</p>
          )}
        </CardContent>
      </Card>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Invoices</CardTitle>
        </CardHeader>
        <CardContent className="px-0 pb-0">
          {customer.invoices && customer.invoices.length > 0 ? (
            <Table>
              <THead>
                <TR>
                  <TH>Number</TH>
                  <TH>Total</TH>
                  <TH>Due</TH>
                  <TH>Status</TH>
                  <TH>Issued</TH>
                </TR>
              </THead>
              <TBody>
                {customer.invoices.map((invoice) => (
                  <TR key={invoice.id}>
                    <TD>
                      <Link href={`/invoices/${invoice.id}`} className="font-mono text-xs underline-offset-4 hover:underline">
                        {invoice.invoiceNumber}
                      </Link>
                    </TD>
                    <TD className="tabular">{formatAmount(invoice.total, invoice.currency)}</TD>
                    <TD className="tabular">{formatAmount(invoice.amountDue, invoice.currency)}</TD>
                    <TD>
                      <StatusBadge status={invoice.status} />
                    </TD>
                    <TD className="tabular text-muted-foreground">{formatDate(invoice.createdAt)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          ) : (
            <p className="px-5 pb-5 text-sm text-muted-foreground">No invoices.</p>
          )}
        </CardContent>
      </Card>
    </>
  );
}
