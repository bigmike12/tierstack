"use client";

import { useActionState } from "react";
import { cancelSubscription, resumeSubscription, setPricePinned, type ActionState } from "@/actions/billing";
import { Button } from "@/components/ui/button";
import { ConfirmSubmitButton } from "@/components/ui/dialog";
import { ActionToast } from "@/components/ui/toast";

export function ResumeSubscriptionForm({ subscriptionId }: { subscriptionId: string }) {
  const [state, action] = useActionState<ActionState, FormData>(resumeSubscription, {});
  return (
    <form action={action}>
      <input type="hidden" name="subscriptionId" value={subscriptionId} />
      <ActionToast state={state} />
      <Button type="submit" variant="outline" size="sm">
        Revoke cancellation
      </Button>
    </form>
  );
}

export function CancelAtPeriodEndForm({ subscriptionId }: { subscriptionId: string }) {
  const [state, action] = useActionState<ActionState, FormData>(cancelSubscription, {});
  return (
    <form action={action}>
      <input type="hidden" name="subscriptionId" value={subscriptionId} />
      <input type="hidden" name="atPeriodEnd" value="true" />
      <ActionToast state={state} />
      <Button type="submit" variant="outline" size="sm">
        Cancel at period end
      </Button>
    </form>
  );
}

export function CancelNowForm({ subscriptionId }: { subscriptionId: string }) {
  const [state, action] = useActionState<ActionState, FormData>(cancelSubscription, {});
  return (
    <form action={action}>
      <input type="hidden" name="subscriptionId" value={subscriptionId} />
      <input type="hidden" name="atPeriodEnd" value="false" />
      <ActionToast state={state} />
      <ConfirmSubmitButton
        variant="destructive"
        size="sm"
        title="Cancel this subscription now?"
        description="Access ends immediately — this does not wait for the current period to run out and cannot be undone."
        confirmLabel="Cancel now"
      >
        Cancel now
      </ConfirmSubmitButton>
    </form>
  );
}

export function PinPriceForm({
  subscriptionId,
  pinned,
}: {
  subscriptionId: string;
  pinned: boolean | undefined;
}) {
  const [state, action] = useActionState<ActionState, FormData>(setPricePinned, {});
  return (
    <form action={action}>
      <input type="hidden" name="subscriptionId" value={subscriptionId} />
      <input type="hidden" name="pinned" value={pinned ? "false" : "true"} />
      <ActionToast state={state} />
      <Button type="submit" variant="outline" size="sm">
        {pinned ? "Follow price changes" : "Pin to this price"}
      </Button>
    </form>
  );
}
