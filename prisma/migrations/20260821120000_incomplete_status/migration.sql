-- Distinguish a subscription that has never been paid from one that has lapsed.
--
-- Before this change a brand-new subscription whose first payment never settled
-- was placed in PAST_DUE and given a grace period, which meant an abandoned
-- checkout could be granted full service under a FULL_ACCESS grace policy.

ALTER TYPE "SubscriptionStatus" ADD VALUE IF NOT EXISTS 'INCOMPLETE' BEFORE 'TRIALING';

ALTER TABLE "billing_settings"
  ADD COLUMN IF NOT EXISTS "incompleteExpiryHours" INTEGER NOT NULL DEFAULT 24;
