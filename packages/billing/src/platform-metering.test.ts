import { describe, expect, it } from "vitest";
import { MAX_UNITS } from "@tierstack/usage";
import { LOOKBACK_MS, volumeUnits } from "./platform-metering";

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

    it("rounds a payment below one major unit away, rather than to a phantom unit", () => {
      expect(volumeUnits(49, "NGN")).toBe(0);
      expect(volumeUnits(0, "NGN")).toBe(0);
    });

    it("keeps a realistic single payment far inside what the column holds", () => {
      // The largest card payment anyone plausibly takes, in the major unit.
      expect(volumeUnits(10_000_000_00, "NGN")).toBeLessThan(MAX_UNITS);
    });

    it("shows why a minor-unit meter is the thing to avoid", () => {
      // The same ₦21.5m collection, metered in kobo rather than naira, is past
      // the column. This is the arithmetic behind "meter money in naira".
      const collected = 21_500_000_00;
      expect(collected).toBeGreaterThan(MAX_UNITS);
      expect(volumeUnits(collected, "NGN")).toBeLessThan(MAX_UNITS);
    });
  });

  it("looks back far enough to absorb a worker outage without an operator", () => {
    // The window is what replaces a watermark: a pass re-reads a day of settled
    // attempts and writes only the missing ones, so downtime shorter than this
    // heals itself on the next tick.
    expect(LOOKBACK_MS).toBe(86_400_000);
  });
});
