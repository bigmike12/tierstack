import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { CURRENCIES } from "@tierstack/shared";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Mono, PageHeader } from "@/components/ui/shell";
import { apiFetchOrNull } from "@/lib/api";
import type { Paged } from "@/lib/list";
import type { Plan, Subscription, UsageMeter } from "@/lib/types";
import { EditPriceForm } from "../../../../price-form";

export const metadata: Metadata = { title: "Edit price" };

export default async function EditPricePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; priceId: string }>;
  searchParams: Promise<{ superseded?: string }>;
}) {
  const { id, priceId } = await params;
  const { superseded } = await searchParams;

  const [plan, meters] = await Promise.all([
    apiFetchOrNull<Plan>(`/v1/plans/${encodeURIComponent(id)}`),
    apiFetchOrNull<UsageMeter[]>("/v1/usage-meters"),
  ]);
  const price = plan?.prices?.find((entry) => entry.id === priceId || entry.code === priceId);
  if (!plan || !price) notFound();

  // Only the count matters, so ask for one row and read the total off the
  // envelope. This is what decides whether an amount change edits in place or
  // publishes a new version, so the form has to know it before you submit.
  const subscriptions = await apiFetchOrNull<Paged<Subscription>>(
    `/v1/subscriptions?priceId=${encodeURIComponent(price.id)}&limit=1`
  );
  const subscribers = subscriptions?.total ?? 0;

  return (
    <>
      <Link
        href={`/plans/${plan.id}`}
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden />
        {plan.name}
      </Link>
      <PageHeader
        title="Edit price"
        description="Update the billing details customers see and future billing uses."
      />

      {superseded ? (
        <p className="mb-4 max-w-3xl rounded-md border border-success/40 bg-success/10 px-3 py-2 text-sm">
          New version published. {superseded} existing subscription
          {superseded === "1" ? "" : "s"} finish the period they are in at the old price, then move to this
          one at their next renewal. Pin any of them individually to hold them where they are.
        </p>
      ) : null}

      <Card className="max-w-3xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mono>{price.code}</Mono>
            <Badge>v{price.version ?? 1}</Badge>
            {price.active ? null : <Badge>Archived</Badge>}
          </CardTitle>
          <CardDescription>
            Existing invoices are unchanged — they record what was charged at the time.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <EditPriceForm
            planId={plan.id}
            price={price}
            subscribers={subscribers}
            currencies={Object.keys(CURRENCIES)}
            meters={(meters ?? [])
              .filter((meter) => meter.active || meter.id === price.usageMeterId)
              .map((meter) => ({ id: meter.id, code: meter.code, name: meter.name, unitLabel: meter.unitLabel }))}
          />
        </CardContent>
      </Card>
    </>
  );
}
