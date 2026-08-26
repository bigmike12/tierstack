-- Transactional email: the settings that govern it, and the record of every
-- message the platform decided to send.

ALTER TABLE "billing_settings" ADD COLUMN "notificationsEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "billing_settings" ADD COLUMN "priceChangeNoticeDays" INTEGER NOT NULL DEFAULT 7;
ALTER TABLE "billing_settings" ADD COLUMN "trialEndingNoticeDays" INTEGER NOT NULL DEFAULT 3;
ALTER TABLE "billing_settings" ADD COLUMN "supportEmail" TEXT;
ALTER TABLE "billing_settings" ADD COLUMN "senderName" TEXT;

CREATE TYPE "EmailStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'SUPPRESSED');

CREATE TABLE "email_messages" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "customerId" TEXT,
    "subscriptionId" TEXT,
    "invoiceId" TEXT,
    "type" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "toEmail" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "status" "EmailStatus" NOT NULL DEFAULT 'PENDING',
    "provider" TEXT,
    "providerMessageId" TEXT,
    "failureReason" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "email_messages_pkey" PRIMARY KEY ("id")
);

-- One send per decision. This is the constraint the retry loop leans on.
CREATE UNIQUE INDEX "email_messages_organizationId_dedupeKey_key" ON "email_messages"("organizationId", "dedupeKey");
CREATE INDEX "email_messages_organizationId_type_createdAt_idx" ON "email_messages"("organizationId", "type", "createdAt");
CREATE INDEX "email_messages_status_createdAt_idx" ON "email_messages"("status", "createdAt");

ALTER TABLE "email_messages"
  ADD CONSTRAINT "email_messages_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "organizations"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
