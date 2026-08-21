"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { registerAction, type FormState } from "@/actions/session";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="w-full" disabled={pending}>
      {pending ? "Creating…" : "Create organization"}
    </Button>
  );
}

export function RegisterForm() {
  const [state, action] = useActionState<FormState, FormData>(registerAction, {});

  return (
    <form action={action} className="space-y-4">
      {state.error ? (
        <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {state.error}
        </p>
      ) : null}

      <Field label="Organization name">
        <Input name="organizationName" required placeholder="Acme Software" />
      </Field>

      <Field label="Your name">
        <Input name="name" required autoComplete="name" placeholder="Jonathan Ade" />
      </Field>

      <Field label="Email">
        <Input name="email" type="email" required autoComplete="email" placeholder="you@company.com" />
      </Field>

      <Field label="Password" hint={state.fieldErrors?.password ?? "At least 12 characters."}>
        <Input name="password" type="password" required autoComplete="new-password" minLength={12} />
      </Field>

      <Submit />
    </form>
  );
}
