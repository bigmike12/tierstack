import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { CURRENCIES } from "@tierstack/shared";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Mono, PageHeader } from "@/components/ui/shell";
import { apiFetchOrNull } from "@/lib/api";
import type { Plan, UsageMeter } from "@/lib/types";
import { EditPriceForm } from "../../../../price-form";

export const metadata: Metadata = { title: "Edit price" };

export default async function EditPricePage({
  params,
}: {
  params: Promise<{ id: string; priceId: string }>;
}) {
  const { id, priceId } = await params;
  const [plan, meters] = await Promise.all([
    apiFetchOrNull<Plan>(`/v1/plans/${encodeURIComponent(id)}`),
    apiFetchOrNull<UsageMeter[]>("/v1/usage-meters"),
  ]);
  const price = plan?.prices?.find((entry) => entry.id === priceId || entry.code === priceId);
  if (!plan || !price) notFound();

  return (
    <>
      <Link
        href={`/plans/${plan.id}`}
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden />
        {plan.name}
      </Link>
      <PageHeader title="Edit price" description="Update the billing details customers see and future billing uses." />

      <Card className="max-w-3xl">
        <CardHeader>
          <CardTitle>
            <Mono>{price.code}</Mono>
          </CardTitle>
          <CardDescription>
            Existing invoices are unchanged. If some subscribers should retain old terms, create a new price and
            move only those subscriptions to it.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <EditPriceForm
            planId={plan.id}
            price={price}
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
