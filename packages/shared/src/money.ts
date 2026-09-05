import { BillingError } from "./errors";

/**
 * Money is always represented as an integer number of minor units plus an ISO
 * currency code. Floating point never touches a monetary value anywhere in this
 * codebase: intermediate arithmetic that could overflow Number.MAX_SAFE_INTEGER
 * is done in BigInt and narrowed back at the boundary.
 */
export interface Money {
  /** Integer amount in the currency's smallest unit (e.g. kobo, cents). */
  readonly amount: number;
  readonly currency: CurrencyCode;
}

/**
 * Currencies enabled today. Adding a currency is a one-line change here; nothing
 * in the engine assumes a fixed set or a fixed number of decimal places.
 */
export const CURRENCIES = {
  NGN: { minorUnits: 2, symbol: "₦", name: "Nigerian Naira" },
  USD: { minorUnits: 2, symbol: "$", name: "United States Dollar" },
  KES: { minorUnits: 2, symbol: "KSh", name: "Kenyan Shilling" },
  GHS: { minorUnits: 2, symbol: "GH₵", name: "Ghanaian Cedi" },
  ZAR: { minorUnits: 2, symbol: "R", name: "South African Rand" },
} as const;

export type CurrencyCode = keyof typeof CURRENCIES;

export function isSupportedCurrency(value: string): value is CurrencyCode {
  return Object.prototype.hasOwnProperty.call(CURRENCIES, value);
}

export function assertCurrency(value: string): CurrencyCode {
  if (!isSupportedCurrency(value)) {
    throw new BillingError(
      "UNSUPPORTED_CURRENCY",
      `Currency "${value}" is not supported. Supported currencies: ${Object.keys(CURRENCIES).join(", ")}.`
    );
  }
  return value;
}

/** Number of decimal places the currency uses. Never assume 2. */
export function minorUnits(currency: CurrencyCode): number {
  return CURRENCIES[currency].minorUnits;
}

export function money(amount: number, currency: string): Money {
  const code = assertCurrency(currency);
  if (!Number.isInteger(amount)) {
    throw new BillingError(
      "INVALID_REQUEST",
      `Monetary amounts must be integers in the smallest currency unit, received ${amount}.`
    );
  }
  return { amount, currency: code };
}

export function zero(currency: CurrencyCode): Money {
  return { amount: 0, currency };
}

function assertSameCurrency(a: Money, b: Money): CurrencyCode {
  if (a.currency !== b.currency) {
    throw new BillingError(
      "CURRENCY_MISMATCH",
      `Cannot combine ${a.currency} and ${b.currency} amounts.`,
      { left: a.currency, right: b.currency }
    );
  }
  return a.currency;
}

export function addMoney(a: Money, b: Money): Money {
  return { amount: a.amount + b.amount, currency: assertSameCurrency(a, b) };
}

export function subtractMoney(a: Money, b: Money): Money {
  return { amount: a.amount - b.amount, currency: assertSameCurrency(a, b) };
}

export function sumMoney(items: readonly Money[], currency: CurrencyCode): Money {
  return items.reduce<Money>((acc, item) => addMoney(acc, item), zero(currency));
}

export function negate(a: Money): Money {
  return { amount: -a.amount, currency: a.currency };
}

export function maxMoney(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return a.amount >= b.amount ? a : b;
}

export function minMoney(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return a.amount <= b.amount ? a : b;
}

export function isZero(a: Money): boolean {
  return a.amount === 0;
}

export function isNegative(a: Money): boolean {
  return a.amount < 0;
}

/** Multiply by a whole quantity (seats, units). Exact, no rounding involved. */
export function multiplyMoney(a: Money, quantity: number): Money {
  if (!Number.isInteger(quantity)) {
    throw new BillingError("INVALID_REQUEST", `Quantity must be an integer, received ${quantity}.`);
  }
  const result = BigInt(a.amount) * BigInt(quantity);
  return { amount: toSafeNumber(result), currency: a.currency };
}

export type RoundingMode = "HALF_UP" | "FLOOR" | "CEIL";

/**
 * Multiply a monetary amount by the rational number numerator/denominator.
 * Used for proration and percentage discounts. The whole computation runs in
 * BigInt so a large amount times a large numerator cannot lose precision.
 */
export function scaleMoney(
  a: Money,
  numerator: number | bigint,
  denominator: number | bigint,
  rounding: RoundingMode = "HALF_UP"
): Money {
  const den = BigInt(denominator);
  if (den === 0n) {
    throw new BillingError("INVALID_REQUEST", "Cannot scale a monetary amount by a zero denominator.");
  }
  const product = BigInt(a.amount) * BigInt(numerator);
  return { amount: toSafeNumber(divideRounded(product, den, rounding)), currency: a.currency };
}

/** Apply a percentage expressed in basis points (10000 bps = 100%). */
export function percentageOf(a: Money, basisPoints: number, rounding: RoundingMode = "HALF_UP"): Money {
  if (!Number.isInteger(basisPoints)) {
    throw new BillingError("INVALID_REQUEST", "Percentages must be expressed in integer basis points.");
  }
  return scaleMoney(a, basisPoints, 10_000, rounding);
}

function divideRounded(numerator: bigint, denominator: bigint, mode: RoundingMode): bigint {
  const negative = numerator < 0n !== denominator < 0n;
  const absNum = numerator < 0n ? -numerator : numerator;
  const absDen = denominator < 0n ? -denominator : denominator;
  const quotient = absNum / absDen;
  const remainder = absNum % absDen;

  let magnitude: bigint;
  switch (mode) {
    case "HALF_UP":
      magnitude = remainder * 2n >= absDen ? quotient + 1n : quotient;
      break;
    case "CEIL":
      magnitude = negative ? quotient : remainder > 0n ? quotient + 1n : quotient;
      break;
    case "FLOOR":
      magnitude = negative ? (remainder > 0n ? quotient + 1n : quotient) : quotient;
      break;
  }
  return negative ? -magnitude : magnitude;
}

function toSafeNumber(value: bigint): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new BillingError(
      "INVALID_REQUEST",
      `Monetary amount ${value.toString()} exceeds the safe integer range.`
    );
  }
  return Number(value);
}

/**
 * Split an amount into `parts` shares that sum exactly back to the original,
 * distributing the remainder one minor unit at a time (largest-remainder
 * method). Used when a discount or credit spans several invoice line items.
 */
export function allocate(a: Money, weights: readonly number[]): Money[] {
  if (weights.length === 0) return [];
  const totalWeight = weights.reduce((sum, w) => sum + w, 0);
  if (totalWeight <= 0) {
    throw new BillingError("INVALID_REQUEST", "Allocation weights must sum to a positive number.");
  }

  const shares: Money[] = [];
  let allocated = 0;
  for (const weight of weights) {
    const share = toSafeNumber(divideRounded(BigInt(a.amount) * BigInt(weight), BigInt(totalWeight), "FLOOR"));
    shares.push({ amount: share, currency: a.currency });
    allocated += share;
  }

  // Hand the leftover minor units out in weight order, largest first.
  let remainder = a.amount - allocated;
  const order = weights
    .map((weight, index) => ({ weight, index }))
    .sort((left, right) => right.weight - left.weight);
  let cursor = 0;
  const step = remainder >= 0 ? 1 : -1;
  while (remainder !== 0 && order.length > 0) {
    const target = order[cursor % order.length]!;
    const current = shares[target.index]!;
    shares[target.index] = { amount: current.amount + step, currency: a.currency };
    remainder -= step;
    cursor += 1;
  }
  return shares;
}

/** Human-readable rendering. Presentation only — never feed this back into math. */
export function formatMoney(a: Money, locale = "en-US"): string {
  const decimals = minorUnits(a.currency);
  const divisor = 10 ** decimals;
  const value = a.amount / divisor;
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: a.currency,
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

/**
 * Money as a customer expects to see it: ₦5,000.00, not NGN 5,000.00.
 *
 * `formatMoney` above renders an ISO code, which is right for a dashboard where
 * several currencies sit in one table. Someone reading a receipt or an invoice
 * line for their own subscription knows what currency they pay in and wants the
 * symbol they see everywhere else. Integer division and a padded remainder, so
 * the presentation layer does not become the one place a float touches an
 * amount.
 *
 * The symbols come from CURRENCIES rather than from Intl deliberately. Intl
 * only knows the symbols its locale knows — under "en-NG" it renders NGN and
 * USD with symbols but still prints KES, GHS and ZAR as ISO codes, which would
 * make a multi-currency merchant's invoices inconsistent with each other.
 */
export function formatCustomerMoney(value: Money): string {
  const currency = value.currency as CurrencyCode;
  const decimals: number = CURRENCIES[currency]?.minorUnits ?? 2;
  const symbol = CURRENCIES[currency]?.symbol ?? `${value.currency} `;
  const factor = 10 ** decimals;

  const negative = value.amount < 0;
  const absolute = Math.abs(value.amount);
  const whole = Math.trunc(absolute / factor);
  const fraction = absolute % factor;

  const grouped = whole.toLocaleString("en-US");
  const rendered =
    decimals === 0 ? grouped : `${grouped}.${String(fraction).padStart(decimals, "0")}`;

  return `${negative ? "-" : ""}${symbol}${rendered}`;
}

/** Parse a decimal string such as "10000.50" into minor units. */
export function parseMoney(decimalString: string, currency: string): Money {
  const code = assertCurrency(currency);
  const decimals = minorUnits(code);
  const trimmed = decimalString.trim();
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(trimmed);
  if (!match) {
    throw new BillingError("INVALID_REQUEST", `"${decimalString}" is not a valid decimal amount.`);
  }
  const [, sign, whole, fractionRaw = ""] = match;
  if (fractionRaw.length > decimals) {
    throw new BillingError(
      "INVALID_REQUEST",
      `${code} supports at most ${decimals} decimal places, received "${decimalString}".`
    );
  }
  const fraction = fractionRaw.padEnd(decimals, "0");
  const amount = BigInt(`${whole}${fraction}`) * (sign === "-" ? -1n : 1n);
  return { amount: toSafeNumber(amount), currency: code };
}
