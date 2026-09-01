"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { archivePrice, setPlanActive, type CatalogueState } from "@/actions/catalogue";
import { Button, type ButtonProps } from "@/components/ui/button";
import { ActionToast } from "@/components/ui/toast";

function ToggleSubmit({ label, variant }: { label: string; variant: ButtonProps["variant"] }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} size="sm" disabled={pending}>
      {pending ? "Working…" : label}
    </Button>
  );
}

export function TogglePlanActiveForm({ planId, active }: { planId: string; active: boolean }) {
  const [state, action] = useActionState<CatalogueState, FormData>(setPlanActive, {});

  return (
    <form action={action}>
      <input type="hidden" name="planId" value={planId} />
      <input type="hidden" name="active" value={active ? "false" : "true"} />
      <ActionToast state={state} />
      <ToggleSubmit label={active ? "Archive plan" : "Restore plan"} variant="outline" />
    </form>
  );
}

export function TogglePriceActiveForm({
  priceId,
  planId,
  active,
}: {
  priceId: string;
  planId: string;
  active: boolean;
}) {
  const [state, action] = useActionState<CatalogueState, FormData>(archivePrice, {});

  return (
    <form action={action}>
      <input type="hidden" name="priceId" value={priceId} />
      <input type="hidden" name="planId" value={planId} />
      <input type="hidden" name="active" value={active ? "false" : "true"} />
      <ActionToast state={state} />
      <ToggleSubmit label={active ? "Archive" : "Restore"} variant="ghost" />
    </form>
  );
}
