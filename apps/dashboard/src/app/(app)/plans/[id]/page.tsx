import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Pencil } from "lucide-react";
import { CURRENCIES } from "@tierstack/shared";
import { archivePrice, setPlanActive } from "@/actions/catalogue";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Mono, PageHeader } from "@/components/ui/shell";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { apiFetchOrNull } from "@/lib/api";
import { describeInterval, formatAmount, titleCase } from "@/lib/format";
import type { Plan, UsageMeter } from "@/lib/types";
import { EditPlanForm } from "../plan-form";
import { CreatePriceForm } from "../price-form";

export const metadata: Metadata = { title: "Plan" };

const CURRENCY_CODES = Object.keys(CURRENCIES);

/** Renders the stored feature map back into the same text the form accepts. */
function featuresToText(features: Record<string, unknown>): string {
  return Object.entries(features ?? {})
    .map(([key, value]) => (value === true ? key : `${key}=${String(value)}`))
    .join("\n");
}

export default async function PlanDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ created?: string }>;
}) {
  const { id } = await params;
  const { created } = await searchParams;

  const [plan, meters] = await Promise.all([
    apiFetchOrNull<Plan>(`/v1/plans/${encodeURIComponent(id)}`),
    apiFetchOrNull<UsageMeter[]>("/v1/usage-meters"),
  ]);
  if (!plan) notFound();

  const prices = plan.prices ?? [];
  const meterById = new Map((meters ?? []).map((meter) => [meter.id, meter]));

  return (
    <>
      <Link
        href="/plans"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden />
        Plans
      </Link>

      <PageHeader
        title={plan.name}
        description={plan.description ?? "No description."}
        action={
          <form action={setPlanActive}>
            <input type="hidden" name="planId" value={plan.id} />
            <input type="hidden" name="active" value={plan.active ? "false" : "true"} />
            <Button type="submit" variant="outline" size="sm">
              {plan.active ? "Archive plan" : "Restore plan"}
            </Button>
          </form>
        }
      />

      <div className="flex flex-wrap items-center gap-2 pb-6">
        <Mono>{plan.code}</Mono>
        {plan.active ? <Badge tone="success">Active</Badge> : <Badge>Archived</Badge>}
        <span className="text-sm text-muted-foreground">
          {prices.length} price{prices.length === 1 ? "" : "s"}
        </span>
      </div>

      {created && prices.length === 0 ? (
        <p className="mb-4 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
          Plan created. It cannot be subscribed to until it has at least one price — add one below.
        </p>
      ) : null}

      <Card className="mb-4">
        <CardHeader>
          <CardTitle>Prices</CardTitle>
          <CardDescription>
            A second currency, an annual option or a metered variant all live here.
          </CardDescription>
        </CardHeader>
        <CardContent className="px-0 pb-0">
          {prices.length === 0 ? (
            <p className="px-5 pb-5 text-sm text-muted-foreground">No prices on this plan yet.</p>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Code</TH>
                  <TH>Model</TH>
                  <TH>Amount</TH>
                  <TH>Metered</TH>
                  <TH>Billing</TH>
                  <TH>Trial</TH>
                  <TH />
                </TR>
              </THead>
              <TBody>
                {prices.map((price) => {
                  const meter = price.usageMeterId ? meterById.get(price.usageMeterId) : undefined;
                  return (
                    <TR key={price.id} className={price.active ? undefined : "opacity-60"}>
                      <TD>
                        <Mono>{price.code}</Mono>
                        {(price.version ?? 1) > 1 || price.supersedesPriceId ? (
                          <Badge className="ml-1.5">v{price.version ?? 1}</Badge>
                        ) : null}
                        {price.nickname ? (
                          <span className="block text-xs text-muted-foreground">{price.nickname}</span>
                        ) : null}
                      </TD>
                      <TD className="text-muted-foreground">{titleCase(price.model)}</TD>
                      <TD className="tabular">
                        {price.unitAmount === null || price.unitAmount === undefined
                          ? "Usage only"
                          : formatAmount(price.unitAmount, price.currency)}
                        {price.model === "PER_SEAT" ? (
                          <span className="text-muted-foreground"> / seat</span>
                        ) : null}
                      </TD>
                      <TD className="text-muted-foreground">
                        {price.usageUnitAmount !== null && price.usageUnitAmount !== undefined ? (
                          <>
                            {formatAmount(price.usageUnitAmount, price.currency)}
                            {price.usageUnitSize && price.usageUnitSize > 1
                              ? ` per ${price.usageUnitSize.toLocaleString()}`
                              : " per unit"}
                            <span className="block text-xs">
                              {meter ? meter.code : "meter missing"}
                              {price.includedUnits
                                ? ` · ${price.includedUnits.toLocaleString()} included`
                                : ""}
                            </span>
                          </>
                        ) : (
                          "—"
                        )}
                      </TD>
                      <TD className="text-muted-foreground">
                        {describeInterval(price.intervalUnit, price.intervalCount)}
                      </TD>
                      <TD className="text-muted-foreground">
                        {price.trialDays ? `${price.trialDays} days` : "—"}
                      </TD>
                      <TD className="text-right">
                        <div className="flex justify-end gap-1">
                          <Link href={`/plans/${plan.id}/prices/${price.id}/edit`}>
                            <Button type="button" variant="ghost" size="sm">
                              <Pencil aria-hidden />
                              Edit
                            </Button>
                          </Link>
                          <form action={archivePrice}>
                            <input type="hidden" name="priceId" value={price.id} />
                            <input type="hidden" name="planId" value={plan.id} />
                            <input type="hidden" name="active" value={price.active ? "false" : "true"} />
                            <Button type="submit" variant="ghost" size="sm">
                              {price.active ? "Archive" : "Restore"}
                            </Button>
                          </form>
                        </div>
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          )}
          <p className="border-t border-border px-5 py-3 text-xs text-muted-foreground">
            Archiving hides a price from new signups; everyone already on it keeps paying it. Editing one
            with live subscriptions publishes a new version, and they move to it at their next renewal
            unless pinned.
          </p>
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Add a price</CardTitle>
          </CardHeader>
          <CardContent>
            <CreatePriceForm
              planId={plan.id}
              currencies={CURRENCY_CODES}
              meters={(meters ?? [])
                .filter((meter) => meter.active)
                .map((meter) => ({ id: meter.id, code: meter.code, name: meter.name, unitLabel: meter.unitLabel }))}
            />
          </CardContent>
        </Card>

        <Card className="h-fit">
          <CardHeader>
            <CardTitle>Edit plan</CardTitle>
            <CardDescription>
              Name, description and feature flags. The code is immutable — integrations reference it.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <EditPlanForm
              planId={plan.id}
              name={plan.name}
              description={plan.description ?? ""}
              features={featuresToText(plan.features)}
            />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
