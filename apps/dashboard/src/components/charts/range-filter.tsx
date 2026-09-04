import Link from "next/link";
import { cn } from "@/lib/utils";

const RANGES = [
  { days: 7, label: "7 days" },
  { days: 30, label: "30 days" },
  { days: 90, label: "90 days" },
  { days: 365, label: "12 months" },
];

/**
 * One range control, above everything it scopes.
 *
 * Plain links rather than a client-side control: the window is a property of
 * the page, so it belongs in the URL — a range someone is looking at can be
 * bookmarked, shared with a colleague, and reloaded into the same view. It
 * also means every figure on the page is computed for the same window by the
 * same request, so no two cards can disagree about which days they cover.
 */
export function RangeFilter({ active }: { active: number }) {
  return (
    <div
      role="group"
      aria-label="Reporting period"
      className="inline-flex rounded-lg border border-border bg-card p-0.5"
    >
      {RANGES.map((range) => {
        const current = range.days === active;
        return (
          <Link
            key={range.days}
            href={`/overview?days=${range.days}`}
            aria-current={current ? "true" : undefined}
            className={cn(
              "rounded-[calc(var(--radius)-4px)] px-3 py-1.5 text-xs font-medium transition-colors",
              current
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
          >
            {range.label}
          </Link>
        );
      })}
    </div>
  );
}
