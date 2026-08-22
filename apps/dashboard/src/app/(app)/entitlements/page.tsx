import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, Mono, PageHeader } from "@/components/ui/shell";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { apiFetchOrNull } from "@/lib/api";
import { titleCase } from "@/lib/format";
import type { Customer, CustomerEntitlements, EntitlementRow, Plan } from "@/lib/types";

export const metadata: Metadata = { title: "Entitlements" };

const REASON_COPY: Record<string, string> = {
  CUSTOMER_OVERRIDE: "Granted by a customer-specific override",
  SUBSCRIPTION_ENTITLEMENT: "Granted on this subscription",
  PLAN_ENTITLEMENT: "Granted by the plan",
  PLAN_FEATURE: "Granted by a plan feature flag",
  USAGE_QUOTA: "Within the included allowance",
  UNLIMITED: "No ceiling",
  QUOTA_EXCEEDED: "Allowance spent",
  FEATURE_DISABLED: "Turned off on this plan",
  FEATURE_NOT_FOUND: "Not part of this plan",
  NO_ACTIVE_SUBSCRIPTION: "No live subscription",
  SUBSCRIPTION_INACTIVE: "Subscription is not active",
  PAYMENT_REQUIRED: "First payment has not settled",
  GRACE_PERIOD_RESTRICTED: "Restricted during the grace period",
  ENTITLEMENT_EXPIRED: "The entitlement has expired",
};

export default async function EntitlementsPage({
  searchParams,
}: {
  searchParams: Promise<{ customerId?: string }>;
}) {
  const { customerId } = await searchParams;

  const [rows, plans, customerList] = await Promise.all([
    apiFetchOrNull<EntitlementRow[]>("/v1/entitlements"),
    apiFetchOrNull<Plan[]>("/v1/plans"),
    apiFetchOrNull<{ items: Customer[] }>("/v1/customers?limit=100"),
  ]);

  const customers = customerList?.items ?? [];
  const selected = customerId ?? customers[0]?.externalId ?? customers[0]?.id ?? null;
  const resolved = selected
    ? await apiFetchOrNull<CustomerEntitlements>(
        `/v1/entitlements?customerId=${encodeURIComponent(selected)}`
      )
    : null;

  return (
    <>
      <PageHeader
        title="Entitlements"
        description="What each customer may actually do. Definitions are cached in Redis; consumption is always read live from PostgreSQL, because a stale quota becomes a wrong invoice."
      />

      {customers.length > 0 ? (
        <div className="flex flex-wrap gap-2 pb-4">
          {customers.slice(0, 12).map((customer) => {
            const key = customer.externalId ?? customer.id;
            return (
              <Link
                key={customer.id}
                href={`/entitlements?customerId=${encodeURIComponent(key)}`}
                className={`rounded-full border px-3 py-1 text-xs ${
                  key === selected
                    ? "border-foreground bg-secondary"
                    : "border-border text-muted-foreground hover:bg-muted"
                }`}
              >
                {customer.externalId ?? customer.email}
              </Link>
            );
          })}
        </div>
      ) : null}

      {resolved ? (
        <Card className="mb-4">
          <CardHeader>
            <CardTitle>
              Resolved for {resolved.externalId ? <Mono>{resolved.externalId}</Mono> : resolved.customerId}
            </CardTitle>
            <CardDescription>
              {resolved.context.status
                ? `Subscription is ${titleCase(resolved.context.status)}. Grace-period access is ${titleCase(
                    resolved.context.accessDuringGracePeriod
                  )}.`
                : "This customer has no live subscription, so nothing is granted."}
            </CardDescription>
          </CardHeader>
          <CardContent className="px-0 pb-0">
            {resolved.features.length === 0 ? (
              <p className="px-5 pb-5 text-sm text-muted-foreground">
                No features are defined for this customer&apos;s plan.
              </p>
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>Feature</TH>
                    <TH>Access</TH>
                    <TH>Used</TH>
                    <TH>Remaining</TH>
                    <TH>Why</TH>
                  </TR>
                </THead>
                <TBody>
                  {resolved.features.map((feature) => (
                    <TR key={feature.featureKey}>
                      <TD>
                        <Mono>{feature.featureKey}</Mono>
                      </TD>
                      <TD>
                        {feature.access ? (
                          <Badge tone={feature.restricted ? "warning" : "success"}>
                            {feature.restricted ? "Restricted" : "Allowed"}
                          </Badge>
                        ) : (
                          <Badge tone="danger">Denied</Badge>
                        )}
                      </TD>
                      <TD className="tabular text-muted-foreground">
                        {feature.used === null || feature.used === undefined
                          ? "—"
                          : feature.used.toLocaleString()}
                      </TD>
                      <TD className="tabular">
                        {feature.remainingQuota !== null
                          ? feature.remainingQuota.toLocaleString()
                          : feature.reason === "UNLIMITED"
                            ? "unlimited"
                            : /* a boolean feature has no quantity at all */ "—"}
                      </TD>
                      <TD className="text-muted-foreground">
                        {REASON_COPY[feature.reason] ?? feature.reason}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
            <p className="border-t border-border px-5 py-3 text-xs text-muted-foreground">
              Your application asks the same question with{" "}
              <Mono>POST /v1/entitlements/check</Mono>.
            </p>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Plan feature flags</CardTitle>
            <CardDescription>
              The quickest way to describe what a plan includes — no entitlement rows needed. A number
              becomes a limit, <Mono>&quot;unlimited&quot;</Mono> removes the ceiling, a boolean toggles the
              feature.
            </CardDescription>
          </CardHeader>
          <CardContent className="px-0 pb-0">
            {plans && plans.length > 0 ? (
              <Table>
                <THead>
                  <TR>
                    <TH>Plan</TH>
                    <TH>Features</TH>
                  </TR>
                </THead>
                <TBody>
                  {plans.map((plan) => {
                    const entries = Object.entries(plan.features ?? {});
                    return (
                      <TR key={plan.id}>
                        <TD>{plan.name}</TD>
                        <TD>
                          {entries.length === 0 ? (
                            <span className="text-muted-foreground">None</span>
                          ) : (
                            <div className="flex flex-wrap gap-1.5">
                              {entries.map(([key, value]) => (
                                <Badge key={key} tone={value === false ? "neutral" : "info"}>
                                  {key}
                                  {typeof value === "number" ? `: ${value}` : ""}
                                  {value === false ? ": off" : ""}
                                </Badge>
                              ))}
                            </div>
                          )}
                        </TD>
                      </TR>
                    );
                  })}
                </TBody>
              </Table>
            ) : (
              <p className="px-5 pb-5 text-sm text-muted-foreground">No plans yet.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Explicit entitlements</CardTitle>
            <CardDescription>
              Rows that override the plan. A customer-specific entitlement beats the subscription, which
              beats the plan — that is how support grants one exception without editing a plan everyone
              else is on.
            </CardDescription>
          </CardHeader>
          <CardContent className="px-0 pb-0">
            {rows && rows.length > 0 ? (
              <Table>
                <THead>
                  <TR>
                    <TH>Feature</TH>
                    <TH>Type</TH>
                    <TH>Value</TH>
                    <TH>Applies to</TH>
                  </TR>
                </THead>
                <TBody>
                  {rows.map((row) => (
                    <TR key={row.id}>
                      <TD>
                        <Mono>{row.featureKey}</Mono>
                      </TD>
                      <TD className="text-muted-foreground">{titleCase(row.type)}</TD>
                      <TD className="tabular">
                        {row.type === "BOOLEAN"
                          ? row.booleanValue
                            ? "on"
                            : "off"
                          : row.type === "UNLIMITED"
                            ? "unlimited"
                            : (row.limitValue?.toLocaleString() ?? "—")}
                      </TD>
                      <TD className="text-muted-foreground">
                        {row.customer
                          ? `Customer ${row.customer.externalId ?? row.customer.email}`
                          : row.plan
                            ? `Plan ${row.plan.name}`
                            : "Subscription"}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            ) : (
              <div className="px-5 pb-5">
                <EmptyState
                  title="No overrides"
                  description="Every entitlement currently comes from a plan's feature flags."
                />
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
