import type { Metadata } from "next";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, Mono, PageHeader } from "@/components/ui/shell";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { apiFetchOrNull } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import type { ApiKey } from "@/lib/types";
import { CreateKeyForm, RevokeButton } from "./form";

export const metadata: Metadata = { title: "API Keys" };

export default async function ApiKeysPage() {
  const keys = (await apiFetchOrNull<ApiKey[]>("/v1/api-keys")) ?? [];

  return (
    <>
      <PageHeader
        title="API keys"
        description="A key is shown once, when you create it. Lose it and you revoke it — it cannot be looked up."
      />

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle>Keys</CardTitle>
            <CardDescription>
              Secret keys (<Mono>sk_</Mono>) carry full organization authority and must never reach a browser.
              Publishable keys (<Mono>pk_</Mono>) are read-only and safe in frontend code.
            </CardDescription>
          </CardHeader>
          <CardContent className="px-0 pb-0">
            {keys.length === 0 ? (
              <div className="px-5 pb-5">
                <EmptyState title="No keys yet" description="Create a test key to start calling the API." />
              </div>
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>Name</TH>
                    <TH>Key</TH>
                    <TH>Environment</TH>
                    <TH>Last used</TH>
                    <TH>Status</TH>
                    <TH />
                  </TR>
                </THead>
                <TBody>
                  {keys.map((key) => (
                    <TR key={key.id}>
                      <TD>{key.name}</TD>
                      <TD>
                        <Mono>{key.prefix}…</Mono>
                      </TD>
                      <TD>
                        <Badge tone={key.environment === "LIVE" ? "warning" : "neutral"}>{key.environment}</Badge>
                      </TD>
                      <TD className="tabular text-muted-foreground">
                        {key.lastUsedAt ? formatDateTime(key.lastUsedAt) : "Never"}
                      </TD>
                      <TD>
                        {key.revokedAt ? <Badge tone="danger">Revoked</Badge> : <Badge tone="success">Active</Badge>}
                      </TD>
                      <TD className="text-right">
                        {key.revokedAt ? null : <RevokeButton keyId={key.id} />}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card className="h-fit">
          <CardHeader>
            <CardTitle>Create a key</CardTitle>
          </CardHeader>
          <CardContent>
            <CreateKeyForm />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
