import { describe, expect, it } from "vitest";
import { assertPayable, computeTotals } from "./invoice";
import type { ComputedLine } from "./pricing";

const line = (over: Partial<ComputedLine>): ComputedLine => ({
  type: "SUBSCRIPTION",
  description: "x",
  quantity: 1,
  unitAmount: 0,
  amount: 0,
  currency: "NGN",
  ...over,
});

describe("invoice totals", () => {
  it("sums charge lines into the subtotal", () => {
    const totals = computeTotals([
      line({ type: "SUBSCRIPTION", amount: 1_000_000 }),
      line({ type: "SEAT", amount: 400_000 }),
    ]);
    expect(totals.subtotal).toBe(1_400_000);
    expect(totals.total).toBe(1_400_000);
    expect(totals.amountDue).toBe(1_400_000);
  });

  it("reports discounts and credits separately from the subtotal", () => {
    const totals = computeTotals([
      line({ type: "SUBSCRIPTION", amount: 1_000_000 }),
      line({ type: "COUPON", amount: -150_000 }),
      line({ type: "CREDIT", amount: -200_000 }),
    ]);
    expect(totals.subtotal).toBe(1_000_000);
    expect(totals.discountAmount).toBe(150_000);
    expect(totals.creditAmount).toBe(200_000);
    expect(totals.total).toBe(650_000);
  });

  it("adds tax on top", () => {
    const totals = computeTotals([
      line({ type: "SUBSCRIPTION", amount: 1_000_000 }),
      line({ type: "TAX", amount: 75_000 }),
    ]);
    expect(totals.taxAmount).toBe(75_000);
    expect(totals.total).toBe(1_075_000);
  });

  it("includes negative proration lines in the subtotal", () => {
    const totals = computeTotals([
      line({ type: "PRORATION", amount: -500_000 }),
      line({ type: "PRORATION", amount: 1_250_000 }),
    ]);
    expect(totals.total).toBe(750_000);
  });

  it("never reports a negative amount due", () => {
    const totals = computeTotals([line({ type: "PRORATION", amount: -500_000 })]);
    expect(totals.total).toBe(-500_000);
    expect(totals.amountDue).toBe(0);
  });

  it("subtracts what has already been paid", () => {
    const totals = computeTotals([line({ amount: 1_000_000 })], 400_000);
    expect(totals.amountDue).toBe(600_000);
  });

  it("guards payment against invoices that cannot take it", () => {
    expect(() => assertPayable({ status: "PAID", amountDue: 0 })).toThrow(/already been paid/);
    expect(() => assertPayable({ status: "VOID", amountDue: 100 })).toThrow(/cannot be paid/);
    expect(() => assertPayable({ status: "OPEN", amountDue: 0 })).toThrow(/nothing left to pay/);
    expect(() => assertPayable({ status: "OPEN", amountDue: 100 })).not.toThrow();
  });
});
