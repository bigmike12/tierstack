import { describe, expect, it } from "vitest";
import { buildRecurringLines, intervalFromRequest, recurringAmount, sumLines, type PriceSnapshot } from "./pricing";

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

  it("refuses to invoice a usage-metered price rather than omitting the usage charge", () => {
    const metered: PriceSnapshot = { ...flat, model: "USAGE_METERED", unitAmount: null };
    expect(() =>
      buildRecurringLines({ price: metered, quantity: 1, periodStart, periodEnd, planName: "AI" })
    ).toThrow(/usage-metering engine/);
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
