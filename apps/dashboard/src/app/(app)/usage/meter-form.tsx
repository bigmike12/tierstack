"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import {
  createUsageMeter,
  deleteUsageMeter,
  setMeterActive,
  updateUsageMeter,
  type UsageMeterState,
} from "@/actions/usage";
import { Button } from "@/components/ui/button";
import { ConfirmSubmitButton } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/input";
import { ActionToast } from "@/components/ui/toast";

const AGGREGATION_OPTIONS = (
  <>
    <option value="SUM">Sum — total consumed (tokens, API calls, minutes)</option>
    <option value="MAX">Max — highest single reading (peak seats, peak storage)</option>
    <option value="LAST">Last — most recent reading only (current storage used)</option>
    <option value="UNIQUE_COUNT">Unique count — distinct values seen (active users, devices)</option>
  </>
);

function Submit({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} size="sm">
      {pending ? pendingLabel : label}
    </Button>
  );
}

export function CreateMeterForm() {
  const [state, action] = useActionState<UsageMeterState, FormData>(createUsageMeter, {});

  return (
    <form action={action} className="space-y-4">
      <ActionToast state={state} />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" hint="What you'll recognize it as. Must be unique in this organization.">
          <Input name="name" required placeholder="AI tokens" defaultValue={state.values?.name} />
        </Field>
        <Field label="Code" hint="What track events and prices reference. Letters, numbers, dashes, underscores.">
          <Input
            name="code"
            required
            pattern="[A-Za-z0-9_\-]+"
            placeholder="ai_tokens"
            defaultValue={state.values?.code}
          />
        </Field>
        <Field label="Unit label" hint="Optional. Shown next to a quantity, e.g. 1,204 tokens.">
          <Input name="unitLabel" placeholder="tokens" defaultValue={state.values?.unitLabel} />
        </Field>
        <Field label="Aggregation" hint="How events roll up into one number for a billing period.">
          <Select name="aggregation" defaultValue={state.values?.aggregation ?? "SUM"}>
            {AGGREGATION_OPTIONS}
          </Select>
        </Field>
      </div>

      <div className="flex items-center gap-3">
        <Submit label="Create meter" pendingLabel="Creating…" />
        <p className="text-xs text-muted-foreground">A name or code already in use here is rejected, not merged.</p>
      </div>
    </form>
  );
}

export function EditMeterForm({
  meterId,
  name,
  unitLabel,
  aggregation,
}: {
  meterId: string;
  name: string;
  unitLabel: string | null;
  aggregation: string;
}) {
  const [state, action] = useActionState<UsageMeterState, FormData>(updateUsageMeter, {});

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="meterId" value={meterId} />
      <ActionToast state={state} />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" hint="Must be unique in this organization.">
          <Input name="name" required defaultValue={state.values?.name ?? name} />
        </Field>
        <Field label="Unit label" hint="Optional. Shown next to a quantity, e.g. 1,204 tokens.">
          <Input name="unitLabel" defaultValue={state.values?.unitLabel ?? unitLabel ?? ""} />
        </Field>
        <Field label="Aggregation" hint="How events roll up into one number for a billing period.">
          <Select name="aggregation" defaultValue={state.values?.aggregation ?? aggregation}>
            {AGGREGATION_OPTIONS}
          </Select>
        </Field>
      </div>

      <Submit label="Save changes" pendingLabel="Saving…" />
    </form>
  );
}

function ToggleSubmit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="ghost" size="sm" disabled={pending}>
      {pending ? "Working…" : label}
    </Button>
  );
}

export function ToggleMeterActiveForm({ meterId, active }: { meterId: string; active: boolean }) {
  const [state, action] = useActionState<UsageMeterState, FormData>(setMeterActive, {});

  return (
    <form action={action} className="inline-flex">
      <input type="hidden" name="meterId" value={meterId} />
      <input type="hidden" name="active" value={active ? "false" : "true"} />
      <ActionToast state={state} />
      <ToggleSubmit label={active ? "Archive" : "Restore"} />
    </form>
  );
}

export function DeleteMeterForm({ meterId, meterName }: { meterId: string; meterName: string }) {
  const [state, action] = useActionState<UsageMeterState, FormData>(deleteUsageMeter, {});

  return (
    <form action={action} className="inline-flex">
      <input type="hidden" name="meterId" value={meterId} />
      <ActionToast state={state} />
      <ConfirmSubmitButton
        variant="ghost"
        size="sm"
        className="text-destructive"
        title="Delete this meter?"
        description={`This only succeeds once no active price still bills against "${meterName}". It cannot be undone.`}
        confirmLabel="Delete meter"
      >
        Delete
      </ConfirmSubmitButton>
    </form>
  );
}
