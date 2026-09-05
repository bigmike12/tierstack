import type { Metadata } from "next";
import Link from "next/link";
import { Pencil } from "lucide-react";
import { CustomerPicker } from "@/components/customer-picker";
import { ToastFlash } from "@/components/toast-flash";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, Mono, PageHeader, Stat } from "@/components/ui/shell";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { apiFetchOrNull } from "@/lib/api";
import { formatAmount, formatDate, titleCase } from "@/lib/format";
import { emptyPage, type Paged } from "@/lib/list";
import { currentOrganization, type Customer, type Session, type UsageMeter, type UsageResponse } from "@/lib/types";
import { CreateMeterForm, DeleteMeterForm, ToggleMeterActiveForm } from "./meter-form";

export const metadata: Metadata = { title: "Usage" };

export default async function UsagePage({
  searchParams,
}: {
  searchParams: Promise<{ customerId?: string }>;
}) {
  const { customerId } = await searchParams;

  const [meters, customerList, recentEvents, session] = await Promise.all([
    apiFetchOrNull<UsageMeter[]>("/v1/usage-meters"),
    // Only the first page: the picker searches the rest on demand rather than
    // shipping every customer to the browser.
    apiFetchOrNull<Paged<Customer>>("/v1/customers?limit=20"),
    apiFetchOrNull<Paged<{ customerId: string; customer: Customer }>>("/v1/usage/events?limit=500"),
    apiFetchOrNull<Session>("/v1/auth/me"),
  ]);

  // Matches the org the layout resolves as "current" — the first membership.
  const myRole = session ? currentOrganization(session)?.role : undefined;
  const canCreateMeter = myRole === "OWNER" || myRole === "ADMIN";

  const customerPage = customerList ?? emptyPage<Customer>();

  // Customers who actually have consumption, most recent first and de-duplicated.
  // They come from the events rather than the customer list, because the
  // customers with usage are rarely the twenty most recently created ones.
  const consuming = new Map<string, Customer>();
  for (const event of recentEvents?.items ?? []) {
    if (event.customer && !consuming.has(event.customerId)) consuming.set(event.customerId, event.customer);
  }
  const withUsage = new Set(consuming.keys());

  // Lead with them: landing on an empty state while other customers have usage
  // tells you nothing about whether metering works.
  const customers = [
    ...consuming.values(),
    ...customerPage.items.filter((customer) => !withUsage.has(customer.id)),
  ];

  const selected = customerId ?? customers[0]?.externalId ?? customers[0]?.id ?? null;
  const selectedCustomer = customers.find(
    (customer) => (customer.externalId ?? customer.id) === selected || customer.id === selected
  );

  const usage = selected
    ? await apiFetchOrNull<UsageResponse>(`/v1/usage?customerId=${encodeURIComponent(selected)}`)
    : null;

  return (
    <>
      <ToastFlash param="meterUpdated" title="Meter updated." />
      <ToastFlash param="meterDeleted" title="Meter deleted." />

      <PageHeader
        title="Usage"
        description="Recorded consumption for the current billing period."
      />

      {!meters || meters.length === 0 ? (
        <Card className="mb-4">
          <CardHeader>
            <CardTitle>No meters yet</CardTitle>
            <CardDescription>
              A meter decides how its events are added up. Create one, then attach it to a price to bill
              against it.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {canCreateMeter ? (
              <CreateMeterForm />
            ) : (
              <p className="text-sm text-muted-foreground">
                Ask an organization admin or owner to create one — this is where they&apos;d do it.
              </p>
            )}
          </CardContent>
        </Card>
      ) : (
        <>
          <Card className="mb-4">
            <CardHeader>
              <CardTitle>Meters</CardTitle>
              <CardDescription>
                The meter decides how its events are added up.
              </CardDescription>
            </CardHeader>
            <CardContent className="px-0 pb-0">
              <Table>
                <THead>
                  <TR>
                    <TH>Code</TH>
                    <TH>Name</TH>
                    <TH>Unit</TH>
                    <TH>Aggregation</TH>
                    <TH>Status</TH>
                    {canCreateMeter ? <TH className="text-right">&nbsp;</TH> : null}
                  </TR>
                </THead>
                <TBody>
                  {meters.map((meter) => (
                    <TR key={meter.id}>
                      <TD>
                        <Mono>{meter.code}</Mono>
                      </TD>
                      <TD>{meter.name}</TD>
                      <TD className="text-muted-foreground">{meter.unitLabel ?? "—"}</TD>
                      <TD className="text-muted-foreground">{titleCase(meter.aggregation)}</TD>
                      <TD>
                        {meter.active ? <Badge tone="success">Active</Badge> : <Badge>Inactive</Badge>}
                      </TD>
                      {canCreateMeter ? (
                        <TD className="text-right">
                          <div className="flex justify-end gap-1">
                            <Link href={`/usage/meters/${meter.id}/edit`}>
                              <Button type="button" variant="ghost" size="sm">
                                <Pencil aria-hidden />
                                Edit
                              </Button>
                            </Link>
                            <ToggleMeterActiveForm meterId={meter.id} active={meter.active} />
                            <DeleteMeterForm meterId={meter.id} meterName={meter.name} />
                          </div>
                        </TD>
                      ) : null}
                    </TR>
                  ))}
                </TBody>
              </Table>
            </CardContent>
            {canCreateMeter ? (
              <div className="border-t border-border p-5">
                <p className="mb-3 text-sm font-medium">Add another meter</p>
                <CreateMeterForm />
              </div>
            ) : null}
          </Card>

          {customerPage.total > 0 ? (
            <div className="flex flex-wrap items-center gap-3 pb-4">
              <CustomerPicker
                basePath="/usage"
                selected={selected}
                selectedLabel={
                  selectedCustomer?.externalId ?? selectedCustomer?.email ?? usage?.externalId ?? selected
                }
                total={customerPage.total}
                initialCustomers={customers}
                highlighted={[...withUsage]}
              />
              <p className="text-xs text-muted-foreground">
                A dot marks a customer with usage recorded this period.
              </p>
            </div>
          ) : null}

          {usage && usage.meters.length > 0 ? (
            <>
              <p className="pb-4 text-sm text-muted-foreground">
                Current billing period {formatDate(usage.period.start)} → {formatDate(usage.period.end)}
              </p>

              <div className="grid gap-4 lg:grid-cols-2">
                {usage.meters.map((snapshot) => {
                  const pct =
                    snapshot.included > 0
                      ? Math.min(Math.round((snapshot.used / snapshot.included) * 100), 100)
                      : null;
                  return (
                    <Card key={snapshot.meterId}>
                      <CardHeader className="flex-row items-start justify-between gap-4">
                        <div className="space-y-1">
                          <CardTitle className="text-base">{snapshot.meterName}</CardTitle>
                          <CardDescription>
                            <Mono>{snapshot.meterCode}</Mono> · {titleCase(snapshot.aggregation)}
                          </CardDescription>
                        </div>
                        {/* The cap outranks the allowance: once it has bitten, what the
                            customer owes has stopped tracking what they consumed, and that
                            is the more surprising fact of the two. */}
                        {snapshot.capApplied ? (
                          <Badge tone="info">Cap reached</Badge>
                        ) : snapshot.overage > 0 ? (
                          <Badge tone="warning">Over allowance</Badge>
                        ) : snapshot.included > 0 ? (
                          <Badge tone="success">Within allowance</Badge>
                        ) : (
                          <Badge>Metered</Badge>
                        )}
                      </CardHeader>

                      <CardContent className="space-y-4">
                        <div>
                          <div className="flex items-baseline justify-between gap-4">
                            <span className="tabular text-2xl font-semibold tracking-tight">
                              {snapshot.used.toLocaleString()}
                            </span>
                            <span className="text-sm text-muted-foreground">
                              {snapshot.included > 0
                                ? `of ${snapshot.included.toLocaleString()} ${snapshot.unitLabel ?? "units"} included`
                                : `${snapshot.unitLabel ?? "units"} — no allowance, all billable`}
                            </span>
                          </div>

                          {pct !== null ? (
                            <div
                              role="meter"
                              aria-valuenow={snapshot.used}
                              aria-valuemin={0}
                              aria-valuemax={snapshot.included}
                              aria-label={`${snapshot.meterName} consumption`}
                              className="mt-3 h-2 w-full overflow-hidden rounded-full bg-muted"
                            >
                              <div
                                className={`h-full rounded-full ${
                                  snapshot.overage > 0
                                    ? "bg-warning"
                                    : pct > 85
                                      ? "bg-warning"
                                      : "bg-success"
                                }`}
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                          ) : null}
                        </div>

                        <dl className="grid grid-cols-3 gap-4 text-sm">
                          <div>
                            <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                              Remaining
                            </dt>
                            <dd className="tabular mt-1">{snapshot.remaining.toLocaleString()}</dd>
                          </div>
                          <div>
                            <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                              Overage
                            </dt>
                            <dd className="tabular mt-1">
                              {snapshot.overage.toLocaleString()}
                              {snapshot.overageBlocks > 0 ? (
                                <span className="text-muted-foreground"> · {snapshot.overageBlocks} blocks</span>
                              ) : null}
                            </dd>
                          </div>
                          <div>
                            <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                              Overage cost
                            </dt>
                            <dd className="tabular mt-1">
                              {snapshot.overageAmount === null
                                ? "—"
                                : formatAmount(snapshot.overageAmount, usage.currency ?? "NGN")}
                              {/* Naming the figure the cap replaced is the whole point of
                                  saying anything: a ceiling on its own looks identical
                                  whether it saved the customer ₦20 or ₦2,000,000. */}
                              {snapshot.capApplied &&
                              snapshot.uncappedOverageAmount !== null &&
                              snapshot.uncappedOverageAmount !== undefined ? (
                                <span className="block text-xs font-normal text-muted-foreground">
                                  from {formatAmount(snapshot.uncappedOverageAmount, usage.currency ?? "NGN")}
                                </span>
                              ) : null}
                            </dd>
                          </div>
                        </dl>

                        {snapshot.capApplied ? (
                          <p className="text-xs text-muted-foreground">
                            The cap held this charge at{" "}
                            {formatAmount(snapshot.capAmount ?? 0, usage.currency ?? "NGN")} for the period.
                            Usage keeps being recorded past it — only the charge stops rising.
                          </p>
                        ) : snapshot.overage > 0 ? (
                          <p className="text-xs text-muted-foreground">
                            Billed in arrears, on the invoice that opens the next period.
                          </p>
                        ) : null}
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </>
          ) : (
            <EmptyState
              title="No usage recorded for this customer"
              description="Send events to POST /v1/events/track with a unique eventId, and they will appear here against their billing period."
            />
          )}

          <Card className="mt-4">
            <CardHeader>
              <CardTitle>Recording usage</CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="overflow-x-auto rounded-md border border-border bg-muted/50 p-4 text-xs leading-relaxed">
{`POST /v1/events/track
Authorization: Bearer sk_test_...

{
  "customerId": "user_83921",
  "meter": "${meters[0]?.code ?? "AI_TOKENS"}",
  "units": 1500,
  "eventId": "evt_unique_123"
}`}
              </pre>
              <p className="mt-3 text-xs text-muted-foreground">
                <Mono>eventId</Mono> is unique per organization. Retrying a request that timed out returns{" "}
                <Mono>duplicate: true</Mono> rather than counting the usage twice — a double-counted event is
                a double charge.
              </p>
            </CardContent>
          </Card>

          <div className="mt-4">
            <Stat
              label="Meters configured"
              value={meters.length}
              sub="Aggregation is fixed per meter, not per caller"
            />
          </div>
        </>
      )}
    </>
  );
}
