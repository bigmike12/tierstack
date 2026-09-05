import { describe, expect, it } from "vitest";
import { archivedCode, canRollForward, changedEconomics, resolveCurrentPrice, type PriceEconomics } from "./prices";

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
  usageMaxAmount: null,
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

describe("canRollForward", () => {
  const monthlyNgn = { intervalUnit: "MONTH", intervalCount: 1, currency: "NGN" };

  it("allows a price rise on the same schedule", () => {
    expect(canRollForward(monthlyNgn, { ...monthlyNgn })).toBe(true);
  });

  it("refuses a move from monthly to annual", () => {
    // Ten times the charge in one go is not something a price edit gets to do
    // behind the customer's back; that is a plan change, with proration.
    expect(canRollForward(monthlyNgn, { ...monthlyNgn, intervalUnit: "YEAR" })).toBe(false);
  });

  it("refuses a change in how many units of the interval", () => {
    expect(canRollForward(monthlyNgn, { ...monthlyNgn, intervalCount: 3 })).toBe(false);
  });

  it("refuses a currency change", () => {
    expect(canRollForward(monthlyNgn, { ...monthlyNgn, currency: "USD" })).toBe(false);
  });
});

describe("resolveCurrentPrice", () => {
  /** A fake price table holding one lineage: successor keyed by predecessor. */
  function table(successors: Record<string, { id: string }>) {
    return {
      price: {
        findFirst: async ({ where }: { where: { supersedesPriceId: string } }) =>
          successors[where.supersedesPriceId] ?? null,
      },
    };
  }

  it("returns null when nothing supersedes the price", async () => {
    expect(await resolveCurrentPrice(table({}), "price_1")).toBeNull();
  });

  it("finds the immediate successor", async () => {
    const t = table({ price_1: { id: "price_2" } });
    expect(await resolveCurrentPrice(t, "price_1")).toEqual({ id: "price_2" });
  });

  it("walks the whole chain, not just one hop", async () => {
    const t = table({ price_1: { id: "price_2" }, price_2: { id: "price_3" }, price_3: { id: "price_4" } });
    expect(await resolveCurrentPrice(t, "price_1")).toEqual({ id: "price_4" });
  });

  it("starts from the version the subscriber is on, not the head", async () => {
    const t = table({ price_1: { id: "price_2" }, price_2: { id: "price_3" } });
    expect(await resolveCurrentPrice(t, "price_2")).toEqual({ id: "price_3" });
  });

  it("gives up on a cycle rather than spinning during a renewal", async () => {
    const t = table({ price_1: { id: "price_2" }, price_2: { id: "price_1" } });
    // Corrupt data should not hang the billing worker. Bounded, and it returns
    // something billable rather than throwing mid-invoice.
    await expect(resolveCurrentPrice(t, "price_1", undefined, 5)).resolves.toBeTruthy();
  });
});
