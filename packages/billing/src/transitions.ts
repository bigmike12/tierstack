import type { TransactionClient } from "@tierstack/database";
import { BillingError } from "@tierstack/shared";
import { notifyEntitlementChange } from "./invalidation";
import { transition, type SubscriptionStatus } from "./state-machine";

/**
 * Applies a validated status change and appends the audit row in one place.
 * Nothing else in the codebase writes `subscription.status`.
 *
 * The `where` carries the expected prior status as a compare-and-swap: every
 * caller reads `from` early and writes late inside its own transaction, with
 * nothing else serializing concurrent callers against each other (a dunning
 * retry succeeding at the same moment the grace-expiry sweep decides to
 * cancel, for instance). If another transaction already moved this
 * subscription since `from` was read, this update matches zero rows instead
 * of silently overwriting a transition it never actually observed.
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

  let updated;
  try {
    updated = await tx.subscription.update({
      where: { id: subscriptionId, status: validated.from },
      data: { status: validated.to, ...extraData } as never,
    });
  } catch (error) {
    if ((error as { code?: string }).code === "P2025") {
      throw new BillingError(
        "INVALID_STATE_TRANSITION",
        `Subscription ${subscriptionId} was no longer ${validated.from} when this change was applied — it was updated concurrently.`
      );
    }
    throw error;
  }

  await tx.subscriptionTransition.create({
    data: {
      subscriptionId,
      fromStatus: validated.from,
      toStatus: validated.to,
      reason,
      metadata: metadata as never,
    },
  });

  // Status drives entitlement access, so any cached answer for this customer is
  // now stale. Every status change in the system passes through here.
  await notifyEntitlementChange(updated.organizationId, updated.customerId);

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
