"use client";

import { useActionState } from "react";
import { deletePlan, type CatalogueState } from "@/actions/catalogue";
import { ConfirmSubmitButton } from "@/components/ui/dialog";
import { ActionToast } from "@/components/ui/toast";

export function DeletePlanForm({ planId }: { planId: string }) {
  const [state, action] = useActionState<CatalogueState, FormData>(deletePlan, {});

  return (
    <form action={action}>
      <input type="hidden" name="planId" value={planId} />
      <ActionToast state={state} />
      <ConfirmSubmitButton
        variant="outline"
        size="sm"
        className="text-destructive"
        title="Delete this plan?"
        description="This only succeeds once nothing is still subscribed to it. It cannot be undone."
        confirmLabel="Delete plan"
      >
        Delete plan
      </ConfirmSubmitButton>
    </form>
  );
}
