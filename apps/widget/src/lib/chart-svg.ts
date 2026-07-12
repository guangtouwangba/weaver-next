// Pure, deterministic chart geometry — no React, no DOM, no randomness — so it
// renders identically in both hosts and is unit-testable. Turns a ChartContent
// spec + a pixel box into SVG-ready primitives (points, paths, rects, ticks).
// Every helper degrades gracefully on empty / NaN / single-point / all-zero data.
import type { ChartContent, ChartSeries } from "../types";

// A small investor-friendly hue ramp for multi-series charts. Single-series
// charts fall back to the node accent (see ChartCard), keeping the canvas calm.
export const CHART_PALETTE = ["#1fa2dc", "#f2a900", "#5ac8a0", "#e0655b", "#8a7ff0", "#e08fc0"];

export function seriesColor(index: number, explicit?: string): string {
  return explicit || CHART_PALETTE[((index % CHART_PALETTE.length) + CHART_PALETTE.length) % CHART_PALETTE.length];
}

const finite = (n: number) => (Number.isFinite(n) ? n : 0);
const round = (n: number) => Math.round(n * 100) / 100;

export interface Box { x: number; y: number; width: number; height: number }
export interface Pt { x: number; y: number }

const MARGIN = { left: 34, right: 12, top: 12, bottom: 20 };

export function plotBox(width: number, height: number): Box {
  return { x: MARGIN.left, y: MARGIN.top, width: Math.max(1, width - MARGIN.left - MARGIN.right), height: Math.max(1, height - MARGIN.top - MARGIN.bottom) };
}

/** Value range for an axis. `includeZero` anchors bars/areas to a 0 baseline;
 * a degenerate (all-equal) range is widened by 1 so nothing divides by zero. */
export function valueExtent(values: number[], includeZero = true): { min: number; max: number } {
  const clean = values.filter((v) => Number.isFinite(v));
  let min = clean.length ? Math.min(...clean) : 0;
  let max = clean.length ? Math.max(...clean) : 0;
  if (includeZero) { min = Math.min(min, 0); max = Math.max(max, 0); }
  if (min === max) max = min + 1;
  return { min, max };
}

/** Compact, locale-light number formatting (万/亿) with an optional unit; never
 * scales percentages. */
export function formatValue(value: number, unit = ""): string {
  if (!Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  const scale = unit !== "%";
  let text: string;
  if (scale && abs >= 1e8) text = `${round10(value / 1e8)}亿`;
  else if (scale && abs >= 1e4) text = `${round10(value / 1e4)}万`;
  else text = Number.isInteger(value) ? String(value) : String(round10(value));
  return unit ? `${text}${unit}` : text;
}
const round10 = (n: number) => Math.round(n * 10) / 10;

function xAt(index: number, count: number, box: Box) {
  return count <= 1 ? box.x + box.width / 2 : box.x + (box.width * index) / (count - 1);
}
function yAt(value: number, ext: { min: number; max: number }, box: Box) {
  const t = (finite(value) - ext.min) / (ext.max - ext.min);
  return box.y + box.height * (1 - t);
}

export function linePoints(points: Array<{ label: string; value: number }>, box: Box, ext: { min: number; max: number }): Pt[] {
  return points.map((point, index) => ({ x: xAt(index, points.length, box), y: yAt(point.value, ext, box) }));
}

export function polyline(points: Pt[]): string {
  return points.map((point) => `${round(point.x)},${round(point.y)}`).join(" ");
}

/** Closed area path: the polyline dropped to the plot baseline and back. */
export function areaPath(points: Pt[], box: Box): string {
  if (!points.length) return "";
  const base = box.y + box.height;
  const first = points[0];
  const last = points[points.length - 1];
  return `M ${round(first.x)} ${round(base)} ` + points.map((point) => `L ${round(point.x)} ${round(point.y)}`).join(" ") + ` L ${round(last.x)} ${round(base)} Z`;
}

export interface Bar { x: number; y: number; width: number; height: number; color: string; label: string; value: number; series: number }

/** Grouped bars: one cluster per label (from the first series' points), one bar
 * per series within a cluster. Handles the single-series case naturally. */
export function barRects(series: ChartSeries[], box: Box, ext: { min: number; max: number }): Bar[] {
  const groups = series[0]?.points.length ?? 0;
  if (!groups || !series.length) return [];
  const groupWidth = box.width / groups;
  const gap = groupWidth * 0.2;
  const barWidth = (groupWidth - gap) / series.length;
  const baseline = yAt(Math.min(Math.max(0, ext.min), ext.max), ext, box);
  const bars: Bar[] = [];
  for (let gi = 0; gi < groups; gi += 1) {
    for (let si = 0; si < series.length; si += 1) {
      const value = finite(series[si].points[gi]?.value ?? 0);
      const y = yAt(value, ext, box);
      const x = box.x + gi * groupWidth + gap / 2 + si * barWidth;
      bars.push({ x: round(x), y: round(Math.min(y, baseline)), width: round(Math.max(1, barWidth - 2)), height: round(Math.max(0, Math.abs(y - baseline))), color: seriesColor(si, series[si].color), label: series[0].points[gi]?.label ?? "", value, series: si });
    }
  }
  return bars;
}

export interface Slice { path: string; color: string; label: string; value: number; pct: number; mid: number }

export function arcPath(cx: number, cy: number, r: number, a0: number, a1: number): string {
  const x0 = cx + r * Math.cos(a0); const y0 = cy + r * Math.sin(a0);
  const x1 = cx + r * Math.cos(a1); const y1 = cy + r * Math.sin(a1);
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return `M ${round(cx)} ${round(cy)} L ${round(x0)} ${round(y0)} A ${round(r)} ${round(r)} 0 ${large} 1 ${round(x1)} ${round(y1)} Z`;
}

/** Pie slices from the first series' points. Only positive values count; a
 * zero/empty total yields no slices (caller shows a placeholder). */
export function pieSlices(points: Array<{ label: string; value: number }>, cx: number, cy: number, r: number): Slice[] {
  const positive = points.map((point) => ({ label: point.label, value: Math.max(0, finite(point.value)) })).filter((point) => point.value > 0);
  const total = positive.reduce((sum, point) => sum + point.value, 0);
  if (total <= 0) return [];
  let angle = -Math.PI / 2;
  return positive.map((point, index) => {
    const next = angle + (point.value / total) * Math.PI * 2;
    const slice: Slice = { path: arcPath(cx, cy, r, angle, next), color: seriesColor(index), label: point.label, value: point.value, pct: point.value / total, mid: (angle + next) / 2 };
    angle = next;
    return slice;
  });
}

export type ChartLayout =
  | { kind: "line" | "area"; box: Box; series: Array<{ name: string; color: string; points: Pt[]; polyline: string; areaPath: string }>; xLabels: Array<{ x: number; label: string }>; yTicks: Array<{ y: number; label: string }> }
  | { kind: "bar"; box: Box; bars: Bar[]; xLabels: Array<{ x: number; label: string }>; yTicks: Array<{ y: number; label: string }>; legend: Array<{ name: string; color: string }> }
  | { kind: "pie"; slices: Slice[]; cx: number; cy: number; r: number }
  | { kind: "metric"; value: string; delta?: { text: string; sign: 1 | -1 | 0 } }
  | { kind: "empty" };

/** Turn a chart spec + pixel box into render-ready geometry. The single entry
 * ChartCard consumes; pure and deterministic. */
export function layoutChart(spec: ChartContent, width: number, height: number): ChartLayout {
  if (spec.chartType === "metric") {
    const metric = spec.metric;
    const delta = metric && metric.delta != null && Number.isFinite(metric.delta)
      ? { text: `${metric.delta > 0 ? "+" : ""}${round10(metric.delta)}${metric.deltaLabel ? ` ${metric.deltaLabel}` : ""}`, sign: (Math.sign(metric.delta) as 1 | -1 | 0) }
      : undefined;
    return { kind: "metric", value: formatValue(metric?.value ?? 0, metric?.unit || spec.unit), delta };
  }

  if (spec.chartType === "pie") {
    const points = spec.series[0]?.points ?? [];
    const cx = width / 2;
    const cy = height / 2;
    const r = Math.max(8, Math.min(width, height) / 2 - 14);
    return { kind: "pie", slices: pieSlices(points, cx, cy, r), cx, cy, r };
  }

  const box = plotBox(width, height);
  const series = spec.series.filter((s) => s.points.length);
  if (!series.length) return { kind: "empty" };
  const allValues = series.flatMap((s) => s.points.map((p) => p.value));
  const ext = valueExtent(allValues, spec.chartType === "bar" || spec.chartType === "area");
  const labels = series[0].points;
  const xLabels = labels.map((point, index) => ({ x: xAt(index, labels.length, box), label: point.label }));
  const yTicks = [ext.max, (ext.min + ext.max) / 2, ext.min].map((value) => ({ y: yAt(value, ext, box), label: formatValue(value, spec.unit) }));

  if (spec.chartType === "bar") {
    return { kind: "bar", box, bars: barRects(series, box, ext), xLabels, yTicks, legend: series.map((s, i) => ({ name: s.name, color: seriesColor(i, s.color) })) };
  }

  const mapped = series.map((s, i) => {
    const points = linePoints(s.points, box, ext);
    return { name: s.name, color: seriesColor(i, s.color), points, polyline: polyline(points), areaPath: spec.chartType === "area" ? areaPath(points, box) : "" };
  });
  return { kind: spec.chartType, box, series: mapped, xLabels, yTicks };
}
