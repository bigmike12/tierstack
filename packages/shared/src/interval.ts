import { BillingError } from "./errors";

/**
 * The platform owns the billing schedule. Providers are not asked whether they
 * support an interval — the engine drives the cycle itself and only asks a
 * provider to move money on a specific date.
 */
export type IntervalUnit = "DAY" | "WEEK" | "MONTH" | "YEAR";

export interface BillingInterval {
  readonly unit: IntervalUnit;
  readonly count: number;
}

/** Named intervals are sugar over the canonical {unit, count} representation. */
export const NAMED_INTERVALS = {
  DAILY: { unit: "DAY", count: 1 },
  WEEKLY: { unit: "WEEK", count: 1 },
  BI_WEEKLY: { unit: "WEEK", count: 2 },
  MONTHLY: { unit: "MONTH", count: 1 },
  BI_MONTHLY: { unit: "MONTH", count: 2 },
  QUARTERLY: { unit: "MONTH", count: 3 },
  SEMI_ANNUALLY: { unit: "MONTH", count: 6 },
  ANNUALLY: { unit: "YEAR", count: 1 },
} as const satisfies Record<string, BillingInterval>;

export type NamedInterval = keyof typeof NAMED_INTERVALS;

export function isNamedInterval(value: string): value is NamedInterval {
  return Object.prototype.hasOwnProperty.call(NAMED_INTERVALS, value);
}

/** Accepts a named interval, or `CUSTOM_DAYS` with an explicit day count. */
export function resolveInterval(named: string, customDays?: number | null): BillingInterval {
  if (named === "CUSTOM_DAYS") {
    if (!customDays || !Number.isInteger(customDays) || customDays < 1) {
      throw new BillingError(
        "INVALID_BILLING_INTERVAL",
        "CUSTOM_DAYS requires a positive integer number of days."
      );
    }
    return { unit: "DAY", count: customDays };
  }
  if (!isNamedInterval(named)) {
    throw new BillingError("INVALID_BILLING_INTERVAL", `Unknown billing interval "${named}".`);
  }
  return NAMED_INTERVALS[named];
}

export function assertValidInterval(interval: BillingInterval): BillingInterval {
  if (!Number.isInteger(interval.count) || interval.count < 1) {
    throw new BillingError(
      "INVALID_BILLING_INTERVAL",
      `Billing interval count must be a positive integer, received ${interval.count}.`
    );
  }
  if (!["DAY", "WEEK", "MONTH", "YEAR"].includes(interval.unit)) {
    throw new BillingError("INVALID_BILLING_INTERVAL", `Unknown interval unit "${interval.unit}".`);
  }
  return interval;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Advance a date by one interval.
 *
 * Month and year arithmetic clamps to the last day of the target month, so a
 * subscription anchored on the 31st bills on the 28th/29th in February and then
 * returns to the 31st in March — the anchor day is preserved rather than
 * drifting, which is what a customer expects from a monthly plan.
 */
export function addInterval(date: Date, interval: BillingInterval, anchorDay?: number): Date {
  assertValidInterval(interval);
  switch (interval.unit) {
    case "DAY":
      return new Date(date.getTime() + interval.count * DAY_MS);
    case "WEEK":
      return new Date(date.getTime() + interval.count * 7 * DAY_MS);
    case "MONTH":
      return addMonths(date, interval.count, anchorDay);
    case "YEAR":
      return addMonths(date, interval.count * 12, anchorDay);
  }
}

function addMonths(date: Date, months: number, anchorDay?: number): Date {
  const day = anchorDay ?? date.getUTCDate();
  const targetMonthStart = Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1);
  const target = new Date(targetMonthStart);
  const daysInTargetMonth = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)
  ).getUTCDate();
  const clampedDay = Math.min(day, daysInTargetMonth);
  return new Date(
    Date.UTC(
      target.getUTCFullYear(),
      target.getUTCMonth(),
      clampedDay,
      date.getUTCHours(),
      date.getUTCMinutes(),
      date.getUTCSeconds(),
      date.getUTCMilliseconds()
    )
  );
}

export interface BillingPeriod {
  readonly start: Date;
  readonly end: Date;
}

export function computeBillingPeriod(
  start: Date,
  interval: BillingInterval,
  anchorDay?: number
): BillingPeriod {
  return { start, end: addInterval(start, interval, anchorDay) };
}

export function periodLengthMs(period: BillingPeriod): number {
  return period.end.getTime() - period.start.getTime();
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

export function describeInterval(interval: BillingInterval): string {
  const unit = interval.unit.toLowerCase();
  return interval.count === 1 ? `every ${unit}` : `every ${interval.count} ${unit}s`;
}
