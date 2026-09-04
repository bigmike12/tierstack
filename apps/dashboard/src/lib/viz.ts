/**
 * Geometry and number formatting for the overview charts.
 *
 * Everything here is pure: given the same series it returns the same path
 * string, so the charts can be reasoned about (and the axis maths checked)
 * without a browser. The components do layout and interaction; this file does
 * arithmetic.
 */

export interface Scale {
  max: number;
  ticks: number[];
}

/**
 * An axis whose gridlines land on round numbers.
 *
 * Rounding only the top of the scale is not enough: dividing a round maximum
 * into a fixed number of gridlines puts labels on 6.25 and 18.75. So the
 * *step* is what gets chosen from the nice set, and the top of the scale is
 * whatever multiple of that step first covers the data — which is why every
 * label on these charts is a number somebody would say out loud.
 *
 * `integer` forbids fractional steps, for axes counting whole things. Nothing
 * is half a payment attempt.
 */
export function niceScale(max: number, { integer = false } = {}): Scale {
  if (!(max > 0)) return integer ? { max: 1, ticks: [0, 1] } : { max: 1, ticks: [0, 0.5, 1] };

  const magnitude = 10 ** Math.floor(Math.log10(max));
  for (const multiple of [0.1, 0.2, 0.25, 0.5, 1, 2, 2.5, 5, 10]) {
    const step = multiple * magnitude;
    if (integer && !Number.isInteger(step)) continue;
    const divisions = Math.ceil(max / step);
    // Three to six bands: fewer and the axis stops carrying the values the
    // chart does not directly label; more and the gridlines become a texture.
    if (divisions >= 3 && divisions <= 6) {
      return {
        max: step * divisions,
        ticks: Array.from({ length: divisions + 1 }, (_, index) => step * index),
      };
    }
  }

  // Small integer counts (1, 2) have no step in that band; label every value.
  const top = Math.max(1, Math.ceil(max));
  return { max: top, ticks: Array.from({ length: top + 1 }, (_, index) => index) };
}

/** 1_284 -> "1.3k". For counts — money goes through formatCompact instead. */
export function compactCount(value: number): string {
  const absolute = Math.abs(value);
  if (absolute < 1000) return String(Math.round(value));
  if (absolute < 1_000_000) return `${(value / 1000).toFixed(absolute < 10_000 ? 1 : 0)}k`;
  return `${(value / 1_000_000).toFixed(1)}m`;
}

/** "2026-08-05" -> "5 Aug". Parsed as UTC, which is how the API buckets days. */
export function dayLabel(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(date);
}

/**
 * Indices of the labels to actually draw on a time axis.
 *
 * Always includes the first and last, and spaces the rest evenly. A 365-day
 * window has 365 buckets and room for about six labels; drawing all of them is
 * how an axis turns into a grey smear.
 */
export function labelIndices(length: number, wanted: number): number[] {
  if (length <= wanted) return Array.from({ length }, (_, index) => index);
  const step = (length - 1) / (wanted - 1);
  const indices = Array.from({ length: wanted }, (_, index) => Math.round(index * step));
  return [...new Set(indices)];
}

/**
 * A rectangle rounded on one end only.
 *
 * Bars grow from a baseline, and a bar rounded at both ends looks like it is
 * floating clear of the axis it is measured from. `side` is the end that gets
 * the radius; the baseline end stays square. The radius is also clamped to
 * half the bar's length, so a one-pixel bar does not curl into a lozenge.
 */
export function barPath(
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
  side: "top" | "bottom" | "right" | "left"
): string {
  const across = side === "top" || side === "bottom" ? width : height;
  const along = side === "top" || side === "bottom" ? height : width;
  const r = Math.max(0, Math.min(radius, across / 2, along));

  switch (side) {
    case "top":
      return `M${x},${y + height} L${x},${y + r} Q${x},${y} ${x + r},${y} L${x + width - r},${y} Q${x + width},${y} ${x + width},${y + r} L${x + width},${y + height} Z`;
    case "bottom":
      return `M${x},${y} L${x},${y + height - r} Q${x},${y + height} ${x + r},${y + height} L${x + width - r},${y + height} Q${x + width},${y + height} ${x + width},${y + height - r} L${x + width},${y} Z`;
    case "right":
      return `M${x},${y} L${x + width - r},${y} Q${x + width},${y} ${x + width},${y + r} L${x + width},${y + height - r} Q${x + width},${y + height} ${x + width - r},${y + height} L${x},${y + height} Z`;
    default:
      return `M${x + width},${y} L${x + r},${y} Q${x},${y} ${x},${y + r} L${x},${y + height - r} Q${x},${y + height} ${x + r},${y + height} L${x + width},${y + height} Z`;
  }
}

export interface PlotBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Maps a series index to the centre of its slot along the x axis. */
export function slotCentre(box: PlotBox, index: number, count: number): number {
  if (count <= 1) return box.left + box.width / 2;
  return box.left + (box.width / count) * (index + 0.5);
}

/** Maps a value to a y coordinate inside the plot box. */
export function scaleY(box: PlotBox, value: number, max: number): number {
  if (max <= 0) return box.top + box.height;
  return box.top + box.height - (value / max) * box.height;
}

/** The line through a series, and the same line closed into an area. */
export function linePath(values: number[], box: PlotBox, max: number): string {
  if (values.length === 0) return "";
  return values
    .map((value, index) => {
      const x = pointX(box, index, values.length);
      const y = scaleY(box, value, max);
      return `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
}

export function areaPath(values: number[], box: PlotBox, max: number): string {
  if (values.length === 0) return "";
  const base = box.top + box.height;
  const first = pointX(box, 0, values.length);
  const last = pointX(box, values.length - 1, values.length);
  return `${linePath(values, box, max)} L${last.toFixed(2)},${base} L${first.toFixed(2)},${base} Z`;
}

/**
 * Where point `index` sits on the x axis for a line or area.
 *
 * Edge to edge rather than slot-centred: a line chart's first and last points
 * belong on the axis ends, where a column's would sit half a slot in.
 */
export function pointX(box: PlotBox, index: number, count: number): number {
  if (count <= 1) return box.left + box.width / 2;
  return box.left + (box.width / (count - 1)) * index;
}

/** The index nearest an x coordinate — what the crosshair snaps to. */
export function nearestIndex(box: PlotBox, x: number, count: number): number {
  if (count <= 1) return 0;
  const ratio = (x - box.left) / box.width;
  return Math.min(count - 1, Math.max(0, Math.round(ratio * (count - 1))));
}
