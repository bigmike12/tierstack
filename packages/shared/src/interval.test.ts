import { describe, expect, it } from "vitest";
import { addInterval, computeBillingPeriod, resolveInterval } from "./interval";
import { BillingError } from "./errors";

const at = (iso: string) => new Date(iso);

describe("billing intervals", () => {
  it("resolves named intervals to the canonical representation", () => {
    expect(resolveInterval("MONTHLY")).toEqual({ unit: "MONTH", count: 1 });
    expect(resolveInterval("BI_WEEKLY")).toEqual({ unit: "WEEK", count: 2 });
    expect(resolveInterval("QUARTERLY")).toEqual({ unit: "MONTH", count: 3 });
    expect(resolveInterval("SEMI_ANNUALLY")).toEqual({ unit: "MONTH", count: 6 });
    expect(resolveInterval("CUSTOM_DAYS", 90)).toEqual({ unit: "DAY", count: 90 });
  });

  it("rejects CUSTOM_DAYS without a day count", () => {
    expect(() => resolveInterval("CUSTOM_DAYS")).toThrow(BillingError);
  });

  it("advances day and week intervals", () => {
    expect(addInterval(at("2026-01-01T00:00:00Z"), { unit: "DAY", count: 90 }).toISOString()).toBe(
      "2026-04-01T00:00:00.000Z"
    );
    expect(addInterval(at("2026-01-01T00:00:00Z"), { unit: "WEEK", count: 2 }).toISOString()).toBe(
      "2026-01-15T00:00:00.000Z"
    );
  });

  it("clamps month-end anchors instead of rolling into the next month", () => {
    const jan31 = at("2026-01-31T09:00:00Z");
    const feb = addInterval(jan31, { unit: "MONTH", count: 1 });
    expect(feb.toISOString()).toBe("2026-02-28T09:00:00.000Z");
  });

  it("restores the original anchor day after a clamped month", () => {
    const anchorDay = 31;
    const feb = addInterval(at("2026-01-31T09:00:00Z"), { unit: "MONTH", count: 1 }, anchorDay);
    const mar = addInterval(feb, { unit: "MONTH", count: 1 }, anchorDay);
    expect(feb.toISOString()).toBe("2026-02-28T09:00:00.000Z");
    expect(mar.toISOString()).toBe("2026-03-31T09:00:00.000Z");
  });

  it("handles leap years", () => {
    const feb29 = addInterval(at("2028-01-31T00:00:00Z"), { unit: "MONTH", count: 1 }, 31);
    expect(feb29.toISOString()).toBe("2028-02-29T00:00:00.000Z");
  });

  it("advances annual intervals", () => {
    expect(addInterval(at("2026-08-21T00:00:00Z"), { unit: "YEAR", count: 1 }).toISOString()).toBe(
      "2027-08-21T00:00:00.000Z"
    );
  });

  it("computes a billing period", () => {
    const period = computeBillingPeriod(at("2026-08-21T00:00:00Z"), { unit: "MONTH", count: 1 });
    expect(period.end.toISOString()).toBe("2026-09-21T00:00:00.000Z");
  });
});
