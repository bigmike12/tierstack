import { CURRENCIES, type CurrencyCode } from "@billing-platform/shared";

/**
 * Amounts arrive from the API as integer minor units. They are only ever
 * divided at the moment of display — never before arithmetic.
 */
export function formatAmount(amount: number, currency: string): string {
  const decimals = (CURRENCIES as Record<string, { minorUnits: number }>)[currency]?.minorUnits ?? 2;
  const value = amount / 10 ** decimals;
  try {
    return new Intl.NumberFormat("en-NG", {
      style: "currency",
      currency,
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(value);
  } catch {
    return `${currency} ${value.toFixed(decimals)}`;
  }
}

export function formatCompact(amount: number, currency: string): string {
  const decimals = (CURRENCIES as Record<string, { minorUnits: number }>)[currency]?.minorUnits ?? 2;
  const value = amount / 10 ** decimals;
  if (Math.abs(value) < 10_000) return formatAmount(amount, currency);
  try {
    return new Intl.NumberFormat("en-NG", {
      style: "currency",
      currency,
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(value);
  } catch {
    return `${currency} ${value.toFixed(0)}`;
  }
}

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(date);
}

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function relativeDays(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  const days = Math.round((date.getTime() - Date.now()) / 86_400_000);
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "yesterday";
  return days > 0 ? `in ${days} days` : `${Math.abs(days)} days ago`;
}

export function describeInterval(unit: string, count: number): string {
  const lower = unit.toLowerCase();
  if (count === 1) {
    return { day: "daily", week: "weekly", month: "monthly", year: "annually" }[lower] ?? `every ${lower}`;
  }
  return `every ${count} ${lower}s`;
}

export function titleCase(value: string): string {
  return value
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
