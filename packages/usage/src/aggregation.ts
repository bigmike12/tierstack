import { BillingError } from "@tierbase/shared";

export type UsageAggregation = "SUM" | "MAX" | "LAST" | "UNIQUE_COUNT";

export interface UsageEventLike {
  units: number;
  timestamp: Date;
  metadata?: Record<string, unknown> | null;
}

/**
 * Collapses a period's events into a single number.
 *
 * The method belongs to the meter, not the caller, so a meter's meaning cannot
 * drift between the entitlement check and the invoice: both read the same
 * aggregation off the same row.
 */
export function aggregate(events: readonly UsageEventLike[], method: UsageAggregation): number {
  if (events.length === 0) return 0;

  switch (method) {
    // Total consumption. The default, and what token or API-call meters want.
    case "SUM":
      return events.reduce((total, event) => total + event.units, 0);

    // High-water mark. For meters that measure a level rather than a flow —
    // peak seats, peak storage — where billing follows the maximum reached.
    case "MAX":
      return events.reduce((peak, event) => Math.max(peak, event.units), 0);

    // The most recent reading. For gauges that report an absolute current
    // value each time rather than a delta.
    case "LAST": {
      let latest = events[0]!;
      for (const event of events) {
        if (event.timestamp.getTime() >= latest.timestamp.getTime()) latest = event;
      }
      return latest.units;
    }

    // Distinct things seen, not how often. Counts unique values of
    // `metadata.uniqueKey` — a monthly-active-user meter reports one event per
    // action and bills for the distinct users behind them.
    case "UNIQUE_COUNT": {
      const seen = new Set<string>();
      for (const event of events) {
        const key = event.metadata?.uniqueKey;
        if (typeof key === "string" || typeof key === "number") seen.add(String(key));
      }
      return seen.size;
    }
  }
}

export function assertAggregation(value: string): UsageAggregation {
  if (!["SUM", "MAX", "LAST", "UNIQUE_COUNT"].includes(value)) {
    throw new BillingError("VALIDATION_ERROR", `Unknown usage aggregation "${value}".`);
  }
  return value as UsageAggregation;
}

/** UNIQUE_COUNT is meaningless without something to count distinct. */
export function requiresUniqueKey(method: UsageAggregation): boolean {
  return method === "UNIQUE_COUNT";
}
