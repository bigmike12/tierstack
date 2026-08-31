import Link from "next/link";
import type { Metadata } from "next";
import { apiFetchOrNull } from "@/lib/api";
import { AcceptInviteForm } from "./accept-form";

export const metadata: Metadata = { title: "Accept invite" };

interface InviteInfo {
  organizationName: string;
  email: string;
  role: string;
  requiresPassword: boolean;
}

export default async function AcceptInvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const invite = await apiFetchOrNull<InviteInfo>(`/v1/invites/${encodeURIComponent(token)}`);

  if (!invite) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-semibold tracking-tight">This invite link isn't valid</h1>
        <p className="text-sm text-muted-foreground">
          It may have already been accepted, or it's older than 7 days. Ask whoever invited you to send a
          new one.
        </p>
        <Link href="/login" className="text-sm font-medium underline underline-offset-4">
          Go to sign in
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1.5">
        <h1 className="text-xl font-semibold tracking-tight">Join {invite.organizationName}</h1>
        <p className="text-sm text-muted-foreground">
          {invite.email} is invited as a {invite.role.charAt(0) + invite.role.slice(1).toLowerCase()}.
        </p>
      </div>

      <AcceptInviteForm token={token} requiresPassword={invite.requiresPassword} />
    </div>
  );
}
