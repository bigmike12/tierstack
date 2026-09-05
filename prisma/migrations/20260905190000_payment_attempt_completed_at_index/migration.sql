-- Platform volume metering selects one organization's settled attempts over a
-- time window, both at renewal and on a schedule. The existing
-- (organizationId, status) index leaves completedAt to be filtered in memory,
-- which degrades with every payment an organization has ever taken.
--
-- Plain CREATE INDEX because Prisma runs migrations in a transaction and
-- CONCURRENTLY cannot. On a payment_attempts table large enough for the write
-- lock to matter, run the CONCURRENTLY form by hand ahead of deploying and this
-- statement becomes a no-op.
CREATE INDEX IF NOT EXISTS "payment_attempts_organizationId_status_completedAt_idx"
  ON "payment_attempts"("organizationId", "status", "completedAt");
