"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { removeMember, type ActionState } from "@/actions/billing";
import { Button } from "@/components/ui/button";

function Submit({ label, confirmText }: { label: string; confirmText: string }) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      variant="ghost"
      size="sm"
      className="text-destructive"
      disabled={pending}
      onClick={(event) => {
        if (!window.confirm(confirmText)) event.preventDefault();
      }}
    >
      {pending ? "…" : label}
    </Button>
  );
}

export function RemoveMemberForm({
  memberId,
  personLabel,
  pending,
}: {
  memberId: string;
  personLabel: string;
  pending: boolean;
}) {
  const [state, action] = useActionState<ActionState, FormData>(removeMember, {});

  return (
    <form action={action} className="inline-flex items-center gap-2">
      <input type="hidden" name="memberId" value={memberId} />
      {state.error ? <span className="text-xs text-destructive">{state.error}</span> : null}
      <Submit
        label={pending ? "Cancel invite" : "Remove"}
        confirmText={
          pending
            ? `Cancel the invite to ${personLabel}? The link they were sent will stop working.`
            : `Remove ${personLabel} from this organization? Their session will end immediately.`
        }
      />
    </form>
  );
}
