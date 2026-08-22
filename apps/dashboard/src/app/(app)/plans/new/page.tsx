import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/shell";
import { CreatePlanForm } from "../plan-form";

export const metadata: Metadata = { title: "New plan" };

export default function NewPlanPage() {
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
        title="New plan"
        description="A plan is the product. Prices come next — one plan can carry several, which is how a second currency or an annual option works without duplicating the plan."
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardContent>
            <CreatePlanForm />
          </CardContent>
        </Card>

        <Card className="h-fit">
          <CardHeader>
            <CardTitle className="text-base">Feature flags</CardTitle>
            <CardDescription>
              The quickest way to describe what a plan includes, without creating entitlement rows.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <p>
              Your application asks <code className="font-mono text-xs">POST /v1/entitlements/check</code>{" "}
              whether a customer may do something, and the answer is resolved from these flags — unless a
              subscription- or customer-level entitlement overrides them.
            </p>
            <p>
              A number becomes a limit that consumption is counted against. Use{" "}
              <code className="font-mono text-xs">unlimited</code> when there should be no ceiling rather than
              picking an arbitrarily large number, so the resolver can say so honestly.
            </p>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
