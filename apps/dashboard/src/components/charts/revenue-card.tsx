"use client";

import * as React from "react";
import { ChartCard, DataTable, Headline } from "@/components/charts/chrome";
import { TrendArea } from "@/components/charts/plots";
import { formatAmount, formatCompact } from "@/lib/format";
import { dayLabel } from "@/lib/viz";
import { cn } from "@/lib/utils";
import type { TimeseriesMetrics } from "@/lib/types";

type Series = TimeseriesMetrics["revenue"][number];

/**
 * Revenue collected per day.
 *
 * One currency at a time, always. The API reports money per currency and
 * refuses to produce a combined figure, because adding naira to dollars gives
 * a number that is not an amount of anything — so the chart does not offer a
 * combined view either. Where a business bills in more than one, the currency
 * is a switch over data already on the page rather than a second series on the
 * same axis, which would put two unrelated scales in one plot.
 */
export function RevenueCard({
  series,
  days,
  windowDays,
}: {
  series: Series[];
  days: string[];
  windowDays: number;
}) {
  const [currency, setCurrency] = React.useState(series[0]?.currency ?? "");
  const active = series.find((row) => row.currency === currency) ?? series[0];

  if (!active) {
    return (
      <ChartCard
        title="Revenue collected"
        description={`Paid invoices over the last ${windowDays} days`}
      >
        <p className="px-3 py-12 text-center text-sm text-muted-foreground">
          No invoices have been paid in this window.
        </p>
      </ChartCard>
    );
  }

  const best = active.points.reduce(
    (top, value, index) => (value > top.value ? { value, index } : top),
    { value: -1, index: 0 }
  );

  return (
    <ChartCard
      title="Revenue collected"
      description={`Paid invoices over the last ${windowDays} days, in ${active.currency}`}
      headline={
        <Headline
          value={formatAmount(active.total, active.currency)}
          note={
            <>
              {active.invoices} {active.invoices === 1 ? "invoice" : "invoices"} paid · best day{" "}
              {dayLabel(days[best.index] ?? "")} at {formatCompact(best.value, active.currency)}
            </>
          }
        />
      }
      action={
        series.length > 1 ? (
          <div
            role="group"
            aria-label="Currency"
            className="inline-flex rounded-md border border-border p-0.5"
          >
            {series.map((row) => (
              <button
                key={row.currency}
                type="button"
                onClick={() => setCurrency(row.currency)}
                aria-pressed={row.currency === active.currency}
                className={cn(
                  "rounded-[calc(var(--radius)-6px)] px-2.5 py-1 text-[11px] font-medium transition-colors",
                  row.currency === active.currency
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {row.currency}
              </button>
            ))}
          </div>
        ) : null
      }
      table={
        <DataTable
          columns={["Day", `Collected (${active.currency})`]}
          rows={days.map((day, index) => [
            dayLabel(day),
            formatAmount(active.points[index] ?? 0, active.currency),
          ])}
        />
      }
    >
      <TrendArea
        days={days}
        values={active.points}
        seriesLabel="Collected"
        format={(value) => formatCompact(value, active.currency)}
        height={190}
      />
    </ChartCard>
  );
}
