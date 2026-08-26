import type { Metadata } from "next";
import { CustomerPicker } from "@/components/customer-picker";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, Mono, PageHeader } from "@/components/ui/shell";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { apiFetchOrNull } from "@/lib/api";
import { titleCase } from "@/lib/format";
import { emptyPage, type Paged } from "@/lib/list";
import type { Customer, CustomerEntitlements, EntitlementRow, Plan, Subscription } from "@/lib/types";

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

  const [rows, plans, customerList, subscriptionList] = await Promise.all([
    apiFetchOrNull<EntitlementRow[]>("/v1/entitlements"),
    apiFetchOrNull<Plan[]>("/v1/plans"),
    // Only the first page: the picker searches the rest on demand rather than
    // shipping every customer to the browser.
    apiFetchOrNull<Paged<Customer>>("/v1/customers?limit=20"),
    apiFetchOrNull<Paged<Subscription>>("/v1/subscriptions?limit=20"),
  ]);

  const customerPage = customerList ?? emptyPage<Customer>();

  // Subscribers first. Entitlements are only interesting for someone who has a
  // plan, and the twenty most recently created customers usually are not them.
  const subscribers = new Map<string, Customer>();
  for (const subscription of subscriptionList?.items ?? []) {
    const customer = subscription.customer;
    if (customer && !subscribers.has(customer.id)) subscribers.set(customer.id, customer as Customer);
  }
  const customers = [
    ...subscribers.values(),
    ...customerPage.items.filter((customer) => !subscribers.has(customer.id)),
  ];

  const selected = customerId ?? customers[0]?.externalId ?? customers[0]?.id ?? null;
  const selectedCustomer = customers.find(
    (customer) => (customer.externalId ?? customer.id) === selected || customer.id === selected
  );
  const resolved = selected
    ? await apiFetchOrNull<CustomerEntitlements>(
        `/v1/entitlements?customerId=${encodeURIComponent(selected)}`
      )
    : null;

  // A customer reached by URL may not be on the first page, so fall back to
  // whatever the resolver knows about them.
  const resolvedLabel = resolved?.externalId ?? resolved?.customerId ?? null;

  return (
    <>
      <PageHeader
        title="Entitlements"
        description="What each customer may actually do, and how much of their allowance is left."
      />

      {customerPage.total > 0 ? (
        <div className="flex flex-wrap items-center gap-3 pb-4">
          <CustomerPicker
            basePath="/entitlements"
            selected={selected}
            selectedLabel={
              selectedCustomer?.externalId ??
              selectedCustomer?.email ??
              resolvedLabel ??
              selected
            }
            total={customerPage.total}
            initialCustomers={customers}
          />
          <p className="text-xs text-muted-foreground">
            {customerPage.total.toLocaleString()} customer{customerPage.total === 1 ? "" : "s"}
          </p>
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
              Exceptions for one customer or one subscription. The most specific rule wins.
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
