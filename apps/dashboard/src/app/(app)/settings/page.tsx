import type { Metadata } from "next";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DescriptionList, Mono, PageHeader } from "@/components/ui/shell";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { apiFetchOrNull } from "@/lib/api";
import { formatDate } from "@/lib/format";
import type { BillingSettings, Member, Organization } from "@/lib/types";
import { BillingPolicyForm } from "./form";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const [organization, settings, members] = await Promise.all([
    apiFetchOrNull<Organization & { billingSettings?: BillingSettings }>("/v1/organizations/current"),
    apiFetchOrNull<BillingSettings>("/v1/billing-settings"),
    apiFetchOrNull<Member[]>("/v1/organizations/current/members"),
  ]);

  return (
    <>
      <PageHeader
        title="Settings"
        description="Organization details, billing policy and team access."
      />

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader>
            <CardTitle>Billing policy</CardTitle>
            <CardDescription>
              The engine has no built-in grace period or retry schedule. Whatever you set here is what it
              executes — and the values in force are frozen onto a subscription the moment a payment fails,
              so editing them never changes a recovery already under way.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {settings ? <BillingPolicyForm settings={settings} /> : <p className="text-sm text-muted-foreground">Could not load settings.</p>}
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Organization</CardTitle>
            </CardHeader>
            <CardContent>
              <DescriptionList
                items={[
                  { label: "Name", value: organization?.name ?? "—" },
                  { label: "Slug", value: organization ? <Mono>{organization.slug}</Mono> : "—" },
                  { label: "Id", value: organization ? <Mono>{organization.id}</Mono> : "—" },
                  { label: "Default currency", value: settings?.defaultCurrency ?? "—" },
                ]}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Naming</CardTitle>
              <CardDescription>
                The product name is not decided, so nothing is hard-coded. The display name, URLs and email
                sender all come from environment configuration.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <DescriptionList
                items={[
                  { label: "Internal identifier", value: <Mono>BILLING_PLATFORM</Mono> },
                  { label: "Display name", value: <Mono>APP_NAME</Mono> },
                  { label: "Package scope", value: <Mono>@billing-platform/*</Mono> },
                ]}
              />
            </CardContent>
          </Card>
        </div>
      </div>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Team</CardTitle>
          <CardDescription>Roles are enforced on the server, never in the browser.</CardDescription>
        </CardHeader>
        <CardContent className="px-0 pb-0">
          <Table>
            <THead>
              <TR>
                <TH>Name</TH>
                <TH>Email</TH>
                <TH>Role</TH>
                <TH>Joined</TH>
              </TR>
            </THead>
            <TBody>
              {(members ?? []).map((member) => (
                <TR key={member.id}>
                  <TD>{member.user.name}</TD>
                  <TD className="text-muted-foreground">{member.user.email}</TD>
                  <TD>
                    <Badge tone={member.role === "OWNER" ? "info" : "neutral"}>{member.role}</Badge>
                  </TD>
                  <TD className="tabular text-muted-foreground">
                    {member.acceptedAt ? formatDate(member.acceptedAt) : "Invited"}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
}
