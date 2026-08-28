/*
  Warnings:

  - You are about to drop the column `failureClass` on the `payment_attempts` table. All the data in the column will be lost.
  - Added the required column `environment` to the `portal_sessions` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "payment_attempts" DROP COLUMN "failureClass";

-- AlterTable
ALTER TABLE "portal_sessions" ADD COLUMN     "environment" "ApiEnvironment" NOT NULL;

-- RenameIndex
ALTER INDEX "payment_methods_organizationId_provider_providerPaymentMethodRe" RENAME TO "payment_methods_organizationId_provider_providerPaymentMeth_key";

-- RenameIndex
ALTER INDEX "payment_provider_configs_organizationId_provider_environment_ke" RENAME TO "payment_provider_configs_organizationId_provider_environmen_key";
