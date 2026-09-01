import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Mono, PageHeader } from "@/components/ui/shell";
import { apiFetchOrNull } from "@/lib/api";
import type { UsageMeter } from "@/lib/types";
import { EditMeterForm } from "../../../meter-form";

export const metadata: Metadata = { title: "Edit meter" };

export default async function EditMeterPage({ params }: { params: Promise<{ meterId: string }> }) {
  const { meterId } = await params;

  const meters = await apiFetchOrNull<UsageMeter[]>("/v1/usage-meters");
  const meter = meters?.find((entry) => entry.id === meterId);
  if (!meter) notFound();

  return (
    <>
      <Link
        href="/usage"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden />
        Usage
      </Link>
      <PageHeader title="Edit meter" description="The code stays fixed — it's what track events and prices reference." />

      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mono>{meter.code}</Mono>
            {meter.active ? null : <Badge>Archived</Badge>}
          </CardTitle>
          <CardDescription>Renaming or re-aggregating changes how future usage reads, not history already recorded.</CardDescription>
        </CardHeader>
        <CardContent>
          <EditMeterForm
            meterId={meter.id}
            name={meter.name}
            unitLabel={meter.unitLabel}
            aggregation={meter.aggregation}
          />
        </CardContent>
      </Card>
    </>
  );
}
