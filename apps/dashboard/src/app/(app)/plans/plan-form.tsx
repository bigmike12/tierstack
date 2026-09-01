"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { createPlan, updatePlan, type CatalogueState } from "@/actions/catalogue";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { ActionToast } from "@/components/ui/toast";

function Submit({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? pendingLabel : label}
    </Button>
  );
}

const FEATURE_HINT = (
  <>
    One per line. <code className="font-mono">api_access</code> turns a feature on,{" "}
    <code className="font-mono">seats=10</code> sets a limit,{" "}
    <code className="font-mono">projects=unlimited</code> removes the ceiling, and{" "}
    <code className="font-mono">exports=false</code> turns one off. These are what{" "}
    <code className="font-mono">/v1/entitlements/check</code> answers from.
  </>
);

export function CreatePlanForm() {
  const [state, action] = useActionState<CatalogueState, FormData>(createPlan, {});

  return (
    <form action={action} className="space-y-5">
      <ActionToast state={state} />

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Name" hint="What a customer would see.">
          <Input name="name" required placeholder="Growth" defaultValue={state.values?.name} />
        </Field>
        <Field label="Code" hint="Immutable. This is what your API calls reference.">
          <Input
            name="code"
            required
            pattern="[A-Za-z0-9_\-]+"
            placeholder="growth"
            defaultValue={state.values?.code}
          />
        </Field>
      </div>

      <Field label="Description" hint="Optional.">
        <Input name="description" placeholder="For teams shipping to production." defaultValue={state.values?.description} />
      </Field>

      <Field label="Feature flags" hint={FEATURE_HINT}>
        <textarea
          name="features"
          rows={5}
          defaultValue={state.values?.features}
          placeholder={"api_access\nseats=10\nprojects=unlimited"}
          className="flex w-full rounded-md border border-input bg-card px-3 py-2 font-mono text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </Field>

      <div className="flex items-center gap-3">
        <Submit label="Create plan" pendingLabel="Creating…" />
        <p className="text-xs text-muted-foreground">
          You will add prices next — a plan with no price cannot be subscribed to.
        </p>
      </div>
    </form>
  );
}

export function EditPlanForm({
  planId,
  name,
  description,
  features,
}: {
  planId: string;
  name: string;
  description: string;
  features: string;
}) {
  const [state, action] = useActionState<CatalogueState, FormData>(updatePlan, {});

  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="planId" value={planId} />
      <ActionToast state={state} />

      <Field label="Name">
        <Input name="name" required defaultValue={state.values?.name ?? name} />
      </Field>

      <Field label="Description">
        <Input name="description" defaultValue={state.values?.description ?? description} />
      </Field>

      <Field label="Feature flags" hint={FEATURE_HINT}>
        <textarea
          name="features"
          rows={5}
          defaultValue={state.values?.features ?? features}
          className="flex w-full rounded-md border border-input bg-card px-3 py-2 font-mono text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </Field>

      <Submit label="Save plan" pendingLabel="Saving…" />
    </form>
  );
}
