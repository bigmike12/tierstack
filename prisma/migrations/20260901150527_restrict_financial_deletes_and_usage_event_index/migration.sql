-- DropForeignKey
ALTER TABLE "credit_ledger_entries" DROP CONSTRAINT "credit_ledger_entries_customerId_fkey";

-- DropForeignKey
ALTER TABLE "invoices" DROP CONSTRAINT "invoices_customerId_fkey";

-- DropForeignKey
ALTER TABLE "payment_attempts" DROP CONSTRAINT "payment_attempts_customerId_fkey";

-- DropForeignKey
ALTER TABLE "usage_events" DROP CONSTRAINT "usage_events_customerId_fkey";

-- CreateIndex
CREATE INDEX "usage_events_processedAt_createdAt_idx" ON "usage_events"("processedAt", "createdAt");

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_ledger_entries" ADD CONSTRAINT "credit_ledger_entries_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
