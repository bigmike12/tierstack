import { describe, expect, it } from "vitest";
import {
  assertBillablePriceModel,
  buildRecurringLines,
  buildUsageLines,
  intervalFromRequest,
  recurringAmount,
  sumLines,
  type PriceSnapshot,
} from "./pricing";

const flat: PriceSnapshot = {
  id: "price_1",
  code: "pro_monthly_ngn",
  model: "FLAT_RECURRING",
  currency: "NGN",
  unitAmount: 1_000_000,
  intervalUnit: "MONTH",
  intervalCount: 1,
};

const seat: PriceSnapshot = { ...flat, id: "price_2", code: "team_seat_ngn", model: "PER_SEAT", unitAmount: 200_000 };

const periodStart = new Date("2026-08-01T00:00:00Z");
const periodEnd = new Date("2026-09-01T00:00:00Z");

describe("pricing", () => {
  it("prices a flat recurring plan", () => {
    expect(recurringAmount(flat, 1).amount).toBe(1_000_000);
    const lines = buildRecurringLines({ price: flat, quantity: 1, periodStart, periodEnd, planName: "Pro" });
    expect(lines).toHaveLength(1);
    expect(lines[0]?.type).toBe("SUBSCRIPTION");
    expect(sumLines(lines, "NGN").amount).toBe(1_000_000);
  });

  it("ignores quantity on a flat plan", () => {
    expect(recurringAmount(flat, 9).amount).toBe(1_000_000);
  });

  it("prices per-seat by quantity", () => {
    expect(recurringAmount(seat, 12).amount).toBe(2_400_000);
    const lines = buildRecurringLines({ price: seat, quantity: 12, periodStart, periodEnd, planName: "Team" });
    expect(lines[0]?.type).toBe("SEAT");
    expect(lines[0]?.quantity).toBe(12);
    expect(lines[0]?.amount).toBe(2_400_000);
    expect(lines[0]?.description).toContain("12 seats");
  });

  it("bills nothing in advance for a pure usage price", () => {
    const metered: PriceSnapshot = {
      ...flat,
      model: "USAGE_METERED",
      unitAmount: null,
      usageMeterId: "meter_1",
      usageMeterCode: "AI_TOKENS",
      usageUnitAmount: 5000,
      usageUnitSize: 1000,
    };
    expect(buildRecurringLines({ price: metered, quantity: 1, periodStart, periodEnd, planName: "AI" })).toEqual([]);
  });

  it("bills only the base fee in advance on a hybrid price", () => {
    const hybrid: PriceSnapshot = {
      ...flat,
      model: "HYBRID",
      unitAmount: 1_000_000,
      usageMeterId: "meter_1",
      usageMeterCode: "AI_TOKENS",
      usageUnitAmount: 2_000,
      usageUnitSize: 1,
      includedUnits: 100_000,
    };
    const lines = buildRecurringLines({ price: hybrid, quantity: 1, periodStart, periodEnd, planName: "AI" });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ type: "SUBSCRIPTION", amount: 1_000_000 });
  });

  it("refuses a metered price with no meter attached, rather than under-charging later", () => {
    expect(() =>
      assertBillablePriceModel({ ...flat, model: "USAGE_METERED", unitAmount: null })
    ).toThrow(/no usage meter attached/);
  });

  it("refuses a usage-metered price with no rate", () => {
    expect(() =>
      assertBillablePriceModel({ ...flat, model: "USAGE_METERED", unitAmount: null, usageMeterId: "m", usageUnitAmount: null })
    ).toThrow(/never charge anything/);
  });

  describe("usage lines", () => {
    const hybrid: PriceSnapshot = {
      ...flat,
      model: "HYBRID",
      usageMeterId: "meter_1",
      usageMeterCode: "AI_TOKENS",
      usageUnitAmount: 5_000,
      usageUnitSize: 1_000,
      includedUnits: 100_000,
    };

    it("records included usage as a zero-value line so the invoice explains itself", () => {
      const lines = buildUsageLines({
        price: hybrid,
        meterName: "AI tokens",
        unitLabel: "tokens",
        used: 40_000,
        included: 100_000,
        overage: 0,
        blocks: 0,
        periodStart,
        periodEnd,
      });
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatchObject({ type: "USAGE", amount: 0 });
      expect(lines[0]?.description).toContain("100,000 included");
    });

    it("charges overage by whole blocks", () => {
      const lines = buildUsageLines({
        price: hybrid,
        meterName: "AI tokens",
        unitLabel: "tokens",
        used: 152_300,
        included: 100_000,
        overage: 52_300,
        blocks: 53,
        periodStart,
        periodEnd,
      });
      const overage = lines.find((line) => line.type === "OVERAGE");
      expect(overage).toMatchObject({ quantity: 53, unitAmount: 5_000, amount: 265_000 });
    });

    it("emits nothing when there is no usage and nothing included", () => {
      expect(
        buildUsageLines({
          price: { ...hybrid, includedUnits: null },
          meterName: "AI tokens",
          used: 0,
          included: 0,
          overage: 0,
          blocks: 0,
          periodStart,
          periodEnd,
        })
      ).toEqual([]);
    });
  });

  it("rejects a price whose model needs a unit amount but has none", () => {
    const broken: PriceSnapshot = { ...flat, unitAmount: null };
    expect(() => recurringAmount(broken, 1)).toThrow(/has no unitAmount/);
  });

  it("maps request intervals onto the canonical representation", () => {
    expect(intervalFromRequest("QUARTERLY")).toEqual({ intervalUnit: "MONTH", intervalCount: 3 });
    expect(intervalFromRequest("BI_WEEKLY")).toEqual({ intervalUnit: "WEEK", intervalCount: 2 });
    expect(intervalFromRequest("CUSTOM_DAYS", 45)).toEqual({ intervalUnit: "DAY", intervalCount: 45 });
    expect(() => intervalFromRequest("FORTNIGHTLY")).toThrow(/Unknown billing interval/);
  });
});
