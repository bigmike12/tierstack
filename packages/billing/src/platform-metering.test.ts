import { describe, expect, it } from "vitest";
import { MAX_UNITS } from "@tierstack/usage";
import {
  buildVolumeEvents,
  LOOKBACK_MS,
  platformOrganizationId,
  settledAt,
  volumeUnits,
  type BuildVolumeEventsContext,
  type SettledAttempt,
} from "./platform-metering";

const context: BuildVolumeEventsContext = {
  platformOrganizationId: "org_platform",
  customerId: "cus_merchant",
  sourceOrganizationId: "org_merchant",
  meterId: "meter_volume",
  currency: "NGN",
  now: new Date("2026-09-05T12:00:00Z"),
};

const attempt = (over: Partial<SettledAttempt> = {}): SettledAttempt => ({
  id: "pay_1",
  amount: 800_000_000,
  currency: "NGN",
  paidAt: new Date("2026-09-01T10:00:00Z"),
  completedAt: new Date("2026-09-01T10:00:00Z"),
  ...over,
});

describe("platform volume metering", () => {
  describe("volumeUnits", () => {
    it("converts a collected amount from minor units to major ones", () => {
      // ₦8,000,000 collected, metered as 8,000,000 naira.
      expect(volumeUnits(800_000_000, "NGN")).toBe(8_000_000);
      expect(volumeUnits(500_000, "NGN")).toBe(5_000);
      expect(volumeUnits(100, "USD")).toBe(1);
    });

    it("rounds rather than truncating, so the error has no direction", () => {
      // Flooring every payment would bias the total down on every one of them,
      // which is invisible until somebody reconciles a year of fees.
      expect(volumeUnits(1_050, "NGN")).toBe(11); // ₦10.50 → 11
      expect(volumeUnits(1_049, "NGN")).toBe(10); // ₦10.49 → 10
    });

    it("shows why a minor-unit meter is the thing to avoid", () => {
      // The same ₦21.5m collection, metered in kobo rather than naira, is past
      // the column. This is the arithmetic behind "meter money in naira".
      const collected = 21_500_000_00;
      expect(collected).toBeGreaterThan(MAX_UNITS);
      expect(volumeUnits(collected, "NGN")).toBeLessThan(MAX_UNITS);
    });
  });

  describe("buildVolumeEvents", () => {
    it("keys the event on the payment attempt, which is what makes a replay free", () => {
      const { rows } = buildVolumeEvents([attempt({ id: "pay_abc" })], context);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.eventId).toBe("pay_abc");
      expect(rows[0]!.organizationId).toBe("org_platform");
      expect(rows[0]!.customerId).toBe("cus_merchant");
      expect(rows[0]!.units).toBe(8_000_000);
    });

    it("dates the event when the money arrived, not when the outcome was processed", () => {
      // The reconciliation case: cleared at 23:58 on the last day of a period,
      // resolved by the sweep at 00:05 the next morning. Billing it on
      // completedAt puts a August payment on the September invoice.
      const cleared = new Date("2026-08-31T23:58:00Z");
      const noticed = new Date("2026-09-01T00:05:00Z");
      const { rows } = buildVolumeEvents(
        [attempt({ paidAt: cleared, completedAt: noticed })],
        context
      );
      expect(rows[0]!.timestamp).toEqual(cleared);
    });

    it("names the organization the volume came from, so an event can be traced back", () => {
      const { rows } = buildVolumeEvents([attempt()], context);
      expect(rows[0]!.metadata).toMatchObject({
        source: "platform_volume",
        sourceOrganizationId: "org_merchant",
        amountMinor: 800_000_000,
      });
    });

    it("rejects volume in another currency rather than adding it to the wrong total", () => {
      // A meter holds one scalar, and this engine has no exchange rate that
      // belongs in an invoice.
      const { rows, rejected } = buildVolumeEvents(
        [attempt({ id: "pay_usd", currency: "USD" })],
        context
      );
      expect(rows).toHaveLength(0);
      expect(rejected).toEqual([
        { attemptId: "pay_usd", reason: "collected in USD, metered in NGN" },
      ]);
    });

    it("rejects a single payment too large for the column instead of overflowing it", () => {
      const { rows, rejected } = buildVolumeEvents(
        [attempt({ id: "pay_huge", amount: (MAX_UNITS + 1) * 100 })],
        context
      );
      expect(rows).toHaveLength(0);
      expect(rejected[0]).toMatchObject({ attemptId: "pay_huge" });
    });

    it("drops a payment below one major unit rather than writing a zero", () => {
      // A row that can never change a total does not belong in the highest
      // volume table in the schema.
      const { rows, rejected } = buildVolumeEvents([attempt({ amount: 49 })], context);
      expect(rows).toHaveLength(0);
      expect(rejected).toHaveLength(0);
    });

    it("mints a distinct id per row while keeping the idempotency key stable", () => {
      const first = buildVolumeEvents([attempt()], context).rows[0]!;
      const second = buildVolumeEvents([attempt()], context).rows[0]!;
      // The primary key differs on every build; the unique constraint is on
      // eventId, which does not — so a re-run collides where it should.
      expect(first.id).not.toBe(second.id);
      expect(first.eventId).toBe(second.eventId);
    });

    it("partitions a mixed batch without letting one bad attempt drop a good one", () => {
      const { rows, rejected } = buildVolumeEvents(
        [
          attempt({ id: "pay_ok_1" }),
          attempt({ id: "pay_usd", currency: "USD" }),
          attempt({ id: "pay_ok_2", amount: 100_000 }),
          attempt({ id: "pay_dust", amount: 5 }),
        ],
        context
      );
      expect(rows.map((r) => r.eventId)).toEqual(["pay_ok_1", "pay_ok_2"]);
      expect(rejected.map((r) => r.attemptId)).toEqual(["pay_usd"]);
    });
  });

  describe("settledAt", () => {
    it("prefers what the provider said over when this platform noticed", () => {
      const cleared = new Date("2026-08-31T23:58:00Z");
      expect(settledAt(attempt({ paidAt: cleared, completedAt: new Date("2026-09-01T00:05:00Z") }), context.now))
        .toEqual(cleared);
    });

    it("falls back to processing time for a row settled before paidAt existed", () => {
      // Historical rows and the width of a rolling deploy. Never reached on a
      // row the current settlement path wrote.
      const noticed = new Date("2026-08-20T09:00:00Z");
      expect(settledAt(attempt({ paidAt: null, completedAt: noticed }), context.now)).toEqual(noticed);
    });

    it("falls back to now only when an attempt carries neither", () => {
      expect(settledAt(attempt({ paidAt: null, completedAt: null }), context.now)).toEqual(context.now);
    });
  });

  describe("platformOrganizationId", () => {
    it("is unset on an ordinary deployment, which is what makes all of this inert", () => {
      expect(platformOrganizationId({})).toBeNull();
      expect(platformOrganizationId({ PLATFORM_ORGANIZATION_ID: "" })).toBeNull();
    });

    it("names the organization that bills the others when a deployment resells itself", () => {
      expect(platformOrganizationId({ PLATFORM_ORGANIZATION_ID: "org_p" })).toBe("org_p");
    });
  });

  it("looks back far enough to absorb a worker outage without an operator", () => {
    // The window is what replaces a watermark on the scheduled pass: it re-reads
    // a day of settled attempts and writes only the missing ones, so downtime
    // shorter than this heals itself on the next tick. Billing correctness does
    // not depend on it either way — the renewal flush is what guarantees that.
    expect(LOOKBACK_MS).toBe(86_400_000);
  });
});
