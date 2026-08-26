-- A superseded price rolls its subscribers forward onto the new version at
-- their next renewal. This holds an individual subscription back, for the
-- customer who was promised the price they signed up on.

ALTER TABLE "subscriptions" ADD COLUMN "pricePinned" BOOLEAN NOT NULL DEFAULT false;
