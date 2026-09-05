-- When the provider says the money arrived, as distinct from when this platform
-- finished processing the outcome.
--
-- Reconciliation settles an attempt whenever it happens to run, which can be
-- hours after the payment cleared. Anything that bills on a period boundary —
-- platform volume metering — has to use settlement time, or a payment that
-- cleared at 23:58 and was reconciled at 00:05 is billed to the wrong month.
ALTER TABLE "payment_attempts" ADD COLUMN "paidAt" TIMESTAMP(3);

-- Historical rows: completedAt is the only estimate of settlement that exists
-- for them, and it is exactly right for every attempt a webhook resolved
-- promptly, which is nearly all of them. Doing this now means the scan below
-- can filter on one column instead of coalescing two.
--
-- A single statement because payment_attempts is small today. Once it is not,
-- run this in batches ahead of the deploy — it takes a write lock on every
-- settled row.
UPDATE "payment_attempts"
   SET "paidAt" = "completedAt"
 WHERE "status" = 'SUCCEEDED'
   AND "completedAt" IS NOT NULL;

-- Superseded: metering now walks settlement time rather than processing time,
-- and nothing else queries completedAt as a range.
DROP INDEX IF EXISTS "payment_attempts_organizationId_status_completedAt_idx";

CREATE INDEX IF NOT EXISTS "payment_attempts_organizationId_status_paidAt_idx"
  ON "payment_attempts"("organizationId", "status", "paidAt");
