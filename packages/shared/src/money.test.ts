import { describe, expect, it } from "vitest";
import {
  addMoney,
  allocate,
  cappedFee,
  formatCustomerMoney,
  formatMoney,
  money,
  multiplyMoney,
  parseMoney,
  percentageOf,
  scaleMoney,
  subtractMoney,
  sumMoney,
} from "./money";
import { BillingError } from "./errors";

describe("money", () => {
  it("rejects non-integer amounts", () => {
    expect(() => money(100.5, "NGN")).toThrow(BillingError);
  });

  it("rejects unsupported currencies", () => {
    expect(() => money(100, "XXX")).toThrow(/not supported/);
  });

  it("refuses to combine different currencies", () => {
    expect(() => addMoney(money(100, "NGN"), money(100, "USD"))).toThrow(/Cannot combine/);
  });

  it("adds and subtracts exactly", () => {
    expect(addMoney(money(1000_00, "NGN"), money(250_50, "NGN")).amount).toBe(125050);
    expect(subtractMoney(money(1000_00, "NGN"), money(250_50, "NGN")).amount).toBe(74950);
  });

  it("sums a list", () => {
    const total = sumMoney([money(100, "NGN"), money(250, "NGN"), money(1, "NGN")], "NGN");
    expect(total.amount).toBe(351);
  });

  it("multiplies by seat quantity without drift", () => {
    expect(multiplyMoney(money(2000_00, "NGN"), 37).amount).toBe(7_400_000);
  });

  it("keeps precision on very large intermediate products", () => {
    // 90_000_000_00 kobo scaled by 999_999/1_000_000 overflows float precision
    // if done naively; BigInt keeps it exact.
    const result = scaleMoney(money(9_000_000_000, "NGN"), 999_999, 1_000_000);
    expect(result.amount).toBe(8_999_991_000);
  });

  it("rounds half up by default", () => {
    expect(scaleMoney(money(101, "NGN"), 1, 2).amount).toBe(51);
    expect(scaleMoney(money(101, "NGN"), 1, 2, "FLOOR").amount).toBe(50);
    expect(scaleMoney(money(101, "NGN"), 1, 2, "CEIL").amount).toBe(51);
  });

  it("rounds negative amounts away from zero symmetrically for FLOOR/CEIL", () => {
    expect(scaleMoney(money(-101, "NGN"), 1, 2, "FLOOR").amount).toBe(-51);
    expect(scaleMoney(money(-101, "NGN"), 1, 2, "CEIL").amount).toBe(-50);
  });

  it("applies basis-point percentages", () => {
    expect(percentageOf(money(10_000_00, "NGN"), 1500).amount).toBe(150_000);
    expect(percentageOf(money(999, "NGN"), 3333).amount).toBe(333);
  });

  it("allocates without losing or inventing minor units", () => {
    const shares = allocate(money(100, "NGN"), [1, 1, 1]);
    expect(shares.map((s) => s.amount)).toEqual([34, 33, 33]);
    expect(shares.reduce((sum, s) => sum + s.amount, 0)).toBe(100);
  });

  it("allocates weighted shares that still sum exactly", () => {
    const shares = allocate(money(10_000, "NGN"), [7, 2, 1]);
    expect(shares.reduce((sum, s) => sum + s.amount, 0)).toBe(10_000);
  });

  it("allocates negative amounts (credits) exactly", () => {
    const shares = allocate(money(-100, "NGN"), [1, 1, 1]);
    expect(shares.reduce((sum, s) => sum + s.amount, 0)).toBe(-100);
  });

  it("parses decimal strings into minor units", () => {
    expect(parseMoney("10000.50", "NGN").amount).toBe(1_000_050);
    expect(parseMoney("10000", "NGN").amount).toBe(1_000_000);
    expect(parseMoney("-1.05", "USD").amount).toBe(-105);
  });

  it("rejects more decimal places than the currency allows", () => {
    expect(() => parseMoney("1.005", "NGN")).toThrow(/at most 2 decimal places/);
  });

  it("formats for display", () => {
    expect(formatMoney(money(1_000_000, "NGN"))).toContain("10,000.00");
  });

  it("holds a fee at its ceiling and leaves a smaller one alone", () => {
    expect(cappedFee(20_000_000, 5_000_000)).toBe(5_000_000);
    expect(cappedFee(400_000, 5_000_000)).toBe(400_000);
    expect(cappedFee(5_000_000, 5_000_000)).toBe(5_000_000);
  });

  it("treats no cap as no ceiling, and a nonsense one as zero", () => {
    expect(cappedFee(20_000_000, null)).toBe(20_000_000);
    expect(cappedFee(20_000_000, undefined)).toBe(20_000_000);
    expect(cappedFee(20_000_000, 0)).toBe(0);
    expect(cappedFee(20_000_000, -1)).toBe(0);
  });

  it("formats for a customer with the currency's own symbol", () => {
    expect(formatCustomerMoney(money(1_000_000, "NGN"))).toBe("₦10,000.00");
    expect(formatCustomerMoney(money(-50_025, "USD"))).toBe("-$500.25");
    // The symbol comes from CURRENCIES, not from Intl, which under any single
    // locale renders some of these as ISO codes and others as symbols.
    expect(formatCustomerMoney(money(123_400, "KES"))).toBe("KSh1,234.00");
    expect(formatCustomerMoney(money(123_400, "GHS"))).toBe("GH₵1,234.00");
    expect(formatCustomerMoney(money(123_400, "ZAR"))).toBe("R1,234.00");
  });
});
