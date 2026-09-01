"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { inviteMember, type ActionState } from "@/actions/billing";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import { ActionToast } from "@/components/ui/toast";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} size="sm">
      {pending ? "Inviting…" : "Invite"}
    </Button>
  );
}

export function InviteMemberForm() {
  const [state, action] = useActionState<ActionState, FormData>(inviteMember, {});

  return (
    <form action={action} className="space-y-3 border-b border-border p-5">
      <ActionToast state={state} />

      <div className="grid gap-3 sm:grid-cols-[2fr_1.5fr_1fr_auto] sm:items-end">
        <Field label="Email">
          <Input name="email" type="email" required placeholder="teammate@company.com" />
        </Field>
        <Field label="Name" hint="Optional if they don't have an account yet.">
          <Input name="name" placeholder="Jane Doe" maxLength={120} />
        </Field>
        <Field label="Role">
          <Select name="role" defaultValue="MEMBER">
            <option value="MEMBER">Member</option>
            <option value="ADMIN">Admin</option>
          </Select>
        </Field>
        <Submit />
      </div>
    </form>
  );
}
