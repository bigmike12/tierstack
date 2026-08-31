import type { Metadata } from "next";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DescriptionList, Mono, PageHeader } from "@/components/ui/shell";
import { TBody, TD, TH, THead, TR, Table } from "@/components/ui/table";
import { apiFetchOrNull } from "@/lib/api";
import { formatDate } from "@/lib/format";
import type { BillingSettings, Member, Organization, Session } from "@/lib/types";
import { BillingPolicyForm } from "./form";
import { InviteMemberForm } from "./invite-form";
import { ChangePasswordForm, ProfileForm } from "./profile-form";
import { RemoveMemberForm } from "./remove-member-form";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const [organization, settings, members, session] = await Promise.all([
    apiFetchOrNull<Organization & { billingSettings?: BillingSettings }>("/v1/organizations/current"),
    apiFetchOrNull<BillingSettings>("/v1/billing-settings"),
    apiFetchOrNull<Member[]>("/v1/organizations/current/members"),
    apiFetchOrNull<Session>("/v1/auth/me"),
  ]);
  // Matches the org the layout resolves as "current" — the first membership.
  const myRole = session?.organizations?.[0]?.role;
  const canInvite = myRole === "OWNER" || myRole === "ADMIN";

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
              How recovery behaves when a payment fails. Changes apply to the next failure; a grace period
              already running keeps the length and outcome it started with.
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
                ]}
              />
            </CardContent>
          </Card>

          {session?.user ? (
            <>
              <Card>
                <CardHeader>
                  <CardTitle>Profile</CardTitle>
                </CardHeader>
                <CardContent>
                  <ProfileForm name={session.user.name} email={session.user.email} />
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Password</CardTitle>
                </CardHeader>
                <CardContent>
                  <ChangePasswordForm />
                </CardContent>
              </Card>
            </>
          ) : null}
        </div>
      </div>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Team</CardTitle>
          <CardDescription>Roles are enforced on the server, never in the browser.</CardDescription>
        </CardHeader>
        <CardContent className="px-0 pb-0">
          {canInvite ? <InviteMemberForm /> : null}
          <Table>
            <THead>
              <TR>
                <TH>Name</TH>
                <TH>Email</TH>
                <TH>Role</TH>
                <TH>Joined</TH>
                {canInvite ? <TH className="text-right">&nbsp;</TH> : null}
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
                  {canInvite ? (
                    <TD className="text-right">
                      <RemoveMemberForm
                        memberId={member.id}
                        personLabel={member.user.name || member.user.email}
                        pending={!member.acceptedAt}
                      />
                    </TD>
                  ) : null}
                </TR>
              ))}
            </TBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
}
