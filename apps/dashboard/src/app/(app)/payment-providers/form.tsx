"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import {
  configureProvider,
  deleteProvider,
  testProvider,
  updateProvider,
  type ActionState,
} from "@/actions/billing";
import { Button } from "@/components/ui/button";
import { ConfirmSubmitButton } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/input";
import { ActionToast } from "@/components/ui/toast";
import type { ProviderConfig } from "@/lib/types";

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className="w-full">
      {pending ? "Saving…" : label}
    </Button>
  );
}

export function ProviderForm() {
  const [state, action] = useActionState<ActionState, FormData>(
    configureProvider,
    {},
  );

  return (
    <form action={action} className="space-y-4">
      <ActionToast state={state} />

      <Field label="Provider">
        <Select name="provider" defaultValue="MOCK">
          <option value="MOCK">Mock (local development)</option>
          <option value="PAYSTACK">Paystack</option>
          <option value="FLUTTERWAVE">
            Flutterwave — adapter not written yet
          </option>
          <option value="MONNIFY">Monnify — adapter not written yet</option>
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
        hint={
          <>
            One KEY=value per line. Encrypted before storage and never returned
            by the API. Leave blank for the mock rail. Paystack needs{" "}
            <code className="font-mono">secretKey</code> — the same key signs
            its webhooks, so nothing can be verified without it.
          </>
        }
      >
        <textarea
          name="credentials"
          rows={4}
          placeholder="secretKey=sk_test_xxx"
          className="flex w-full rounded-md border border-input bg-card px-3 py-2 font-mono text-xs shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </Field>

      <label className="flex items-center gap-2 text-sm">
        <Input
          type="checkbox"
          name="isDefault"
          className="size-4"
          defaultChecked
        />
        Make this the default rail for its environment
      </label>

      <Submit label="Save provider" />
    </form>
  );
}

function TestSubmit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="outline" size="sm" disabled={pending}>
      {pending ? "Testing…" : "Test credentials"}
    </Button>
  );
}

export function TestButton({ configId }: { configId: string }) {
  const [state, action] = useActionState<ActionState, FormData>(testProvider, {});
  return (
    <form action={action}>
      <input type="hidden" name="configId" value={configId} />
      <ActionToast state={state} />
      <TestSubmit />
    </form>
  );
}

export function ProviderEditor({ config }: { config: ProviderConfig }) {
  const [state, action] = useActionState<ActionState, FormData>(
    updateProvider,
    {},
  );
  const [deleteState, deleteAction] = useActionState<ActionState, FormData>(
    deleteProvider,
    {},
  );

  return (
    <details className="mt-4 rounded-md border border-border p-3">
      <summary className="cursor-pointer text-sm font-medium">
        Edit provider
      </summary>
      <div>
        <form action={action} className="mt-4 space-y-4">
          <input type="hidden" name="configId" value={config.id} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Priority"
              hint="Lower values are routed first, unless a rail is the default."
            >
              <Input
                name="priority"
                type="number"
                min={0}
                max={1000}
                defaultValue={config.priority}
                required
              />
            </Field>
            <div className="space-y-3 pt-1 text-sm">
              <label className="flex items-center gap-2">
                <Input
                  name="enabled"
                  type="checkbox"
                  className="size-4"
                  defaultChecked={config.enabled}
                />
                Enabled
              </label>
              <label className="flex items-center gap-2">
                <Input
                  name="isDefault"
                  type="checkbox"
                  className="size-4"
                  defaultChecked={config.isDefault}
                />
                Make default rail
              </label>
            </div>
          </div>
          <Field
            label="Replace credentials"
            hint="Optional and write-only. Leave blank to keep the current credentials."
          >
            <textarea
              name="credentials"
              rows={3}
              placeholder="secretKey=sk_test_xxx"
              className="flex w-full rounded-md border border-input bg-card px-3 py-2 font-mono text-xs shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </Field>
          <ActionToast state={state} />
          <Button type="submit" size="sm">
            Save changes
          </Button>
        </form>
        <form
          action={deleteAction}
          className="mt-4 border-t border-border pt-4"
        >
          <input type="hidden" name="configId" value={config.id} />
          <ActionToast state={deleteState} />
          <ConfirmSubmitButton
            variant="destructive"
            size="sm"
            title="Remove this provider?"
            description={`Removing ${config.provider} (${config.environment}) stops it from being used for new charges. Existing payment history is retained.`}
            confirmLabel="Remove provider"
          >
            Remove provider
          </ConfirmSubmitButton>
        </form>
      </div>
    </details>
  );
}
