-- A decline that will never clear by waiting should not walk the same four-step
-- retry ladder as one that will. The class is decided at the adapter and stored
-- with the attempt.

ALTER TABLE "payment_attempts" ADD COLUMN "failureClass" TEXT;
