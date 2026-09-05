import { describe, expect, it } from "vitest";
import { formatCustomerMoney, money } from "@tierstack/shared";
import {
  assertBillablePriceModel,
  buildRecurringLines,
  buildUsageLines,
  intervalFromRequest,
  parseUsageDisplay,
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

const ngn = (minor: number) => formatCustomerMoney(money(minor, "NGN"));

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

    // 2.5% of payment volume, metered in naira: NGN 1 per 40 naira processed.
    const percentage: PriceSnapshot = {
      ...flat,
      model: "USAGE_METERED",
      unitAmount: null,
      usageMeterId: "meter_2",
      usageMeterCode: "PAYMENT_VOLUME",
      usageUnitAmount: 100,
      usageUnitSize: 40,
      includedUnits: null,
      usageDisplay: { kind: "PERCENTAGE", unitScale: 100 },
    };

    it("renders a percentage fee as a rate on money, not as blocks", () => {
      const lines = buildUsageLines({
        price: percentage,
        meterName: "Payment volume",
        unitLabel: "naira",
        used: 3_400_000,
        included: 0,
        overage: 3_400_000,
        blocks: 85_000,
        periodStart,
        periodEnd,
      });
      const overage = lines.find((line) => line.type === "OVERAGE");
      expect(overage?.description).toBe(
        `Payment volume — 2.5% of ${ngn(340_000_000)} (2026-08-01 – 2026-09-01)`
      );
      // The rate quoted in the description is the one that was charged.
      expect(overage?.amount).toBe(8_500_000);
      expect(overage?.amount).toBe(3_400_000 * 100 * 0.025);
    });

    it("leaves the block arithmetic untouched when it only changes the wording", () => {
      const [asBlocks] = buildUsageLines({
        price: { ...percentage, usageDisplay: null },
        meterName: "Payment volume",
        used: 3_400_000,
        included: 0,
        overage: 3_400_000,
        blocks: 85_000,
        periodStart,
        periodEnd,
      });
      const [asPercentage] = buildUsageLines({
        price: percentage,
        meterName: "Payment volume",
        used: 3_400_000,
        included: 0,
        overage: 3_400_000,
        blocks: 85_000,
        periodStart,
        periodEnd,
      });
      expect(asPercentage?.amount).toBe(asBlocks?.amount);
      expect(asPercentage?.quantity).toBe(asBlocks?.quantity);
      expect(asPercentage?.unitAmount).toBe(asBlocks?.unitAmount);
      expect(asPercentage?.description).not.toBe(asBlocks?.description);
    });

    it("quotes the rate against the volume it was applied to, above an allowance", () => {
      const lines = buildUsageLines({
        price: { ...percentage, includedUnits: 500_000 },
        meterName: "Payment volume",
        used: 3_400_000,
        included: 500_000,
        overage: 2_900_000,
        blocks: 72_500,
        periodStart,
        periodEnd,
      });
      expect(lines.find((line) => line.type === "USAGE")?.description).toContain(
        `${ngn(340_000_000)} processed, ${ngn(50_000_000)} included`
      );
      const overage = lines.find((line) => line.type === "OVERAGE");
      expect(overage?.description).toContain(
        `2.5% of ${ngn(290_000_000)} above the ${ngn(50_000_000)} included`
      );
      expect(overage?.amount).toBe(7_250_000);
    });

    it("trims a whole-number rate and keeps a fractional one", () => {
      const describe1 = (unitAmount: number, unitSize: number) =>
        buildUsageLines({
          price: { ...percentage, usageUnitAmount: unitAmount, usageUnitSize: unitSize },
          meterName: "Payment volume",
          used: 1_000_000,
          included: 0,
          overage: 1_000_000,
          blocks: 1,
          periodStart,
          periodEnd,
        })[0]?.description ?? "";
      expect(describe1(100, 50)).toContain("2% of");
      expect(describe1(195, 100)).toContain("1.95% of");
    });

    describe("fee cap", () => {
      // 2.5% of ₦8,000,000 is ₦200,000, held down to ₦50,000.
      const uncapped = {
        price: percentage,
        meterName: "Payment volume",
        used: 8_000_000,
        included: 0,
        overage: 8_000_000,
        blocks: 200_000,
        periodStart,
        periodEnd,
      };

      it("charges the ceiling once the fee passes it", () => {
        const [line] = buildUsageLines({
          ...uncapped,
          price: { ...percentage, usageMaxAmount: 5_000_000 },
        });
        expect(line?.amount).toBe(5_000_000);
        expect(line?.description).toContain(`capped at ${ngn(5_000_000)}, from ${ngn(20_000_000)}`);
      });

      it("keeps quantity × unitAmount equal to amount on a capped line", () => {
        const [line] = buildUsageLines({
          ...uncapped,
          price: { ...percentage, usageMaxAmount: 5_000_000 },
        });
        expect((line?.quantity ?? 0) * (line?.unitAmount ?? 0)).toBe(line?.amount);
        // The blocks actually consumed survive where anything reconciling
        // against the meter would look for them.
        expect(line?.metadata).toMatchObject({ blocks: 200_000, uncappedAmount: 20_000_000 });
      });

      it("leaves a fee below the ceiling completely alone", () => {
        const [line] = buildUsageLines({
          ...uncapped,
          price: { ...percentage, usageMaxAmount: 50_000_000 },
        });
        expect(line?.amount).toBe(20_000_000);
        expect(line?.quantity).toBe(200_000);
        expect(line?.description).not.toContain("capped");
        expect(line?.metadata).not.toHaveProperty("cap");
      });

      it("caps a block price too, not only a percentage one", () => {
        const [line] = buildUsageLines({
          price: { ...hybrid, usageMaxAmount: 100_000 },
          meterName: "AI tokens",
          unitLabel: "tokens",
          used: 152_300,
          included: 100_000,
          overage: 52_300,
          blocks: 53,
          periodStart,
          periodEnd,
        }).filter((line) => line.type === "OVERAGE");
        // 53 × ₦50 is ₦2,650, held to ₦1,000.
        expect(line?.amount).toBe(100_000);
        expect(line?.description).toContain("billed as 53 × 1,000");
        expect(line?.description).toContain("capped at");
      });
    });

    it("ignores a malformed display hint rather than failing the invoice", () => {
      for (const bad of [null, undefined, {}, "PERCENTAGE", { kind: "PERCENTAGE" }, { kind: "PERCENTAGE", unitScale: 0 }, { kind: "PERCENTAGE", unitScale: 1.5 }]) {
        expect(parseUsageDisplay(bad)).toBeNull();
      }
      expect(parseUsageDisplay({ kind: "PERCENTAGE", unitScale: 100 })).toEqual({
        kind: "PERCENTAGE",
        unitScale: 100,
      });
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
