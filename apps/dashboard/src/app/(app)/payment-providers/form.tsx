"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { configureProvider, testProvider, type ActionState } from "@/actions/billing";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className="w-full">
      {pending ? "Saving…" : label}
    </Button>
  );
}

export function ProviderForm() {
  const [state, action] = useActionState<ActionState, FormData>(configureProvider, {});

  return (
    <form action={action} className="space-y-4">
      {state.error ? (
        <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {state.error}
        </p>
      ) : null}
      {state.message ? (
        <p className="rounded-md border border-success/30 bg-success/10 px-3 py-2 text-sm text-success">
          {state.message}
        </p>
      ) : null}

      <Field label="Provider">
        <Select name="provider" defaultValue="MOCK">
          <option value="MOCK">Mock (local development)</option>
          <option value="PAYSTACK">Paystack — adapter is phase 3</option>
          <option value="FLUTTERWAVE">Flutterwave — adapter is phase 3</option>
          <option value="MONNIFY">Monnify — adapter is phase 3</option>
        </Select>
      </Field>

      <Field label="Environment">
        <Select name="environment" defaultValue="TEST">
          <option value="TEST">Test</option>
          <option value="LIVE">Live</option>
        </Select>
      </Field>

      <Field
        label="Credentials"
        hint="One KEY=value per line. Encrypted before storage and never returned by the API. Leave blank for the mock rail."
      >
        <textarea
          name="credentials"
          rows={4}
          placeholder={"secretKey=sk_live_xxx\npublicKey=pk_live_xxx"}
          className="flex w-full rounded-md border border-input bg-card px-3 py-2 font-mono text-xs shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </Field>

      <label className="flex items-center gap-2 text-sm">
        <Input type="checkbox" name="isDefault" className="size-4" defaultChecked />
        Make this the default rail for its environment
      </label>

      <Submit label="Save provider" />
    </form>
  );
}

export function TestButton({ configId }: { configId: string }) {
  return (
    <form action={testProvider}>
      <input type="hidden" name="configId" value={configId} />
      <Button type="submit" variant="outline" size="sm">
        Test credentials
      </Button>
    </form>
  );
}
