import type { Metadata } from "next";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/shell";
import { apiFetchOrNull } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import type { ProviderConfig } from "@/lib/types";
import { ProviderForm, TestButton } from "./form";

export const metadata: Metadata = { title: "Payment Providers" };

const CAPABILITY_LABELS: Record<string, string> = {
  recurringCard: "Recurring card",
  directDebit: "Direct debit",
  bankTransfer: "Bank transfer",
  mobileMoney: "Mobile money",
  refunds: "Refunds",
  paymentLinks: "Payment links",
  tokenization: "Tokenization",
};

export default async function ProvidersPage() {
  const configs = (await apiFetchOrNull<ProviderConfig[]>("/v1/payment-providers")) ?? [];

  return (
    <>
      <PageHeader
        title="Payment providers"
        description="Rails, not the source of truth. Credentials are sealed with AES-256-GCM and bound to this organization before they reach the database — a ciphertext copied into another tenant's row will not decrypt."
      />

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          {configs.length === 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>No provider configured</CardTitle>
                <CardDescription>
                  Add the mock rail to run the whole billing lifecycle locally with no credentials at all.
                </CardDescription>
              </CardHeader>
            </Card>
          ) : (
            configs.map((config) => {
              const capabilities = config.capabilities as Record<string, unknown> | null;
              return (
                <Card key={config.id}>
                  <CardHeader className="flex-row items-start justify-between gap-4">
                    <div className="space-y-1">
                      <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                        {config.provider}
                        <Badge tone="info">{config.environment}</Badge>
                        {config.isDefault ? <Badge tone="success">Default</Badge> : null}
                        {!config.enabled ? <Badge tone="warning">Disabled</Badge> : null}
                      </CardTitle>
                      <CardDescription>
                        Priority {config.priority}
                        {config.lastTestedAt
                          ? ` · last tested ${formatDateTime(config.lastTestedAt)} (${config.lastTestStatus})`
                          : " · never tested"}
                      </CardDescription>
                    </div>
                    <TestButton configId={config.id} />
                  </CardHeader>

                  <CardContent>
                    {capabilities ? (
                      <div className="flex flex-wrap gap-1.5">
                        {Object.entries(CAPABILITY_LABELS).map(([key, label]) => (
                          <Badge key={key} tone={capabilities[key] ? "success" : "neutral"}>
                            {capabilities[key] ? "✓" : "✕"} {label}
                          </Badge>
                        ))}
                      </div>
                    ) : (
                      <p className="rounded-md border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">
                        The {config.provider} adapter is phase 3 and is not implemented in this build. Its
                        configuration is stored, but the billing engine reports no capabilities for it rather
                        than advertising a set it cannot honour — and any operation returns
                        NOT_IMPLEMENTED.
                      </p>
                    )}
                  </CardContent>
                </Card>
              );
            })
          )}
        </div>

        <Card className="h-fit">
          <CardHeader>
            <CardTitle>Add or update a provider</CardTitle>
            <CardDescription>Saving an existing provider replaces its stored credentials.</CardDescription>
          </CardHeader>
          <CardContent>
            <ProviderForm />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
