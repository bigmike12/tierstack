-- A price whose economics change while subscribers are bound to it is
-- superseded by a new version rather than edited in place, so nobody is
-- silently repriced. These two columns record the lineage.

ALTER TABLE "prices" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "prices" ADD COLUMN "supersedesPriceId" TEXT;

CREATE INDEX "prices_supersedesPriceId_idx" ON "prices"("supersedesPriceId");

ALTER TABLE "prices"
  ADD CONSTRAINT "prices_supersedesPriceId_fkey"
  FOREIGN KEY ("supersedesPriceId") REFERENCES "prices"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
