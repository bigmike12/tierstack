import {
  BillingError,
  addMoney,
  assertCurrency,
  formatCustomerMoney,
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

/**
 * How to read a meter whose units are money rather than things.
 *
 * A percentage fee — "2.5% of payment volume" — is expressed with the ordinary
 * block machinery: meter the volume, then charge `usageUnitAmount` per
 * `usageUnitSize` units, choosing the pair so the ratio is the rate. At 2.5%
 * that is ₦1 per 40 naira of volume. The arithmetic needs nothing new; only the
 * invoice line does, because "85,000 × 40" is not how anyone reads a percentage.
 *
 * `unitScale` is what stops that rendering being a guess: it says how many minor
 * units one metered unit is worth, so a meter counting naira (100) and one
 * counting kobo (1) both describe themselves correctly. Meter in the major unit
 * unless you have a reason not to — `UsageEvent.units` is an int4 column, so a
 * kobo-denominated meter overflows on a single payment above ₦21.5m.
 */
export interface UsageDisplay {
  kind: "PERCENTAGE";
  /** Minor units one metered unit represents. Naira-denominated meters use 100. */
  unitScale: number;
}

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
  /** Ceiling on the metered charge for one billing period, in minor units. */
  usageMaxAmount?: number | null;
  trialDays?: number | null;
  /** Presentation only — see UsageDisplay. Never affects an amount. */
  usageDisplay?: UsageDisplay | null;
}

/**
 * Reads `usageDisplay` out of a price's metadata.
 *
 * Returns null rather than throwing on anything malformed. This runs inside the
 * renewal transaction, and a display hint is not worth failing an invoice over:
 * a bad value costs you the nicer description and nothing else, because every
 * amount is computed from usageUnitAmount and usageUnitSize either way.
 */
export function parseUsageDisplay(value: unknown): UsageDisplay | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as { kind?: unknown; unitScale?: unknown };
  if (candidate.kind !== "PERCENTAGE") return null;
  const scale = candidate.unitScale;
  if (typeof scale !== "number" || !Number.isInteger(scale) || scale < 1) return null;
  return { kind: "PERCENTAGE", unitScale: scale };
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

  // Percentage prices describe the same numbers differently: the meter counts
  // money, so units are rendered as money and the block ratio as a rate. Only
  // `description` and `metadata` change — quantity, unitAmount and amount stay
  // exactly what the block arithmetic produced, so nothing reconciling an
  // invoice against the meter has to know this branch exists.
  const percentage = price.usageDisplay?.kind === "PERCENTAGE" ? price.usageDisplay : null;
  const unitScale = percentage?.unitScale ?? 1;
  // The symbol form, not the ISO one: this string ends up on an invoice a
  // customer reads, and the dashboard already renders the amount column with a
  // symbol — two conventions in one table row is worse than either alone.
  const asMoney = (metered: number): string =>
    formatCustomerMoney(money(metered * unitScale, currency));
  const percentageRate = rate / (blockSize * unitScale);

  // The cap applies to one billing period, which is the window this line covers.
  const uncapped = blocks * rate;
  const cap = price.usageMaxAmount ?? null;
  const charged = cap === null ? uncapped : Math.min(uncapped, Math.max(cap, 0));
  const capped = charged < uncapped;

  const describeOverage = (): string => {
    const base = !percentage
      ? blockSize === 1
        ? `${input.meterName} — ${overage.toLocaleString()} ${units} over the allowance`
        : `${input.meterName} — ${overage.toLocaleString()} ${units} over the allowance, billed as ${blocks} × ${blockSize.toLocaleString()}`
      : // The rate is quoted against the volume it was actually applied to, so
        // the merchant can check the multiplication without having to know the
        // allowance was subtracted first.
        included > 0
        ? `${input.meterName} — ${formatPercentageRate(percentageRate)} of ${asMoney(overage)} above the ${asMoney(included)} included`
        : `${input.meterName} — ${formatPercentageRate(percentageRate)} of ${asMoney(overage)}`;

    // Naming the amount the cap replaced is the whole point of saying anything:
    // an invoice that only shows the ceiling looks identical whether the cap
    // saved the customer ₦20 or ₦2,000,000.
    return capped
      ? `${base} — capped at ${formatCustomerMoney(money(charged, currency))}, from ${formatCustomerMoney(money(uncapped, currency))} (${window})`
      : `${base} (${window})`;
  };

  const lines: ComputedLine[] = [];

  // A zero-value line documenting what the allowance absorbed. Without it an
  // invoice for a customer inside their quota says nothing about their usage,
  // which is the first thing they look for.
  if (included > 0) {
    lines.push({
      type: "USAGE",
      description: percentage
        ? `${input.meterName} — ${asMoney(used)} processed, ${asMoney(included)} included (${window})`
        : `${input.meterName} — ${used.toLocaleString()} ${units} used, ${included.toLocaleString()} included (${window})`,
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
      description: describeOverage(),
      // A capped line is one charge, not a block count: `quantity × unitAmount`
      // has to equal `amount` or every invoice total that re-derives itself
      // from the columns disagrees with the line. The blocks that were actually
      // consumed are still in metadata, which is where anything reconciling
      // against the meter should read them from anyway.
      quantity: capped ? 1 : blocks,
      unitAmount: capped ? charged : rate,
      amount: charged,
      currency,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      metadata: {
        meter: price.usageMeterCode ?? null,
        overage,
        blocks,
        blockSize,
        ...(percentage ? { percentageRate, volume: overage * percentage.unitScale } : {}),
        ...(capped ? { cap, uncappedAmount: uncapped } : {}),
      },
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

/**
 * A block ratio as a percentage: 1/40 reads "2.5%".
 *
 * Four decimal places is enough to render any rate anyone quotes (2.5%, 1.95%,
 * 0.5%) without a rate like 1/3 printing seventeen digits. Trailing zeros are
 * trimmed so 2% is not "2.0000%". toFixed always emits the decimal point, so
 * stripping trailing zeros can never reach the integer digits.
 */
function formatPercentageRate(fraction: number): string {
  const trimmed = (fraction * 100)
    .toFixed(4)
    .replace(/0+$/, "")
    .replace(/\.$/, "");
  return `${trimmed}%`;
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
