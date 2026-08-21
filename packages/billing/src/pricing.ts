import {
  BillingError,
  addMoney,
  assertCurrency,
  money,
  multiplyMoney,
  resolveInterval,
  type BillingInterval,
  type CurrencyCode,
  type Money,
} from "@billing-platform/shared";

export type PricingModel = "FLAT_RECURRING" | "PER_SEAT" | "USAGE_METERED" | "HYBRID";
export type LineItemType =
  | "SUBSCRIPTION"
  | "SEAT"
  | "USAGE"
  | "OVERAGE"
  | "COUPON"
  | "CREDIT"
  | "PRORATION"
  | "TAX";

/** The subset of a Price row the pricing calculations need. */
export interface PriceSnapshot {
  id: string;
  code: string;
  nickname?: string | null;
  model: PricingModel;
  currency: string;
  unitAmount: number | null;
  intervalUnit: "DAY" | "WEEK" | "MONTH" | "YEAR";
  intervalCount: number;
  usageUnitAmount?: number | null;
  usageUnitSize?: number | null;
  includedUnits?: number | null;
  trialDays?: number | null;
}

export interface ComputedLine {
  type: LineItemType;
  description: string;
  quantity: number;
  unitAmount: number;
  amount: number;
  currency: CurrencyCode;
  periodStart?: Date;
  periodEnd?: Date;
  metadata?: Record<string, unknown>;
}

export function priceInterval(price: PriceSnapshot): BillingInterval {
  return { unit: price.intervalUnit, count: price.intervalCount };
}

export function priceCurrency(price: PriceSnapshot): CurrencyCode {
  return assertCurrency(price.currency);
}

/**
 * The recurring value of a subscription for one full period, before proration,
 * discounts, credits and usage.
 */
export function recurringAmount(price: PriceSnapshot, quantity: number): Money {
  const currency = priceCurrency(price);
  switch (price.model) {
    case "FLAT_RECURRING":
      return money(requireUnitAmount(price), currency);
    case "PER_SEAT":
      return multiplyMoney(money(requireUnitAmount(price), currency), quantity);
    case "HYBRID":
      return money(requireUnitAmount(price), currency);
    case "USAGE_METERED":
      return money(0, currency);
  }
}

/**
 * Line items for one billing period of a subscription.
 *
 * Usage-based components are deliberately absent: metered charges are computed
 * by the usage engine, which lands in phase 2. Rather than issue an invoice
 * that silently omits metered charges, `assertBillablePriceModel` refuses the
 * subscription up front.
 */
export function buildRecurringLines(params: {
  price: PriceSnapshot;
  quantity: number;
  periodStart: Date;
  periodEnd: Date;
  planName: string;
}): ComputedLine[] {
  const { price, quantity, periodStart, periodEnd, planName } = params;
  const currency = priceCurrency(price);
  const label = price.nickname ?? `${planName} (${describePriceInterval(price)})`;

  switch (price.model) {
    case "FLAT_RECURRING":
      return [
        {
          type: "SUBSCRIPTION",
          description: label,
          quantity: 1,
          unitAmount: requireUnitAmount(price),
          amount: requireUnitAmount(price),
          currency,
          periodStart,
          periodEnd,
        },
      ];
    case "PER_SEAT": {
      const unit = requireUnitAmount(price);
      return [
        {
          type: "SEAT",
          description: `${label} — ${quantity} seat${quantity === 1 ? "" : "s"}`,
          quantity,
          unitAmount: unit,
          amount: multiplyMoney(money(unit, currency), quantity).amount,
          currency,
          periodStart,
          periodEnd,
        },
      ];
    }
    case "HYBRID":
    case "USAGE_METERED":
      throw new BillingError(
        "NOT_IMPLEMENTED",
        `Price "${price.code}" uses the ${price.model} model, which needs the usage-metering engine (phase 2). ` +
          "FLAT_RECURRING and PER_SEAT subscriptions are fully supported today."
      );
  }
}

/**
 * Called before a subscription is created. Fails loudly for pricing models the
 * engine cannot yet bill correctly, instead of issuing a wrong invoice later.
 */
export function assertBillablePriceModel(price: PriceSnapshot): void {
  if (price.model === "USAGE_METERED" || price.model === "HYBRID") {
    throw new BillingError(
      "NOT_IMPLEMENTED",
      `Subscriptions on ${price.model} prices require the usage-metering engine, which is not part of this build. ` +
        `Price "${price.code}" can be created and listed, but not subscribed to yet.`
    );
  }
}

export function sumLines(lines: readonly ComputedLine[], currency: CurrencyCode): Money {
  return lines.reduce<Money>((acc, line) => addMoney(acc, money(line.amount, currency)), money(0, currency));
}

export function describePriceInterval(price: PriceSnapshot): string {
  const { intervalUnit, intervalCount } = price;
  const unit = intervalUnit.toLowerCase();
  if (intervalCount === 1) {
    return { day: "daily", week: "weekly", month: "monthly", year: "annually" }[unit] ?? `every ${unit}`;
  }
  return `every ${intervalCount} ${unit}s`;
}

function requireUnitAmount(price: PriceSnapshot): number {
  if (price.unitAmount === null || price.unitAmount === undefined) {
    throw new BillingError(
      "INVALID_REQUEST",
      `Price "${price.code}" has no unitAmount but its model (${price.model}) requires one.`
    );
  }
  return price.unitAmount;
}

/** Translate an API-facing interval selection into the stored representation. */
export function intervalFromRequest(
  interval: string,
  customDays?: number | null
): { intervalUnit: "DAY" | "WEEK" | "MONTH" | "YEAR"; intervalCount: number } {
  const resolved = resolveInterval(interval, customDays);
  return { intervalUnit: resolved.unit, intervalCount: resolved.count };
}
