import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DescriptionList, EmptyState, Mono, PageHeader } from "@/components/ui/shell";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { apiFetchOrNull } from "@/lib/api";
import { formatAmount, formatDate, formatDateTime } from "@/lib/format";
import { emptyPage, type Paged } from "@/lib/list";
import type { Customer, EmailMessage } from "@/lib/types";

export const metadata: Metadata = { title: "Customer" };

/** Mirrors MAX_EMAIL_ATTEMPTS in packages/notifications/src/service.ts. */
const MAX_EMAIL_ATTEMPTS = 5;

export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [customer, emailPage] = await Promise.all([
    apiFetchOrNull<Customer>(`/v1/customers/${id}`),
    apiFetchOrNull<Paged<EmailMessage>>(`/v1/emails?customerId=${id}&limit=10`),
  ]);
  if (!customer) notFound();

  const emails = (emailPage ?? emptyPage<EmailMessage>()).items;
  const latest = emails[0];
  const deliveryFailing = latest?.status === "FAILED";

  return (
    <>
      <PageHeader title={customer.name ?? customer.email} description={customer.email} />

      {deliveryFailing ? (
        <p role="alert" className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {latest.attempts >= MAX_EMAIL_ATTEMPTS
            ? `We've tried ${latest.attempts} times and could not deliver mail to ${customer.email} — last error: "${latest.failureReason}". If this address has a typo, the customer's next email will only go through once it's corrected.`
            : `The last message to ${customer.email} was refused (attempt ${latest.attempts} of ${MAX_EMAIL_ATTEMPTS}) — "${latest.failureReason}". Retrying automatically; this may mean the address is wrong.`}
        </p>
      ) : null}

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

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Emails</CardTitle>
        </CardHeader>
        <CardContent className="px-0 pb-0">
          {emails.length > 0 ? (
            <Table>
              <THead>
                <TR>
                  <TH>Subject</TH>
                  <TH>Sent</TH>
                  <TH>Status</TH>
                </TR>
              </THead>
              <TBody>
                {emails.map((message) => (
                  <TR key={message.id}>
                    <TD>{message.subject}</TD>
                    <TD className="tabular text-muted-foreground">
                      {formatDateTime(message.sentAt ?? message.createdAt)}
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
          ) : (
            <div className="px-5 pb-5">
              <EmptyState title="Nothing sent yet" description="Nothing has needed to email this customer yet." />
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}
