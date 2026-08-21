"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { loginAction, type FormState } from "@/actions/session";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="w-full" disabled={pending}>
      {pending ? "Signing in…" : "Sign in"}
    </Button>
  );
}

export function LoginForm() {
  const [state, action] = useActionState<FormState, FormData>(loginAction, {});

  return (
    <form action={action} className="space-y-4">
      {state.error ? (
        <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {state.error}
        </p>
      ) : null}

      <Field label="Email">
        <Input name="email" type="email" autoComplete="email" required placeholder="you@company.com" />
      </Field>

      <Field label="Password">
        <Input name="password" type="password" autoComplete="current-password" required />
      </Field>

      <Submit />
    </form>
  );
}
