import type { Metadata } from "next";
import { StatusBadge } from "@/components/status-badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, Mono, PageHeader } from "@/components/ui/shell";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { apiFetchOrNull } from "@/lib/api";
import { formatDateTime } from "@/lib/format";

export const metadata: Metadata = { title: "Webhooks" };

interface WebhookEvent {
  id: string;
  provider: string;
  providerEventId: string;
  eventType: string;
  signatureVerified: boolean;
  status: string;
  processingAttempts: number;
  errorMessage: string | null;
  receivedAt: string;
  processedAt: string | null;
}

const ENDPOINTS = ["mock", "paystack", "monnify", "flutterwave"];

export default async function WebhooksPage() {
  const events = (await apiFetchOrNull<WebhookEvent[]>("/v1/webhook-events?limit=100")) ?? [];
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? process.env.API_URL ?? "http://localhost:4000";

  return (
    <>
      <PageHeader
        title="Webhooks"
        description="Incoming provider events. The signature is checked against the raw request bytes, the event is de-duplicated, and then the engine asks the provider what actually happened rather than believing the payload."
      />

      <Card className="mb-4">
        <CardHeader>
          <CardTitle>Endpoints</CardTitle>
          <CardDescription>Point each provider's webhook configuration at its own path.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-1.5">
          {ENDPOINTS.map((provider) => (
            <p key={provider} className="text-sm">
              <Mono>{`POST ${apiUrl}/webhooks/${provider}`}</Mono>
            </p>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent events</CardTitle>
        </CardHeader>
        <CardContent className="px-0 pb-0">
          {events.length === 0 ? (
            <div className="px-5 pb-5">
              <EmptyState
                title="No webhooks received"
                description="Complete a payment through the mock checkout to see one arrive."
              />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Provider</TH>
                  <TH>Event</TH>
                  <TH>Signature</TH>
                  <TH>Status</TH>
                  <TH>Received</TH>
                  <TH>Error</TH>
                </TR>
              </THead>
              <TBody>
                {events.map((event) => (
                  <TR key={event.id}>
                    <TD className="text-muted-foreground">{event.provider}</TD>
                    <TD>
                      <Mono>{event.eventType}</Mono>
                    </TD>
                    <TD>
                      {event.signatureVerified ? (
                        <span className="text-success">Verified</span>
                      ) : (
                        <span className="text-destructive">Rejected</span>
                      )}
                    </TD>
                    <TD>
                      <StatusBadge status={event.status} />
                    </TD>
                    <TD className="tabular text-muted-foreground">{formatDateTime(event.receivedAt)}</TD>
                    <TD className="max-w-[240px] truncate text-muted-foreground">
                      {event.errorMessage ?? "—"}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
          <p className="border-t border-border px-5 py-3 text-xs text-muted-foreground">
            Events are unique on organization + provider + provider event id, so a replayed delivery is
            acknowledged and ignored rather than processed twice.
          </p>
        </CardContent>
      </Card>
    </>
  );
}
