-- AlterTable
ALTER TABLE "organization_members" ADD COLUMN     "inviteTokenExpiresAt" TIMESTAMP(3),
ADD COLUMN     "inviteTokenHash" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "organization_members_inviteTokenHash_key" ON "organization_members"("inviteTokenHash");
