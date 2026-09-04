"use client";

import * as React from "react";
import {
  areaPath,
  barPath,
  compactCount,
  dayLabel,
  labelIndices,
  linePath,
  nearestIndex,
  niceScale,
  pointX,
  scaleY,
  slotCentre,
  type PlotBox,
  type Scale,
} from "@/lib/viz";
import { cn } from "@/lib/utils";

/**
 * The charts on the overview, drawn as inline SVG.
 *
 * No charting library. Five plots of three shapes is less code than the
 * adapter layer around a library would be, and every one of them needs the
 * theme's CSS variables, the app's currency formatting and a hover layer that
 * matches the rest of the UI — which is most of what a library is for. It also
 * keeps the dashboard's JavaScript where it is rather than adding ~50kB to
 * every page that imports a chart.
 *
 * Sizing: the SVG is drawn at the container's measured pixel width so text and
 * hairlines land on whole pixels. Before the first measurement it renders at a
 * default width and is scaled by the viewBox, which is wrong for exactly one
 * frame — `useLayoutEffect` corrects it before paint.
 */
function useWidth<T extends HTMLElement>(fallback: number) {
  const ref = React.useRef<T>(null);
  const [width, setWidth] = React.useState(fallback);

  const layoutEffect = typeof window === "undefined" ? React.useEffect : React.useLayoutEffect;
  layoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new ResizeObserver((entries) => {
      const next = entries[0]?.contentRect.width;
      if (next && next > 0) setWidth(Math.round(next));
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return { ref, width };
}

/** Shared chrome: hairline gridlines, y ticks, x labels. */
function Grid({
  box,
  scale,
  format,
  days,
  labelCount,
}: {
  box: PlotBox;
  scale: Scale;
  format: (value: number) => string;
  days: string[];
  labelCount: number;
}) {
  return (
    <g aria-hidden>
      {scale.ticks.map((value) => {
        const y = scaleY(box, value, scale.max);
        return (
          <g key={value}>
            <line
              x1={box.left}
              x2={box.left + box.width}
              y1={y}
              y2={y}
              stroke="var(--viz-grid)"
              strokeWidth={1}
              shapeRendering="crispEdges"
            />
            <text
              x={box.left - 8}
              y={y}
              textAnchor="end"
              dominantBaseline="middle"
              className="tabular fill-muted-foreground text-[10px]"
            >
              {format(value)}
            </text>
          </g>
        );
      })}
      {labelIndices(days.length, labelCount).map((index) => (
        <text
          key={index}
          x={pointX(box, index, days.length)}
          y={box.top + box.height + 15}
          textAnchor={index === 0 ? "start" : index === days.length - 1 ? "end" : "middle"}
          className="fill-muted-foreground text-[10px]"
        >
          {dayLabel(days[index] ?? "")}
        </text>
      ))}
    </g>
  );
}

/** The floating readout. Values lead, series names follow. */
function Tooltip({
  x,
  width,
  title,
  rows,
}: {
  x: number;
  width: number;
  title: string;
  rows: { label: string; value: string; color?: string }[];
}) {
  // Flipped to the other side of the crosshair near the right edge so it never
  // runs off the card.
  const flip = x > width * 0.6;
  return (
    <div
      className="pointer-events-none absolute top-2 z-10 min-w-[7.5rem] rounded-md border border-border bg-card p-2.5 shadow-lg"
      style={flip ? { right: width - x + 10 } : { left: x + 10 }}
    >
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{title}</p>
      <ul className="mt-1.5 space-y-1">
        {rows.map((row) => (
          <li key={row.label} className="flex items-center gap-2 text-xs">
            {row.color ? (
              <span aria-hidden className="h-0.5 w-2.5 shrink-0 rounded-full" style={{ background: row.color }} />
            ) : null}
            <span className="tabular font-semibold">{row.value}</span>
            <span className="ml-auto pl-2 text-muted-foreground">{row.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * A single series over time. One measure, one hue, an area wash beneath the
 * line — no second axis, no second series.
 */
export function TrendArea({
  days,
  values,
  format,
  seriesLabel,
  height = 200,
}: {
  days: string[];
  values: number[];
  format: (value: number) => string;
  seriesLabel: string;
  height?: number;
}) {
  const { ref, width } = useWidth<HTMLDivElement>(640);
  const [hover, setHover] = React.useState<number | null>(null);

  const box: PlotBox = { left: 52, top: 10, width: Math.max(80, width - 64), height: height - 40 };
  const scale = niceScale(Math.max(...values, 0));

  const active = hover === null ? null : hover;
  const activeX = active === null ? 0 : pointX(box, active, values.length);

  return (
    <div ref={ref} className="relative">
      <svg
        width="100%"
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`${seriesLabel} per day. The same values are listed under “Show the numbers”.`}
        onPointerMove={(event) => {
          const bounds = event.currentTarget.getBoundingClientRect();
          setHover(nearestIndex(box, event.clientX - bounds.left, values.length));
        }}
        onPointerLeave={() => setHover(null)}
      >
        <Grid box={box} scale={scale} format={format} days={days} labelCount={5} />

        <path d={areaPath(values, box, scale.max)} fill="rgb(var(--viz-accent-wash) / 0.12)" />
        <path
          d={linePath(values, box, scale.max)}
          fill="none"
          stroke="var(--viz-accent)"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {active !== null ? (
          <g aria-hidden>
            <line
              x1={activeX}
              x2={activeX}
              y1={box.top}
              y2={box.top + box.height}
              stroke="var(--viz-axis)"
              strokeWidth={1}
            />
            <circle
              cx={activeX}
              cy={scaleY(box, values[active] ?? 0, scale.max)}
              r={4}
              fill="var(--viz-accent)"
              stroke="var(--viz-surface)"
              strokeWidth={2}
            />
          </g>
        ) : null}
      </svg>

      {active !== null ? (
        <Tooltip
          x={activeX}
          width={width}
          title={dayLabel(days[active] ?? "")}
          rows={[{ label: seriesLabel, value: format(values[active] ?? 0), color: "var(--viz-accent)" }]}
        />
      ) : null}
    </div>
  );
}

/**
 * Gains above a zero baseline, losses below it.
 *
 * The two hues are close enough under deuteranopia that colour alone would not
 * separate them; the baseline does. A bar above the line is a subscription
 * started and a bar below it is one cancelled, whatever the reader sees of the
 * hue — and the legend and the tooltip both name which is which.
 */
export function MovementColumns({
  days,
  gains,
  losses,
  gainLabel,
  lossLabel,
  height = 200,
}: {
  days: string[];
  gains: number[];
  losses: number[];
  gainLabel: string;
  lossLabel: string;
  height?: number;
}) {
  const { ref, width } = useWidth<HTMLDivElement>(640);
  const [hover, setHover] = React.useState<number | null>(null);

  const box: PlotBox = { left: 44, top: 10, width: Math.max(80, width - 56), height: height - 40 };
  const scale = niceScale(Math.max(...gains, ...losses, 1), { integer: true });
  const max = scale.max;
  const zero = box.top + box.height / 2;
  const halfHeight = box.height / 2;
  // Both arms share one scale, so a bar of five above the line is the same
  // length as a bar of five below it. Labelled at the ends and the midpoint
  // only — mirroring the full tick set would put a gridline every 18px.
  const half = max / 2;
  const marks = Number.isInteger(half) ? [max, half, 0, -half, -max] : [max, 0, -max];

  const slot = box.width / Math.max(1, days.length);
  // Capped, and the leftover in the slot is the gap that separates neighbours.
  const barWidth = Math.max(1, Math.min(24, slot - 2));

  return (
    <div ref={ref} className="relative">
      <svg
        width="100%"
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`${gainLabel} and ${lossLabel} per day. The same values are listed under “Show the numbers”.`}
        onPointerMove={(event) => {
          const bounds = event.currentTarget.getBoundingClientRect();
          const ratio = (event.clientX - bounds.left - box.left) / box.width;
          setHover(Math.min(days.length - 1, Math.max(0, Math.floor(ratio * days.length))));
        }}
        onPointerLeave={() => setHover(null)}
      >
        <g aria-hidden>
          {marks.map((value) => {
            const y = zero - (value / max) * halfHeight;
            return (
              <g key={value}>
                <line
                  x1={box.left}
                  x2={box.left + box.width}
                  y1={y}
                  y2={y}
                  stroke={value === 0 ? "var(--viz-axis)" : "var(--viz-grid)"}
                  strokeWidth={1}
                  shapeRendering="crispEdges"
                />
                <text
                  x={box.left - 8}
                  y={y}
                  textAnchor="end"
                  dominantBaseline="middle"
                  className="tabular fill-muted-foreground text-[10px]"
                >
                  {compactCount(Math.abs(value))}
                </text>
              </g>
            );
          })}
          {labelIndices(days.length, 5).map((index) => (
            <text
              key={index}
              x={slotCentre(box, index, days.length)}
              y={box.top + box.height + 15}
              textAnchor="middle"
              className="fill-muted-foreground text-[10px]"
            >
              {dayLabel(days[index] ?? "")}
            </text>
          ))}
        </g>

        {days.map((day, index) => {
          const centre = slotCentre(box, index, days.length);
          const x = centre - barWidth / 2;
          const gain = gains[index] ?? 0;
          const loss = losses[index] ?? 0;
          const gainHeight = (gain / max) * halfHeight;
          const lossHeight = (loss / max) * halfHeight;
          return (
            <g key={day}>
              {gain > 0 ? (
                <path
                  d={barPath(x, zero - gainHeight, barWidth, gainHeight, 4, "top")}
                  fill="var(--viz-gain)"
                  opacity={hover === null || hover === index ? 1 : 0.45}
                />
              ) : null}
              {loss > 0 ? (
                <path
                  d={barPath(x, zero, barWidth, lossHeight, 4, "bottom")}
                  fill="var(--viz-loss)"
                  opacity={hover === null || hover === index ? 1 : 0.45}
                />
              ) : null}
            </g>
          );
        })}
      </svg>

      {hover !== null ? (
        <Tooltip
          x={slotCentre(box, hover, days.length)}
          width={width}
          title={dayLabel(days[hover] ?? "")}
          rows={[
            { label: gainLabel, value: String(gains[hover] ?? 0), color: "var(--viz-gain)" },
            { label: lossLabel, value: String(losses[hover] ?? 0), color: "var(--viz-loss)" },
          ]}
        />
      ) : null}
    </div>
  );
}

/**
 * Two stacked parts of one daily total. Order is fixed — the good outcome is
 * always the lower segment — so the stack reads the same way every day and the
 * position carries the identity alongside the hue.
 */
export function OutcomeColumns({
  days,
  lower,
  upper,
  lowerLabel,
  upperLabel,
  height = 180,
}: {
  days: string[];
  lower: number[];
  upper: number[];
  lowerLabel: string;
  upperLabel: string;
  height?: number;
}) {
  const { ref, width } = useWidth<HTMLDivElement>(640);
  const [hover, setHover] = React.useState<number | null>(null);

  const box: PlotBox = { left: 44, top: 10, width: Math.max(80, width - 56), height: height - 40 };
  const totals = days.map((_, index) => (lower[index] ?? 0) + (upper[index] ?? 0));
  const scale = niceScale(Math.max(...totals, 1), { integer: true });
  const max = scale.max;

  const slot = box.width / Math.max(1, days.length);
  const barWidth = Math.max(1, Math.min(24, slot - 2));

  return (
    <div ref={ref} className="relative">
      <svg
        width="100%"
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`${lowerLabel} and ${upperLabel} per day. The same values are listed under “Show the numbers”.`}
        onPointerMove={(event) => {
          const bounds = event.currentTarget.getBoundingClientRect();
          const ratio = (event.clientX - bounds.left - box.left) / box.width;
          setHover(Math.min(days.length - 1, Math.max(0, Math.floor(ratio * days.length))));
        }}
        onPointerLeave={() => setHover(null)}
      >
        <Grid box={box} scale={scale} format={compactCount} days={days} labelCount={5} />

        {days.map((day, index) => {
          const centre = slotCentre(box, index, days.length);
          const x = centre - barWidth / 2;
          const low = lower[index] ?? 0;
          const high = upper[index] ?? 0;
          const base = box.top + box.height;
          const lowHeight = (low / max) * box.height;
          const highHeight = (high / max) * box.height;
          const dim = hover !== null && hover !== index;
          // A 2px gap in the surface colour is what separates the segments —
          // there is no stroke around either of them.
          const gap = high > 0 && low > 0 ? 2 : 0;
          return (
            <g key={day} opacity={dim ? 0.45 : 1}>
              {low > 0 ? (
                <path
                  d={barPath(x, base - lowHeight, barWidth, lowHeight, high > 0 ? 0 : 4, "top")}
                  fill="var(--viz-healthy)"
                />
              ) : null}
              {high > 0 ? (
                <path
                  d={barPath(x, base - lowHeight - gap - highHeight, barWidth, highHeight, 4, "top")}
                  fill="var(--viz-loss)"
                />
              ) : null}
            </g>
          );
        })}
      </svg>

      {hover !== null ? (
        <Tooltip
          x={slotCentre(box, hover, days.length)}
          width={width}
          title={dayLabel(days[hover] ?? "")}
          rows={[
            { label: lowerLabel, value: String(lower[hover] ?? 0), color: "var(--viz-healthy)" },
            { label: upperLabel, value: String(upper[hover] ?? 0), color: "var(--viz-loss)" },
          ]}
        />
      ) : null}
    </div>
  );
}

export interface Segment {
  label: string;
  value: number;
  color: string;
  detail?: string;
}

/**
 * Part-to-whole across one bar. Three segments, because the question a founder
 * opens this page with is "how much of my book is healthy" — the five raw
 * statuses are listed underneath rather than turned into five hues that no
 * colour-vision model can keep apart.
 */
export function HealthBar({ segments }: { segments: Segment[] }) {
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);
  const shown = segments.filter((segment) => segment.value > 0);

  if (total === 0) {
    return <div className="h-3 rounded-full" style={{ background: "var(--viz-grid)" }} />;
  }

  return (
    <div>
      <div className="flex h-3 gap-0.5" role="img" aria-label={describeSegments(segments, total)}>
        {shown.map((segment, index) => (
          <div
            key={segment.label}
            className={cn(
              "h-full",
              index === 0 && "rounded-l-full",
              index === shown.length - 1 && "rounded-r-full"
            )}
            style={{ background: segment.color, width: `${(segment.value / total) * 100}%` }}
          />
        ))}
      </div>

      {/* The value beside every label, so the amber segment — which sits below
          3:1 against the card — never has to carry its share on colour. */}
      <ul className="mt-4 grid gap-x-6 gap-y-2.5 sm:grid-cols-3">
        {segments.map((segment) => (
          <li key={segment.label}>
            <div className="flex items-center gap-2">
              <span aria-hidden className="size-2.5 shrink-0 rounded-[3px]" style={{ background: segment.color }} />
              <span className="text-xs text-muted-foreground">{segment.label}</span>
            </div>
            <p className="tabular mt-1 text-lg font-semibold leading-none">
              {segment.value}
              <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                {Math.round((segment.value / total) * 100)}%
              </span>
            </p>
            {segment.detail ? (
              <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{segment.detail}</p>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function describeSegments(segments: Segment[], total: number): string {
  return segments
    .map((segment) => `${segment.label}: ${segment.value} of ${total}`)
    .join(", ");
}

/**
 * Ranked horizontal bars. One hue for every bar — plans have no natural order,
 * so shading them by size would spend the colour channel restating the length
 * the bar already shows.
 */
export function BarList({
  items,
  height = 26,
}: {
  items: { label: string; value: number; display: string; note?: string }[];
  height?: number;
}) {
  const max = Math.max(...items.map((item) => item.value), 1);

  return (
    <ul className="space-y-3">
      {items.map((item) => (
        <li key={item.label}>
          <div className="flex items-baseline justify-between gap-4 pb-1">
            <span className="truncate text-xs font-medium">{item.label}</span>
            <span className="tabular shrink-0 text-xs text-muted-foreground">{item.display}</span>
          </div>
          <div className="relative" style={{ height: height / 3 }}>
            <div className="absolute inset-0 rounded-full" style={{ background: "var(--viz-grid)" }} />
            {/* Rounded at the measuring end, square where it meets the axis —
                a bar rounded at both ends reads as floating free of the zero
                it is measured from. */}
            <div
              className="absolute inset-y-0 left-0 rounded-r-full"
              style={{
                background: "var(--viz-accent)",
                width: `${Math.max(2, (item.value / max) * 100)}%`,
              }}
            />
          </div>
          {item.note ? <p className="mt-1 text-[11px] text-muted-foreground">{item.note}</p> : null}
        </li>
      ))}
    </ul>
  );
}

/** A 12-point trend behind a stat tile. Decoration for the number beside it. */
export function Sparkline({ values, width = 96, height = 28 }: { values: number[]; width?: number; height?: number }) {
  if (values.length < 2) return null;
  const box: PlotBox = { left: 1, top: 2, width: width - 2, height: height - 4 };
  const max = Math.max(...values, 1);

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden className="shrink-0">
      <path d={areaPath(values, box, max)} fill="rgb(var(--viz-accent-wash) / 0.14)" />
      <path
        d={linePath(values, box, max)}
        fill="none"
        stroke="var(--viz-accent)"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
