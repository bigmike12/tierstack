import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, Mono, PageHeader, Stat } from "@/components/ui/shell";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { apiFetchOrNull } from "@/lib/api";
import { formatAmount, formatDate, titleCase } from "@/lib/format";
import type { Customer, UsageMeter, UsageResponse } from "@/lib/types";

export const metadata: Metadata = { title: "Usage" };

export default async function UsagePage({
  searchParams,
}: {
  searchParams: Promise<{ customerId?: string }>;
}) {
  const { customerId } = await searchParams;

  const [meters, customerList, recentEvents] = await Promise.all([
    apiFetchOrNull<UsageMeter[]>("/v1/usage-meters"),
    apiFetchOrNull<{ items: Customer[] }>("/v1/customers?limit=100"),
    apiFetchOrNull<{ customerId: string }[]>("/v1/usage/events?limit=500"),
  ]);

  // Lead with customers who actually have consumption — landing on an empty
  // state when other customers have usage tells you nothing.
  const withUsage = new Set((recentEvents ?? []).map((event) => event.customerId));
  const customers = [...(customerList?.items ?? [])].sort((a, b) => {
    const left = withUsage.has(a.id) ? 0 : 1;
    const right = withUsage.has(b.id) ? 0 : 1;
    return left - right;
  });

  const selected = customerId ?? customers[0]?.externalId ?? customers[0]?.id ?? null;

  const usage = selected
    ? await apiFetchOrNull<UsageResponse>(`/v1/usage?customerId=${encodeURIComponent(selected)}`)
    : null;

  return (
    <>
      <PageHeader
        title="Usage"
        description="Consumption is aggregated in PostgreSQL over the events themselves — there is no running counter that could drift away from the record an invoice is built from."
      />

      {!meters || meters.length === 0 ? (
        <EmptyState
          title="No meters yet"
          description="Create one with POST /v1/usage-meters, then attach it to a price to bill against it."
        />
      ) : (
        <>
          <Card className="mb-4">
            <CardHeader>
              <CardTitle>Meters</CardTitle>
              <CardDescription>
                The aggregation belongs to the meter, so the entitlement check and the invoice can never
                disagree about what a number means.
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
                    </TR>
                  ))}
                </TBody>
              </Table>
            </CardContent>
          </Card>

          {customers.length > 0 ? (
            <div className="flex flex-wrap gap-2 pb-4">
              {customers.slice(0, 12).map((customer) => {
                const key = customer.externalId ?? customer.id;
                const active = key === selected;
                return (
                  <Link
                    key={customer.id}
                    href={`/usage?customerId=${encodeURIComponent(key)}`}
                    className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs ${
                      active
                        ? "border-foreground bg-secondary"
                        : "border-border text-muted-foreground hover:bg-muted"
                    }`}
                  >
                    {withUsage.has(customer.id) ? (
                      <span aria-label="has usage" className="size-1.5 rounded-full bg-success" />
                    ) : null}
                    {customer.externalId ?? customer.email}
                  </Link>
                );
              })}
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
                        {snapshot.overage > 0 ? (
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
                            </dd>
                          </div>
                        </dl>

                        {snapshot.overage > 0 ? (
                          <p className="text-xs text-muted-foreground">
                            Billed in arrears on the invoice that opens the next period — you cannot invoice
                            for consumption before it happens.
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
