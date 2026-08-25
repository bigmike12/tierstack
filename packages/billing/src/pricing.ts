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
} from "@tierstack/shared";

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
  usageMeterId?: string | null;
  usageMeterCode?: string | null;
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
    // The base fee only. Metered consumption is billed in arrears by
    // buildUsageLines, on the invoice that opens the following period.
    case "HYBRID":
      return [
        {
          type: "SUBSCRIPTION",
          description: `${label} — base`,
          quantity: 1,
          unitAmount: requireUnitAmount(price),
          amount: requireUnitAmount(price),
          currency,
          periodStart,
          periodEnd,
        },
      ];

    // Nothing is owed in advance; the whole charge is consumption, billed for
    // the period once it has closed.
    case "USAGE_METERED":
      return [];
  }
}

export interface UsageLineInput {
  price: PriceSnapshot;
  meterName: string;
  unitLabel?: string | null;
  /** Units consumed in the closed period. */
  used: number;
  /** Units bundled into the base fee. */
  included: number;
  /** Units beyond the allowance. */
  overage: number;
  /** Priced blocks the overage represents. */
  blocks: number;
  periodStart: Date;
  periodEnd: Date;
}

/**
 * Invoice lines for consumption in a period that has ended.
 *
 * Usage is billed in arrears — you cannot invoice for tokens before they are
 * spent — while the recurring base is billed in advance. On a hybrid plan a
 * renewal invoice therefore carries next period's base fee alongside last
 * period's overage, and both lines say which window they cover.
 */
export function buildUsageLines(input: UsageLineInput): ComputedLine[] {
  const { price, used, included, overage, blocks } = input;
  const currency = priceCurrency(price);
  const rate = price.usageUnitAmount ?? 0;
  const blockSize = Math.max(price.usageUnitSize ?? 1, 1);
  const units = input.unitLabel ?? "units";
  const window = `${input.periodStart.toISOString().slice(0, 10)} – ${input.periodEnd.toISOString().slice(0, 10)}`;

  const lines: ComputedLine[] = [];

  // A zero-value line documenting what the allowance absorbed. Without it an
  // invoice for a customer inside their quota says nothing about their usage,
  // which is the first thing they look for.
  if (included > 0) {
    lines.push({
      type: "USAGE",
      description: `${input.meterName} — ${used.toLocaleString()} ${units} used, ${included.toLocaleString()} included (${window})`,
      quantity: Math.min(used, included),
      unitAmount: 0,
      amount: 0,
      currency,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      metadata: { meter: price.usageMeterCode ?? null, used, included },
    });
  }

  if (overage > 0 && rate > 0) {
    lines.push({
      type: "OVERAGE",
      description:
        blockSize === 1
          ? `${input.meterName} — ${overage.toLocaleString()} ${units} over the allowance (${window})`
          : `${input.meterName} — ${overage.toLocaleString()} ${units} over the allowance, billed as ${blocks} × ${blockSize.toLocaleString()} (${window})`,
      quantity: blocks,
      unitAmount: rate,
      amount: blocks * rate,
      currency,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      metadata: { meter: price.usageMeterCode ?? null, overage, blocks, blockSize },
    });
  }

  return lines;
}

/**
 * Called before a subscription is created. A metered price is only billable if
 * it actually points at a meter — otherwise consumption could never be counted
 * and the invoice would silently under-charge.
 */
export function assertBillablePriceModel(price: PriceSnapshot): void {
  if ((price.model === "USAGE_METERED" || price.model === "HYBRID") && !price.usageMeterId) {
    throw new BillingError(
      "VALIDATION_ERROR",
      `Price "${price.code}" uses the ${price.model} model but has no usage meter attached, ` +
        "so its consumption could never be billed. Set usageMeterCode on the price."
    );
  }
  if (price.model === "USAGE_METERED" && !price.usageUnitAmount) {
    throw new BillingError(
      "VALIDATION_ERROR",
      `Price "${price.code}" is usage-metered but has no usageUnitAmount, so it would never charge anything.`
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
