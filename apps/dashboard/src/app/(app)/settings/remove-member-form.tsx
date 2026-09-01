"use client";

import { useActionState } from "react";
import { removeMember, type ActionState } from "@/actions/billing";
import { ConfirmSubmitButton } from "@/components/ui/dialog";
import { ActionToast } from "@/components/ui/toast";

export function RemoveMemberForm({
  memberId,
  personLabel,
  pending: invitePending,
}: {
  memberId: string;
  personLabel: string;
  /** True while this row is still an unaccepted invite, not a real member. */
  pending: boolean;
}) {
  const [state, action] = useActionState<ActionState, FormData>(removeMember, {});

  return (
    <form action={action} className="inline-flex">
      <input type="hidden" name="memberId" value={memberId} />
      <ActionToast state={state} />
      <ConfirmSubmitButton
        variant="ghost"
        size="sm"
        className="text-destructive"
        title={invitePending ? "Cancel this invite?" : "Remove this member?"}
        description={
          invitePending
            ? `The link sent to ${personLabel} will stop working.`
            : `${personLabel} will lose access immediately — their session ends right away.`
        }
        confirmLabel={invitePending ? "Cancel invite" : "Remove"}
      >
        {invitePending ? "Cancel invite" : "Remove"}
      </ConfirmSubmitButton>
    </form>
  );
}
