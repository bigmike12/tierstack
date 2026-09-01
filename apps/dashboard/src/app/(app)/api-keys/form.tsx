"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { createApiKey, revokeApiKey, type ActionState } from "@/actions/billing";
import { Button } from "@/components/ui/button";
import { ConfirmSubmitButton } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/input";
import { ActionToast } from "@/components/ui/toast";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className="w-full">
      {pending ? "Creating…" : "Create key"}
    </Button>
  );
}

export function CreateKeyForm() {
  const [state, action] = useActionState<ActionState, FormData>(createApiKey, {});

  return (
    <div className="space-y-4">
      {state.secret ? (
        <div className="rounded-md border border-warning/40 bg-warning/10 p-3">
          <p className="text-sm font-medium">Copy this now</p>
          <p className="mt-1 text-xs text-muted-foreground">
            This is the only time the full key is shown.
          </p>
          <code className="mt-2 block break-all rounded bg-card px-2 py-1.5 font-mono text-xs">
            {state.secret}
          </code>
        </div>
      ) : null}

      <ActionToast state={state} />

      <form action={action} className="space-y-4">
        <Field label="Name">
          <Input name="name" required placeholder="Production backend" />
        </Field>

        <Field label="Type">
          <Select name="type" defaultValue="SECRET">
            <option value="SECRET">Secret (server-side only)</option>
            <option value="PUBLIC">Publishable (safe in a browser)</option>
          </Select>
        </Field>

        <Field label="Environment">
          <Select name="environment" defaultValue="TEST">
            <option value="TEST">Test</option>
            <option value="LIVE">Live</option>
          </Select>
        </Field>

        <Submit />
      </form>
    </div>
  );
}

export function RevokeButton({ keyId }: { keyId: string }) {
  const [state, action] = useActionState<ActionState, FormData>(revokeApiKey, {});

  return (
    <form action={action}>
      <input type="hidden" name="keyId" value={keyId} />
      <ActionToast state={state} />
      <ConfirmSubmitButton
        variant="ghost"
        size="sm"
        className="text-destructive"
        title="Revoke this key?"
        description="Anything using it stops working immediately. This cannot be undone."
        confirmLabel="Revoke"
      >
        Revoke
      </ConfirmSubmitButton>
    </form>
  );
}
