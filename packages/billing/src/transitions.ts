import type { TransactionClient } from "@billing-platform/database";
import { transition, type SubscriptionStatus } from "./state-machine";

/**
 * Applies a validated status change and appends the audit row in one place.
 * Nothing else in the codebase writes `subscription.status`.
 */
export async function applyTransition(
  tx: TransactionClient,
  subscriptionId: string,
  from: SubscriptionStatus,
  to: SubscriptionStatus,
  reason: string,
  extraData: Record<string, unknown> = {},
  metadata: Record<string, unknown> = {}
) {
  const validated = transition(from, to, reason);

  const updated = await tx.subscription.update({
    where: { id: subscriptionId },
    data: { status: validated.to, ...extraData } as never,
  });

  await tx.subscriptionTransition.create({
    data: {
      subscriptionId,
      fromStatus: validated.from,
      toStatus: validated.to,
      reason,
      metadata: metadata as never,
    },
  });

  return updated;
}

/** Records the initial status of a newly created subscription. */
export async function recordInitialStatus(
  tx: TransactionClient,
  subscriptionId: string,
  status: SubscriptionStatus,
  reason: string
) {
  await tx.subscriptionTransition.create({
    data: { subscriptionId, fromStatus: null, toStatus: status, reason },
  });
}
