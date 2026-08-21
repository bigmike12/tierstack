import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cancelSubscription, resumeSubscription } from "@/actions/billing";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DescriptionList, Mono, PageHeader } from "@/components/ui/shell";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { apiFetchOrNull } from "@/lib/api";
import { describeInterval, formatAmount, formatDate, formatDateTime, relativeDays, titleCase } from "@/lib/format";
import type { Invoice, Subscription, SubscriptionTransition } from "@/lib/types";

export const metadata: Metadata = { title: "Subscription" };

export default async function SubscriptionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [subscription, transitions, invoices] = await Promise.all([
    apiFetchOrNull<Subscription>(`/v1/subscriptions/${id}`),
    apiFetchOrNull<SubscriptionTransition[]>(`/v1/subscriptions/${id}/transitions`),
    apiFetchOrNull<Invoice[]>(`/v1/invoices?subscriptionId=${id}&limit=50`),
  ]);
  if (!subscription) notFound();

  const price = subscription.price;
  const recurring =
    price?.unitAmount == null
      ? "—"
      : formatAmount(
          price.model === "PER_SEAT" ? price.unitAmount * subscription.quantity : price.unitAmount,
          price.currency
        );

  const terminal = ["CANCELED", "EXPIRED"].includes(subscription.status);

  return (
    <>
      <PageHeader
        title={price?.plan?.name ?? "Subscription"}
        description={
          <span className="flex items-center gap-2">
            <StatusBadge status={subscription.status} />
            <Mono>{subscription.id}</Mono>
          </span>
        }
        action={
          !terminal ? (
            <div className="flex gap-2">
              {subscription.cancelAtPeriodEnd ? (
                <form action={resumeSubscription}>
                  <input type="hidden" name="subscriptionId" value={subscription.id} />
                  <Button type="submit" variant="outline" size="sm">
                    Revoke cancellation
                  </Button>
                </form>
              ) : (
                <form action={cancelSubscription}>
                  <input type="hidden" name="subscriptionId" value={subscription.id} />
                  <input type="hidden" name="atPeriodEnd" value="true" />
                  <Button type="submit" variant="outline" size="sm">
                    Cancel at period end
                  </Button>
                </form>
              )}
              <form action={cancelSubscription}>
                <input type="hidden" name="subscriptionId" value={subscription.id} />
                <input type="hidden" name="atPeriodEnd" value="false" />
                <Button type="submit" variant="destructive" size="sm">
                  Cancel now
                </Button>
              </form>
            </div>
          ) : null
        }
      />

      {subscription.status === "INCOMPLETE" ? (
        <p className="mb-4 rounded-md border border-border bg-muted px-4 py-3 text-sm text-muted-foreground">
          This subscription has never been paid for. It has no grace period and grants no entitlements —
          a customer who never paid is not the same as one who lapsed.
        </p>
      ) : null}

      {subscription.status === "GRACE_PERIOD" && subscription.gracePeriodEnd ? (
        <p className="mb-4 rounded-md border border-warning/30 bg-warning/10 px-4 py-3 text-sm">
          In its grace period until <strong>{formatDate(subscription.gracePeriodEnd)}</strong> (
          {relativeDays(subscription.gracePeriodEnd)}). When it expires the configured action is{" "}
          <strong>{titleCase(subscription.gracePolicy?.failureAction ?? "MARK_UNPAID")}</strong>.
        </p>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle>Billing</CardTitle>
          </CardHeader>
          <CardContent>
            <DescriptionList
              items={[
                { label: "Plan", value: price?.plan?.name ?? "—" },
                { label: "Price", value: price ? <Mono>{price.code}</Mono> : "—" },
                { label: "Recurring amount", value: <span className="tabular">{recurring}</span> },
                {
                  label: "Interval",
                  value: price ? describeInterval(price.intervalUnit, price.intervalCount) : "—",
                },
                { label: "Quantity", value: subscription.quantity },
                { label: "Current period", value: `${formatDate(subscription.currentPeriodStart)} → ${formatDate(subscription.currentPeriodEnd)}` },
                { label: "Next billing date", value: formatDate(subscription.currentPeriodEnd) },
                {
                  label: "Payment method",
                  value: subscription.paymentMethod
                    ? `${subscription.paymentMethod.brand?.toUpperCase() ?? subscription.paymentMethod.type} •••• ${subscription.paymentMethod.last4 ?? "????"}`
                    : "None stored",
                },
              ]}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Customer</CardTitle>
          </CardHeader>
          <CardContent>
            <DescriptionList
              items={[
                {
                  label: "Your id",
                  value: subscription.customer?.externalId ? (
                    <Mono>{subscription.customer.externalId}</Mono>
                  ) : (
                    "—"
                  ),
                },
                { label: "Email", value: subscription.customer?.email ?? "—" },
                {
                  label: "Profile",
                  value: subscription.customer ? (
                    <Link
                      href={`/customers/${subscription.customer.id}`}
                      className="underline underline-offset-4"
                    >
                      Open
                    </Link>
                  ) : (
                    "—"
                  ),
                },
              ]}
            />
          </CardContent>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Invoices</CardTitle>
        </CardHeader>
        <CardContent className="px-0 pb-0">
          {invoices && invoices.length > 0 ? (
            <Table>
              <THead>
                <TR>
                  <TH>Number</TH>
                  <TH>Period</TH>
                  <TH>Total</TH>
                  <TH>Due</TH>
                  <TH>Status</TH>
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
                    <TD className="tabular">{formatAmount(invoice.amountDue, invoice.currency)}</TD>
                    <TD>
                      <StatusBadge status={invoice.status} />
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          ) : (
            <p className="px-5 pb-5 text-sm text-muted-foreground">No invoices yet.</p>
          )}
        </CardContent>
      </Card>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Activity</CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="space-y-3">
            {(transitions ?? []).map((event) => (
              <li key={event.id} className="flex gap-3 text-sm">
                <span aria-hidden className="mt-1.5 size-1.5 shrink-0 rounded-full bg-muted-foreground" />
                <div className="min-w-0">
                  <p>
                    {event.fromStatus && event.fromStatus !== event.toStatus ? (
                      <>
                        <span className="text-muted-foreground">{titleCase(event.fromStatus)}</span>
                        <span className="px-1.5 text-muted-foreground">→</span>
                      </>
                    ) : null}
                    <span className="font-medium">{titleCase(event.toStatus)}</span>
                    <span className="pl-2 text-muted-foreground">{event.reason.replace(/_/g, " ")}</span>
                  </p>
                  <p className="text-xs text-muted-foreground">{formatDateTime(event.createdAt)}</p>
                </div>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>
    </>
  );
}
