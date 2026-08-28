import { CURRENCIES, type CurrencyCode } from "@tierstack/shared";

/**
 * Integer division and a padded remainder, not `amount / 100`. The portal is
 * the one page where a customer reads what they owe, and the rule against a
 * float touching an amount does not stop applying because this is only
 * presentation.
 */
export function money(amount: number, currency: string): string {
  const code = currency as CurrencyCode;
  const decimals: number = CURRENCIES[code]?.minorUnits ?? 2;
  const symbol = CURRENCIES[code]?.symbol ?? `${currency} `;
  const factor = 10 ** decimals;

  const negative = amount < 0;
  const absolute = Math.abs(amount);
  const whole = Math.trunc(absolute / factor);
  const fraction = absolute % factor;
  const grouped = whole.toLocaleString("en-US");

  return `${negative ? "-" : ""}${symbol}${
    decimals === 0 ? grouped : `${grouped}.${String(fraction).padStart(decimals, "0")}`
  }`;
}

const DAY = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

export function day(value: string | null | undefined): string {
  if (!value) return "—";
  return DAY.format(new Date(value));
}

export function interval(unit: string, count: number): string {
  const noun = unit.toLowerCase();
  return count === 1 ? `per ${noun}` : `every ${count} ${noun}s`;
}
