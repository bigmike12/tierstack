import { describe, expect, it } from "vitest";
import { archivedCode, changedEconomics, type PriceEconomics } from "./prices";

const base: PriceEconomics = {
  model: "FLAT_RECURRING",
  currency: "NGN",
  unitAmount: 500_000,
  intervalUnit: "MONTH",
  intervalCount: 1,
  usageMeterId: null,
  usageUnitAmount: null,
  usageUnitSize: 1,
  includedUnits: null,
};

describe("changedEconomics", () => {
  it("reports nothing for an empty patch", () => {
    expect(changedEconomics(base, {})).toEqual([]);
  });

  it("ignores fields resubmitted with the value they already have", () => {
    // The edit form posts every field on every save. Treating that as a
    // reprice would version the price on a nickname change.
    expect(changedEconomics(base, { ...base })).toEqual([]);
  });

  it("catches an amount change", () => {
    expect(changedEconomics(base, { unitAmount: 600_000 })).toEqual(["unitAmount"]);
  });

  it("catches a change to zero, which is falsy but not absent", () => {
    expect(changedEconomics(base, { unitAmount: 0 })).toEqual(["unitAmount"]);
  });

  it("catches an interval change", () => {
    expect(changedEconomics(base, { intervalUnit: "YEAR", intervalCount: 1 })).toEqual([
      "intervalUnit",
    ]);
  });

  it("catches a currency change", () => {
    expect(changedEconomics(base, { currency: "KES" })).toEqual(["currency"]);
  });

  it("treats null and undefined alike, so clearing an unset field is not a change", () => {
    expect(changedEconomics(base, { includedUnits: null })).toEqual([]);
  });

  it("catches a usage meter being attached", () => {
    expect(changedEconomics(base, { usageMeterId: "meter_1" })).toEqual(["usageMeterId"]);
  });

  it("reports every changed field, not just the first", () => {
    expect(
      changedEconomics(base, { unitAmount: 1, intervalCount: 3, includedUnits: 100 })
    ).toEqual(["unitAmount", "intervalCount", "includedUnits"]);
  });

  it("does not consider trial length economic", () => {
    // A subscription's trial window lives on the subscription row, so changing
    // the price's trial length cannot move anyone already trialing.
    expect(changedEconomics(base, { trialDays: 30 } as never)).toEqual([]);
  });
});

describe("archivedCode", () => {
  it("suffixes the outgoing version", () => {
    expect(archivedCode("pro_monthly_ngn", 1)).toBe("pro_monthly_ngn-v1");
  });

  it("keeps counting past the first supersede", () => {
    expect(archivedCode("pro_monthly_ngn", 7)).toBe("pro_monthly_ngn-v7");
  });

  it("stays inside the column's 64 characters", () => {
    const long = "a".repeat(64);
    expect(archivedCode(long, 12)).toHaveLength(64);
    expect(archivedCode(long, 12).endsWith("-v12")).toBe(true);
  });
});
