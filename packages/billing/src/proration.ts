import {
  BillingError,
  addMoney,
  money,
  negate,
  scaleMoney,
  subtractMoney,
  type CurrencyCode,
  type Money,
} from "@tierstack/shared";

export interface ProrationInput {
  /** The period the customer has already been billed for. */
  periodStart: Date;
  periodEnd: Date;
  /** When the change takes effect. Usually "now". */
  changeAt: Date;
  /** What the customer is currently paying for this period, in total. */
  currentAmount: Money;
  /** What the customer would pay for a full period on the new arrangement. */
  newAmount: Money;
}

export interface ProrationLine {
  type: "PRORATION";
  description: string;
  quantity: number;
  unitAmount: number;
  amount: number;
  currency: CurrencyCode;
  periodStart: Date;
  periodEnd: Date;
}

export interface ProrationResult {
  /** Fraction of the period still unused, as an exact rational. */
  remainingMs: number;
  totalMs: number;
  /** Value of the unused portion of what they already have (a credit). */
  unusedCredit: Money;
  /** Value of the unused portion of what they are switching to (a charge). */
  newPeriodCharge: Money;
  /** newPeriodCharge - unusedCredit. Negative means the customer is owed. */
  netAmount: Money;
  lines: ProrationLine[];
}

/**
 * Credit the unused remainder of the current arrangement and charge for the
 * same remainder at the new rate. Both halves appear as their own invoice line
 * so the customer can see exactly how the number was reached.
 *
 * All arithmetic is integer minor units scaled by an exact millisecond ratio;
 * there is no floating point in the path.
 */
export function calculateProration(input: ProrationInput): ProrationResult {
  if (input.currentAmount.currency !== input.newAmount.currency) {
    throw new BillingError(
      "CURRENCY_MISMATCH",
      `Cannot prorate between ${input.currentAmount.currency} and ${input.newAmount.currency}.`
    );
  }
  const currency = input.currentAmount.currency;
  const totalMs = input.periodEnd.getTime() - input.periodStart.getTime();
  if (totalMs <= 0) {
    throw new BillingError("INVALID_REQUEST", "Billing period end must be after its start.");
  }

  const rawRemaining = input.periodEnd.getTime() - input.changeAt.getTime();
  const remainingMs = Math.min(Math.max(rawRemaining, 0), totalMs);

  const unusedCredit = scaleMoney(input.currentAmount, remainingMs, totalMs);
  const newPeriodCharge = scaleMoney(input.newAmount, remainingMs, totalMs);
  const netAmount = subtractMoney(newPeriodCharge, unusedCredit);

  const lines: ProrationLine[] = [];
  if (unusedCredit.amount !== 0) {
    lines.push({
      type: "PRORATION",
      description: `Unused time credit (${formatWindow(input.changeAt, input.periodEnd)})`,
      quantity: 1,
      unitAmount: negate(unusedCredit).amount,
      amount: negate(unusedCredit).amount,
      currency,
      periodStart: input.changeAt,
      periodEnd: input.periodEnd,
    });
  }
  if (newPeriodCharge.amount !== 0) {
    lines.push({
      type: "PRORATION",
      description: `Remaining time on new plan (${formatWindow(input.changeAt, input.periodEnd)})`,
      quantity: 1,
      unitAmount: newPeriodCharge.amount,
      amount: newPeriodCharge.amount,
      currency,
      periodStart: input.changeAt,
      periodEnd: input.periodEnd,
    });
  }

  return { remainingMs, totalMs, unusedCredit, newPeriodCharge, netAmount, lines };
}

/**
 * Proration for a seat count change within a period. Only the delta is
 * prorated; the seats the customer already paid for are left alone.
 */
export function calculateSeatProration(params: {
  periodStart: Date;
  periodEnd: Date;
  changeAt: Date;
  unitAmount: Money;
  fromQuantity: number;
  toQuantity: number;
}): ProrationResult {
  const delta = params.toQuantity - params.fromQuantity;
  const currency = params.unitAmount.currency;
  const perSeatFull = params.unitAmount;

  const result = calculateProration({
    periodStart: params.periodStart,
    periodEnd: params.periodEnd,
    changeAt: params.changeAt,
    currentAmount: money(0, currency),
    newAmount: money(perSeatFull.amount * Math.abs(delta), currency),
  });

  if (delta === 0) {
    return {
      ...result,
      unusedCredit: money(0, currency),
      newPeriodCharge: money(0, currency),
      netAmount: money(0, currency),
      lines: [],
    };
  }

  const magnitude = result.newPeriodCharge;
  const signed = delta > 0 ? magnitude : negate(magnitude);
  const description =
    delta > 0
      ? `${delta} additional seat${delta === 1 ? "" : "s"} (${formatWindow(params.changeAt, params.periodEnd)})`
      : `${Math.abs(delta)} removed seat${delta === -1 ? "" : "s"} credit (${formatWindow(params.changeAt, params.periodEnd)})`;

  return {
    ...result,
    unusedCredit: delta > 0 ? money(0, currency) : magnitude,
    newPeriodCharge: delta > 0 ? magnitude : money(0, currency),
    netAmount: signed,
    lines: [
      {
        type: "PRORATION",
        description,
        quantity: Math.abs(delta),
        unitAmount: delta > 0 ? scaleUnit(magnitude, Math.abs(delta)) : -scaleUnit(magnitude, Math.abs(delta)),
        amount: signed.amount,
        currency,
        periodStart: params.changeAt,
        periodEnd: params.periodEnd,
      },
    ],
  };
}

function scaleUnit(total: Money, quantity: number): number {
  return quantity === 0 ? 0 : Math.round(total.amount / quantity);
}

function formatWindow(from: Date, to: Date): string {
  return `${from.toISOString().slice(0, 10)} – ${to.toISOString().slice(0, 10)}`;
}

/** Convenience for summing the money value of a set of proration lines. */
export function sumProrationLines(lines: readonly ProrationLine[], currency: CurrencyCode): Money {
  return lines.reduce<Money>((acc, line) => addMoney(acc, money(line.amount, currency)), money(0, currency));
}
