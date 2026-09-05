/**
 * Quota arithmetic. Pure and unit-only: money is applied a layer up, so these
 * numbers mean the same thing to the entitlement engine and to the invoice.
 */
export interface QuotaInput {
  /** Units consumed in the current period. */
  used: number;
  /** Units bundled into the recurring price. Null means none are included. */
  includedUnits: number | null | undefined;
}

export interface QuotaResult {
  used: number;
  included: number;
  /** Units left before overage begins. Never negative. */
  remaining: number;
  /** Units consumed beyond the included allowance. */
  overage: number;
  /** True once the included allowance is spent. */
  exhausted: boolean;
}

export function computeQuota({ used, includedUnits }: QuotaInput): QuotaResult {
  const included = Math.max(includedUnits ?? 0, 0);
  const consumed = Math.max(used, 0);
  const overage = Math.max(consumed - included, 0);

  return {
    used: consumed,
    included,
    remaining: Math.max(included - consumed, 0),
    overage,
    exhausted: consumed >= included,
  };
}

/**
 * How many priced blocks an overage costs.
 *
 * Usage is sold in blocks — "₦50 per 1,000 units" — and a started block is
 * charged in full, which is the convention every metered provider uses. 1,500
 * units against a 1,000-unit block is two blocks, not one and a half. The
 * rounding direction is a pricing decision, so it lives here where it can be
 * seen and tested rather than being buried in an invoice calculation.
 *
 * Percentage fees ride on this too, which is easy to miss: "2.5% of payment
 * volume" is a 40-naira block at ₦1, so `Math.ceil` here is what rounds the fee
 * up to the next naira. It runs once against the period total rather than once
 * per payment, which is what keeps the bias to ≤₦1 per invoice instead of half
 * a naira per transaction. Changing ceil to round would silently reprice every
 * percentage plan.
 */
export function billableBlocks(overageUnits: number, unitSize: number | null | undefined): number {
  const size = Math.max(unitSize ?? 1, 1);
  if (overageUnits <= 0) return 0;
  return Math.ceil(overageUnits / size);
}

/**
 * The metered charge after a price's ceiling is applied.
 *
 * The cap is per billing period. On a monthly price that is what a merchant
 * means by "capped at ₦50,000 a month"; on any other interval the period is the
 * only reading that does not silently multiply their intent by twelve, so the
 * dashboard names the actual interval rather than saying "month".
 *
 * Like the rounding direction above, this is a pricing decision rather than an
 * invoice detail, so it lives here where it is one line and can be tested. A
 * negative cap is treated as zero rather than rejected: it is nonsense either
 * way, and a caller that reaches this point has already built an invoice.
 */
export function cappedFee(amount: number, cap: number | null | undefined): number {
  if (cap === null || cap === undefined) return amount;
  return Math.min(amount, Math.max(cap, 0));
}
