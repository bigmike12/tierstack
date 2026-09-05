-- Ceiling on the metered charge for one billing period, in minor units.
-- Nullable, and null means uncapped: every price that exists today keeps
-- billing exactly as it does now.
ALTER TABLE "prices" ADD COLUMN "usageMaxAmount" INTEGER;
