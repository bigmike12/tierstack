"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { acceptInviteAction, type FormState } from "@/actions/session";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";

function Submit({ requiresPassword }: { requiresPassword: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="w-full" disabled={pending}>
      {pending ? "Joining…" : requiresPassword ? "Set password and join" : "Accept invite"}
    </Button>
  );
}

export function AcceptInviteForm({ token, requiresPassword }: { token: string; requiresPassword: boolean }) {
  const boundAction = acceptInviteAction.bind(null, token);
  const [state, action] = useActionState<FormState, FormData>(boundAction, {});

  return (
    <form action={action} className="space-y-4">
      {state.error ? (
        <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {state.error}
        </p>
      ) : null}

      {requiresPassword ? (
        <Field label="Set a password" hint="At least 12 characters.">
          <Input name="password" type="password" autoComplete="new-password" required minLength={12} />
        </Field>
      ) : null}

      <Submit requiresPassword={requiresPassword} />
    </form>
  );
}
