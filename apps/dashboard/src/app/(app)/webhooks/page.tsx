import type { Metadata } from "next";
import { StatusBadge } from "@/components/status-badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Pagination } from "@/components/ui/pagination";
import { EmptyState, Mono, PageHeader } from "@/components/ui/shell";
import { SearchInput } from "@/components/ui/table-toolbar";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { apiFetchOrNull } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { emptyPage, listQuery, type Paged } from "@/lib/list";

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

export default async function WebhooksPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; q?: string }>;
}) {
  const { page, q } = await searchParams;
  const result =
    (await apiFetchOrNull<Paged<WebhookEvent>>(
      `/v1/webhook-events${listQuery({ page, q, limit: 25 })}`
    )) ?? emptyPage<WebhookEvent>();
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? process.env.API_URL ?? "http://localhost:4000";

  return (
    <>
      <PageHeader
        title="Webhooks"
        description="Incoming provider events, with the result of each signature check."
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
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-3">
          <CardTitle>Recent events</CardTitle>
          <SearchInput placeholder="Search event type or id…" />
        </CardHeader>
        <CardContent className="px-0 pb-0">
          {result.items.length === 0 ? (
            <div className="px-5 pb-5">
              <EmptyState
                title={q ? "No matches" : "No webhooks received"}
                description={
                  q
                    ? `No webhook events match “${q}”.`
                    : "Complete a payment through the mock checkout to see one arrive."
                }
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
                {result.items.map((event) => (
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
          {result.items.length > 0 ? (
            <Pagination meta={result} basePath="/webhooks" params={{ q }} />
          ) : null}
          <p className="border-t border-border px-5 py-3 text-xs text-muted-foreground">
            A replayed delivery is acknowledged and ignored, never processed twice.
          </p>
        </CardContent>
      </Card>
    </>
  );
}
