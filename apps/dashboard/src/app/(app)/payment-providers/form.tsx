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
import { Field, Input, Select } from "@/components/ui/input";
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
      {state.error ? (
        <p
          role="alert"
          className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
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
          {state.error ? (
            <p role="alert" className="text-sm text-destructive">
              {state.error}
            </p>
          ) : null}
          {state.message ? (
            <p className="text-sm text-success">{state.message}</p>
          ) : null}
          <Button type="submit" size="sm">
            Save changes
          </Button>
        </form>
        <form
          action={deleteAction}
          className="mt-4 border-t border-border pt-4"
        >
          <input type="hidden" name="configId" value={config.id} />
          {deleteState.error ? (
            <p role="alert" className="mb-2 text-sm text-destructive">
              {deleteState.error}
            </p>
          ) : null}
          <Button
            type="submit"
            variant="destructive"
            size="sm"
            onClick={(event) => {
              if (
                !window.confirm(
                  `Remove ${config.provider} (${config.environment})? Existing payment history is retained.`,
                )
              ) {
                event.preventDefault();
              }
            }}
          >
            Remove provider
          </Button>
        </form>
      </div>
    </details>
  );
}
