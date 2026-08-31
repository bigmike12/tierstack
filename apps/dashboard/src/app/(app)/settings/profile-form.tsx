"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { changePassword, updateProfile, type ActionState } from "@/actions/billing";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";

function Submit({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} size="sm">
      {pending ? pendingLabel : label}
    </Button>
  );
}

function FormMessage({ state }: { state: ActionState }) {
  if (state.error) {
    return (
      <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
        {state.error}
      </p>
    );
  }
  if (state.message) {
    return (
      <p className="rounded-md border border-success/30 bg-success/10 px-3 py-2 text-sm text-success">
        {state.message}
      </p>
    );
  }
  return null;
}

export function ProfileForm({ name, email }: { name: string; email: string }) {
  const [state, action] = useActionState<ActionState, FormData>(updateProfile, {});

  return (
    <form action={action} className="space-y-4">
      <FormMessage state={state} />
      <Field label="Name">
        <Input name="name" defaultValue={name} required maxLength={120} />
      </Field>
      <Field label="Email" hint="Your login identity. Not editable here.">
        <Input value={email} disabled />
      </Field>
      <Submit label="Save name" pendingLabel="Saving…" />
    </form>
  );
}

export function ChangePasswordForm() {
  const [state, action] = useActionState<ActionState, FormData>(changePassword, {});

  return (
    <form action={action} className="space-y-4">
      <FormMessage state={state} />
      <Field label="Current password">
        <Input name="currentPassword" type="password" required autoComplete="current-password" />
      </Field>
      <Field label="New password" hint="At least 12 characters.">
        <Input name="newPassword" type="password" required minLength={12} autoComplete="new-password" />
      </Field>
      <Field label="Confirm new password">
        <Input name="confirmPassword" type="password" required minLength={12} autoComplete="new-password" />
      </Field>
      <Submit label="Change password" pendingLabel="Changing…" />
    </form>
  );
}
