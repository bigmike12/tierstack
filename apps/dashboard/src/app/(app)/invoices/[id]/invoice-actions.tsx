"use client";

import { useActionState } from "react";
import { voidInvoice, type ActionState } from "@/actions/billing";
import { ConfirmSubmitButton } from "@/components/ui/dialog";
import { ActionToast } from "@/components/ui/toast";

export function VoidInvoiceForm({ invoiceId }: { invoiceId: string }) {
  const [state, action] = useActionState<ActionState, FormData>(voidInvoice, {});
  return (
    <form action={action}>
      <input type="hidden" name="invoiceId" value={invoiceId} />
      <ActionToast state={state} />
      <ConfirmSubmitButton
        variant="outline"
        size="sm"
        title="Void this invoice?"
        description="It stops being collectable and nothing further will be attempted against it. This cannot be undone."
        confirmLabel="Void invoice"
      >
        Void
      </ConfirmSubmitButton>
    </form>
  );
}
