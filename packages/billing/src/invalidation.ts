/**
 * A hook the entitlement cache registers once at process start.
 *
 * Subscription status changes originate in three places — the API, the
 * background worker, and provider webhooks — so invalidating at each call site
 * would mean remembering to do it in a dozen places and eventually forgetting
 * one. A customer denied access for sixty seconds after their payment cleared
 * is a support ticket, so this is wired at the single point every status change
 * already flows through: `applyTransition`.
 *
 * The billing package deliberately does not depend on Redis; it only announces
 * that something changed.
 */
export type EntitlementInvalidator = (
  organizationId: string,
  customerId: string | null
) => void | Promise<void>;

let invalidator: EntitlementInvalidator | null = null;

export function setEntitlementInvalidator(fn: EntitlementInvalidator | null): void {
  invalidator = fn;
}

/** Best effort: a cache problem must never fail a billing operation. */
export async function notifyEntitlementChange(
  organizationId: string,
  customerId: string | null
): Promise<void> {
  if (!invalidator) return;
  try {
    await invalidator(organizationId, customerId);
  } catch {
    /* ignored by design */
  }
}
