import { describe, expect, it } from "vitest";
import { aggregate, assertAggregation } from "./aggregation";
import { billableBlocks, cappedFee, computeQuota } from "./quota";

const at = (iso: string) => new Date(iso);

describe("usage aggregation", () => {
  const events = [
    { units: 100, timestamp: at("2026-08-01T00:00:00Z"), metadata: { uniqueKey: "u1" } },
    { units: 400, timestamp: at("2026-08-03T00:00:00Z"), metadata: { uniqueKey: "u2" } },
    { units: 250, timestamp: at("2026-08-02T00:00:00Z"), metadata: { uniqueKey: "u1" } },
  ];

  it("sums consumption", () => {
    expect(aggregate(events, "SUM")).toBe(750);
  });

  it("takes the high-water mark", () => {
    expect(aggregate(events, "MAX")).toBe(400);
  });

  it("takes the latest reading by timestamp, not by array order", () => {
    expect(aggregate(events, "LAST")).toBe(400);
  });

  it("counts distinct keys rather than events", () => {
    expect(aggregate(events, "UNIQUE_COUNT")).toBe(2);
  });

  it("ignores events with no unique key when counting distinct", () => {
    expect(aggregate([...events, { units: 1, timestamp: at("2026-08-04T00:00:00Z") }], "UNIQUE_COUNT")).toBe(2);
  });

  it("returns zero for an empty period", () => {
    for (const method of ["SUM", "MAX", "LAST", "UNIQUE_COUNT"] as const) {
      expect(aggregate([], method)).toBe(0);
    }
  });

  it("rejects an unknown aggregation", () => {
    expect(() => assertAggregation("AVERAGE")).toThrow(/Unknown usage aggregation/);
  });
});

describe("quota", () => {
  it("reports remaining allowance before overage", () => {
    expect(computeQuota({ used: 742, includedUnits: 1000 })).toEqual({
      used: 742,
      included: 1000,
      remaining: 258,
      overage: 0,
      exhausted: false,
    });
  });

  it("reports overage once the allowance is spent", () => {
    expect(computeQuota({ used: 1500, includedUnits: 1000 })).toMatchObject({
      remaining: 0,
      overage: 500,
      exhausted: true,
    });
  });

  it("treats a missing allowance as zero included", () => {
    expect(computeQuota({ used: 40, includedUnits: null })).toMatchObject({
      included: 0,
      remaining: 0,
      overage: 40,
      exhausted: true,
    });
  });

  it("is exhausted exactly at the boundary", () => {
    expect(computeQuota({ used: 1000, includedUnits: 1000 })).toMatchObject({
      remaining: 0,
      overage: 0,
      exhausted: true,
    });
  });

  it("charges a started block in full", () => {
    expect(billableBlocks(1500, 1000)).toBe(2);
    expect(billableBlocks(1000, 1000)).toBe(1);
    expect(billableBlocks(1, 1000)).toBe(1);
    expect(billableBlocks(0, 1000)).toBe(0);
  });

  it("defaults to per-unit pricing when no block size is set", () => {
    expect(billableBlocks(37, null)).toBe(37);
    expect(billableBlocks(37, 1)).toBe(37);
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
});
