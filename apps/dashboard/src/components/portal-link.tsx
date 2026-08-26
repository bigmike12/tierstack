"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { createPortalLink, type PortalLinkState } from "@/actions/portal";
import { Button } from "@/components/ui/button";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="outline" size="sm" disabled={pending}>
      {pending ? "Opening…" : "Create a billing link"}
    </Button>
  );
}

/**
 * Mints a portal link for one customer and shows it once.
 *
 * Shown rather than followed: an operator almost never wants to land in the
 * customer's own billing page themselves — they want the address to send, or to
 * check what the customer is looking at while they are on the phone to them.
 */
export function PortalLinkButton({ customerId }: { customerId: string }) {
  const [state, action] = useActionState<PortalLinkState, FormData>(createPortalLink, {});

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="customerId" value={customerId} />
      <Submit />

      {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}

      {state.url ? (
        <div className="space-y-2">
          <input
            readOnly
            value={state.url}
            onFocus={(event) => event.currentTarget.select()}
            className="w-full rounded-md border border-border bg-muted px-2.5 py-1.5 font-mono text-xs"
          />
          <p className="text-xs text-muted-foreground">
            Works once opened, until {state.expiresLabel}. Anyone holding it can see and change this
            customer&apos;s billing, so send it to them and nobody else.
          </p>
        </div>
      ) : null}
    </form>
  );
}
