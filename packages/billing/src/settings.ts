import type { TransactionClient } from "@tierbase/database";
import { newId } from "@tierbase/shared";
import type { DunningPolicy } from "./grace";

/**
 * Reads the organization's billing policy, creating the default row on first
 * use. The values here are the developer's — the engine never substitutes its
 * own grace period, retry schedule or failure action.
 */
export async function loadDunningPolicy(
  tx: TransactionClient,
  organizationId: string
): Promise<DunningPolicy> {
  let settings = await tx.billingSettings.findUnique({ where: { organizationId } });
  if (!settings) {
    settings = await tx.billingSettings.create({
      data: { id: newId("organization"), organizationId },
    });
  }
  return {
    gracePeriodDays: settings.gracePeriodDays,
    maxRetryAttempts: settings.maxRetryAttempts,
    retryIntervals: settings.retryIntervals,
    accessDuringGracePeriod: settings.accessDuringGracePeriod as DunningPolicy["accessDuringGracePeriod"],
    failureAction: settings.failureAction as DunningPolicy["failureAction"],
    invoiceDueDays: settings.invoiceDueDays,
    incompleteExpiryHours: settings.incompleteExpiryHours,
  };
}

export async function loadBillingSettings(tx: TransactionClient, organizationId: string) {
  const existing = await tx.billingSettings.findUnique({ where: { organizationId } });
  if (existing) return existing;
  return tx.billingSettings.create({ data: { id: newId("organization"), organizationId } });
}
