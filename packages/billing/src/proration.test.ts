import { describe, expect, it } from "vitest";
import { money } from "@tierbase/shared";
import { calculateProration, calculateSeatProration, sumProrationLines } from "./proration";

const periodStart = new Date("2026-08-01T00:00:00Z");
const periodEnd = new Date("2026-08-31T00:00:00Z"); // exactly 30 days

describe("proration", () => {
  it("credits unused time and charges the new rate for the same window", () => {
    const result = calculateProration({
      periodStart,
      periodEnd,
      changeAt: new Date("2026-08-11T00:00:00Z"), // 20 of 30 days remain
      currentAmount: money(1_000_000, "NGN"), // ₦10,000
      newAmount: money(2_500_000, "NGN"), // ₦25,000
    });

    expect(result.unusedCredit.amount).toBe(666_667); // 2/3 of ₦10,000
    expect(result.newPeriodCharge.amount).toBe(1_666_667); // 2/3 of ₦25,000
    expect(result.netAmount.amount).toBe(1_000_000);
  });

  it("emits a credit line and a charge line that sum to the net", () => {
    const result = calculateProration({
      periodStart,
      periodEnd,
      changeAt: new Date("2026-08-16T00:00:00Z"),
      currentAmount: money(1_000_000, "NGN"),
      newAmount: money(2_500_000, "NGN"),
    });
    expect(result.lines).toHaveLength(2);
    expect(result.lines[0]?.amount).toBeLessThan(0);
    expect(result.lines[1]?.amount).toBeGreaterThan(0);
    expect(sumProrationLines(result.lines, "NGN").amount).toBe(result.netAmount.amount);
  });

  it("produces a negative net on a downgrade", () => {
    const result = calculateProration({
      periodStart,
      periodEnd,
      changeAt: new Date("2026-08-16T00:00:00Z"),
      currentAmount: money(2_500_000, "NGN"),
      newAmount: money(1_000_000, "NGN"),
    });
    expect(result.netAmount.amount).toBeLessThan(0);
  });

  it("charges nothing when the change lands on the period end", () => {
    const result = calculateProration({
      periodStart,
      periodEnd,
      changeAt: periodEnd,
      currentAmount: money(1_000_000, "NGN"),
      newAmount: money(2_500_000, "NGN"),
    });
    expect(result.netAmount.amount).toBe(0);
    expect(result.lines).toHaveLength(0);
  });

  it("charges the full difference when the change lands on the period start", () => {
    const result = calculateProration({
      periodStart,
      periodEnd,
      changeAt: periodStart,
      currentAmount: money(1_000_000, "NGN"),
      newAmount: money(2_500_000, "NGN"),
    });
    expect(result.netAmount.amount).toBe(1_500_000);
  });

  it("clamps a change date after the period end", () => {
    const result = calculateProration({
      periodStart,
      periodEnd,
      changeAt: new Date("2026-09-15T00:00:00Z"),
      currentAmount: money(1_000_000, "NGN"),
      newAmount: money(2_500_000, "NGN"),
    });
    expect(result.remainingMs).toBe(0);
    expect(result.netAmount.amount).toBe(0);
  });

  it("refuses to prorate across currencies", () => {
    expect(() =>
      calculateProration({
        periodStart,
        periodEnd,
        changeAt: periodStart,
        currentAmount: money(1_000_000, "NGN"),
        newAmount: money(25_00, "USD"),
      })
    ).toThrow(/Cannot prorate/);
  });

  it("prorates only the seat delta on a seat increase", () => {
    const result = calculateSeatProration({
      periodStart,
      periodEnd,
      changeAt: new Date("2026-08-16T00:00:00Z"), // half the period remains
      unitAmount: money(200_000, "NGN"), // ₦2,000 per seat
      fromQuantity: 5,
      toQuantity: 8,
    });
    // 3 extra seats x ₦2,000 x 1/2 period = ₦3,000
    expect(result.netAmount.amount).toBe(300_000);
    expect(result.lines[0]?.quantity).toBe(3);
  });

  it("credits on a seat decrease", () => {
    const result = calculateSeatProration({
      periodStart,
      periodEnd,
      changeAt: new Date("2026-08-16T00:00:00Z"),
      unitAmount: money(200_000, "NGN"),
      fromQuantity: 8,
      toQuantity: 5,
    });
    expect(result.netAmount.amount).toBe(-300_000);
  });

  it("does nothing when the seat count is unchanged", () => {
    const result = calculateSeatProration({
      periodStart,
      periodEnd,
      changeAt: new Date("2026-08-16T00:00:00Z"),
      unitAmount: money(200_000, "NGN"),
      fromQuantity: 5,
      toQuantity: 5,
    });
    expect(result.netAmount.amount).toBe(0);
    expect(result.lines).toHaveLength(0);
  });
});
