import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, Mono, PageHeader } from "@/components/ui/shell";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { ToastFlash } from "@/components/toast-flash";
import { apiFetchOrNull } from "@/lib/api";
import { describeInterval, formatAmount, titleCase } from "@/lib/format";
import type { Plan } from "@/lib/types";

export const metadata: Metadata = { title: "Plans" };

export default async function PlansPage() {
  // Archived plans are included so they can be found and restored; the list
  // marks them rather than hiding them.
  const plans = (await apiFetchOrNull<Plan[]>("/v1/plans")) ?? [];

  const newPlanLink = (
    <Link href="/plans/new" className={buttonVariants({ size: "sm" })}>
      <Plus aria-hidden />
      New plan
    </Link>
  );

  return (
    <>
      <ToastFlash param="deleted" title="Plan deleted." />
      <PageHeader
        title="Plans and prices"
        description="A plan is the product; a price is one way to buy it. One plan can carry several."
        action={newPlanLink}
      />

      {plans.length === 0 ? (
        <EmptyState
          title="No plans yet"
          description="A plan describes what you sell. Create one, then add the prices customers can buy it at."
          action={newPlanLink}
        />
      ) : (
        <div className="space-y-4">
          {plans.map((plan) => (
            <Card key={plan.id}>
              <CardHeader className="flex-row items-start justify-between gap-4">
                <div className="space-y-1">
                  <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                    <Link href={`/plans/${plan.id}`} className="underline-offset-4 hover:underline">
                      {plan.name}
                    </Link>
                    <Mono>{plan.code}</Mono>
                    {!plan.active ? <Badge>Archived</Badge> : null}
                  </CardTitle>
                  {plan.description ? <CardDescription>{plan.description}</CardDescription> : null}
                </div>
                <Link href={`/plans/${plan.id}`} className={buttonVariants({ variant: "outline", size: "sm" })}>
                  Manage
                </Link>
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
                  <p className="px-5 pb-5 text-sm text-muted-foreground">
                    No prices on this plan yet — it cannot be subscribed to until it has one.{" "}
                    <Link href={`/plans/${plan.id}`} className="underline underline-offset-4">
                      Add a price
                    </Link>
                    .
                  </p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
