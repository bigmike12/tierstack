-- AlterTable
ALTER TABLE "email_messages" ADD COLUMN     "attempts" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "email_messages_customerId_createdAt_idx" ON "email_messages"("customerId", "createdAt");
