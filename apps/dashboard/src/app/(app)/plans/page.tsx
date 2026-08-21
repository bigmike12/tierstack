import type { Metadata } from "next";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, Mono, PageHeader } from "@/components/ui/shell";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { apiFetchOrNull } from "@/lib/api";
import { describeInterval, formatAmount, titleCase } from "@/lib/format";
import type { Plan } from "@/lib/types";

export const metadata: Metadata = { title: "Plans" };

export default async function PlansPage() {
  const plans = (await apiFetchOrNull<Plan[]>("/v1/plans")) ?? [];

  return (
    <>
      <PageHeader
        title="Plans and prices"
        description="A plan is the product; a price is one way to buy it. Several prices on one plan is how multiple currencies and billing intervals work without duplicating the plan."
      />

      {plans.length === 0 ? (
        <EmptyState
          title="No plans yet"
          description="Create one with POST /v1/plans, then attach prices to it."
        />
      ) : (
        <div className="space-y-4">
          {plans.map((plan) => (
            <Card key={plan.id}>
              <CardHeader className="flex-row items-start justify-between gap-4">
                <div className="space-y-1">
                  <CardTitle className="flex items-center gap-2 text-base">
                    {plan.name}
                    <Mono>{plan.code}</Mono>
                    {!plan.active ? <Badge>Inactive</Badge> : null}
                  </CardTitle>
                  {plan.description ? <CardDescription>{plan.description}</CardDescription> : null}
                </div>
              </CardHeader>

              <CardContent className="space-y-4 px-0 pb-0">
                {plan.prices && plan.prices.length > 0 ? (
                  <Table>
                    <THead>
                      <TR>
                        <TH>Price code</TH>
                        <TH>Model</TH>
                        <TH>Amount</TH>
                        <TH>Billing</TH>
                        <TH>Trial</TH>
                      </TR>
                    </THead>
                    <TBody>
                      {plan.prices.map((price) => (
                        <TR key={price.id}>
                          <TD>
                            <Mono>{price.code}</Mono>
                          </TD>
                          <TD className="text-muted-foreground">{titleCase(price.model)}</TD>
                          <TD className="tabular">
                            {price.unitAmount === null
                              ? "Usage only"
                              : formatAmount(price.unitAmount, price.currency)}
                            {price.model === "PER_SEAT" ? (
                              <span className="text-muted-foreground"> / seat</span>
                            ) : null}
                          </TD>
                          <TD className="text-muted-foreground">
                            {describeInterval(price.intervalUnit, price.intervalCount)}
                          </TD>
                          <TD className="text-muted-foreground">
                            {price.trialDays ? `${price.trialDays} days` : "—"}
                          </TD>
                        </TR>
                      ))}
                    </TBody>
                  </Table>
                ) : (
                  <p className="px-5 pb-5 text-sm text-muted-foreground">No prices on this plan yet.</p>
                )}

                {plan.prices?.some((p) => p.model === "USAGE_METERED" || p.model === "HYBRID") ? (
                  <p className="border-t border-border px-5 py-3 text-xs text-muted-foreground">
                    Usage-metered and hybrid prices can be catalogued, but subscribing to one returns
                    NOT_IMPLEMENTED until the usage engine lands in phase 2 — rather than issuing an
                    invoice that quietly omits the metered charge.
                  </p>
                ) : null}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
