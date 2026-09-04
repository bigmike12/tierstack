import * as React from "react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * The frame every chart sits in: a title, an optional headline figure, the
 * plot, a legend, and the table view.
 *
 * The table view is not an extra. A chart encodes values as length and colour,
 * and both of those channels fail somebody — a screen reader gets nothing from
 * an SVG path, and two of the palette's hues sit below 3:1 against the card.
 * The disclosure underneath carries the same numbers as text, so no value on
 * this page is reachable only by looking at a picture of it.
 */
export function ChartCard({
  title,
  description,
  headline,
  action,
  legend,
  table,
  children,
  className,
}: {
  title: string;
  description?: React.ReactNode;
  headline?: React.ReactNode;
  action?: React.ReactNode;
  legend?: React.ReactNode;
  table?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn("flex flex-col", className)}>
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 pb-3 pt-4">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold leading-none tracking-tight">{title}</h3>
          {description ? (
            <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{description}</p>
          ) : null}
          {headline ? <div className="mt-3">{headline}</div> : null}
        </div>
        {action}
      </div>

      <div className="min-w-0 flex-1 px-2">{children}</div>

      {legend ? <div className="px-5 pt-2">{legend}</div> : null}
      {table ? <ChartTable>{table}</ChartTable> : null}
    </Card>
  );
}

/**
 * A big number above its own chart. Proportional figures, not tabular — at
 * this size `tabular-nums` gives every digit the width of a zero and a value
 * like 121 comes out looking gappy.
 */
export function Headline({ value, note }: { value: React.ReactNode; note?: React.ReactNode }) {
  return (
    <div>
      <p className="text-2xl font-semibold leading-none tracking-tight">{value}</p>
      {note ? <p className="mt-1.5 text-xs text-muted-foreground">{note}</p> : null}
    </div>
  );
}

/**
 * Identity for two or more series, always present when there are two or more.
 * The swatch mirrors the mark it stands for: a rounded rect for a fill, a
 * short stroke for a line. Text stays on the text tokens — colouring the label
 * itself puts a light hue on a light surface and loses the word.
 */
export function ChartLegend({
  items,
}: {
  items: { label: string; color: string; shape?: "fill" | "line" }[];
}) {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-2 text-xs text-muted-foreground">
          <span
            aria-hidden
            className={item.shape === "line" ? "h-0.5 w-3.5 rounded-full" : "size-2.5 rounded-[3px]"}
            style={{ background: item.color }}
          />
          {item.label}
        </li>
      ))}
    </ul>
  );
}

function ChartTable({ children }: { children: React.ReactNode }) {
  return (
    <details className="group mt-3 border-t border-border">
      <summary className="cursor-pointer list-none px-5 py-2.5 text-xs text-muted-foreground transition-colors hover:text-foreground">
        <span className="underline-offset-4 group-open:underline">Show the numbers</span>
      </summary>
      <div className="max-h-64 overflow-auto px-5 pb-4">{children}</div>
    </details>
  );
}

/** The plain table inside the disclosure. Tabular figures — these are columns. */
export function DataTable({
  columns,
  rows,
}: {
  columns: string[];
  rows: (string | number)[][];
}) {
  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="text-left text-muted-foreground">
          {columns.map((column, index) => (
            <th
              key={column}
              scope="col"
              className={cn("py-1.5 font-medium", index > 0 && "text-right")}
            >
              {column}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={String(row[0])} className="border-t border-border/60">
            {row.map((cell, index) => (
              <td
                key={index}
                className={cn("py-1.5", index > 0 && "tabular text-right", index === 0 && "pr-4")}
              >
                {cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
