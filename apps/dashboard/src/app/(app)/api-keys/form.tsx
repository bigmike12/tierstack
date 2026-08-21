"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { createApiKey, revokeApiKey, type ActionState } from "@/actions/billing";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";

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

      {state.error ? (
        <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {state.error}
        </p>
      ) : null}

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
  return (
    <form action={revokeApiKey}>
      <input type="hidden" name="keyId" value={keyId} />
      <Button type="submit" variant="ghost" size="sm" className="text-destructive">
        Revoke
      </Button>
    </form>
  );
}
