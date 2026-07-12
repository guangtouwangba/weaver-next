import { describe, expect, it } from "vitest";
import type { ChartContent } from "../types";
import { formatValue, layoutChart, pieSlices, valueExtent } from "../lib/chart-svg";

const chart = (over: Partial<ChartContent>): ChartContent => ({ kind: "chart", chartType: "line", title: "", series: [], unit: "", xLabel: "", yLabel: "", sourceNote: "", asOf: "", ...over });
const line = (values: number[]) => [{ name: "s", points: values.map((v, i) => ({ label: `${2020 + i}`, value: v })) }];

describe("chart-svg geometry", () => {
  it("valueExtent includes zero and widens a degenerate range", () => {
    expect(valueExtent([10, 20, 30])).toEqual({ min: 0, max: 30 });
    expect(valueExtent([5, 5, 5])).toEqual({ min: 0, max: 5 });
    const flat = valueExtent([7], false);
    expect(flat.max).toBeGreaterThan(flat.min); // never zero-range
    expect(valueExtent([])).toEqual({ min: 0, max: 1 });
  });

  it("formatValue scales 万/亿 but never percentages", () => {
    expect(formatValue(12000)).toBe("1.2万");
    expect(formatValue(250000000)).toBe("2.5亿");
    expect(formatValue(42, "个")).toBe("42个");
    expect(formatValue(37.5, "%")).toBe("37.5%");
  });

  it("lays out a line chart into points, polyline and 3 y-ticks", () => {
    const model = layoutChart(chart({ chartType: "line", series: line([100, 180, 240, 300]) }), 320, 220);
    if (model.kind !== "line") throw new Error("expected line");
    expect(model.series).toHaveLength(1);
    expect(model.series[0].points).toHaveLength(4);
    expect(model.series[0].polyline.split(" ")).toHaveLength(4);
    expect(model.yTicks).toHaveLength(3);
    // x increases monotonically across the plot.
    const xs = model.series[0].points.map((p) => p.x);
    expect(xs).toEqual([...xs].sort((a, b) => a - b));
  });

  it("closes the area path", () => {
    const model = layoutChart(chart({ chartType: "area", series: line([1, 2, 3]) }), 300, 200);
    if (model.kind !== "area") throw new Error("expected area");
    expect(model.series[0].areaPath.startsWith("M ")).toBe(true);
    expect(model.series[0].areaPath.trim().endsWith("Z")).toBe(true);
  });

  it("emits grouped bars, one per (label, series), never negative height", () => {
    const model = layoutChart(chart({ chartType: "bar", series: [line([10, 20, 30])[0], { name: "b", points: [{ label: "2020", value: 5 }, { label: "2021", value: 15 }, { label: "2022", value: 25 }] }] }), 320, 220);
    if (model.kind !== "bar") throw new Error("expected bar");
    expect(model.bars).toHaveLength(6); // 3 labels × 2 series
    expect(model.legend).toHaveLength(2);
    expect(model.bars.every((bar) => bar.height >= 0 && bar.width > 0)).toBe(true);
  });

  it("pie slices cover the circle and drop non-positive values", () => {
    const slices = pieSlices([{ label: "A", value: 40 }, { label: "B", value: 35 }, { label: "C", value: 25 }, { label: "D", value: 0 }], 100, 100, 80);
    expect(slices).toHaveLength(3); // zero dropped
    expect(slices.reduce((sum, s) => sum + s.pct, 0)).toBeCloseTo(1, 6);
    expect(pieSlices([{ label: "x", value: 0 }], 100, 100, 80)).toEqual([]); // all-zero → none
  });

  it("formats a metric card with a signed delta", () => {
    const up = layoutChart(chart({ chartType: "metric", metric: { value: 128, unit: "亿", delta: 12.5, deltaLabel: "同比" } }), 240, 130);
    if (up.kind !== "metric") throw new Error("expected metric");
    expect(up.value).toBe("128亿");
    expect(up.delta).toMatchObject({ sign: 1 });
    expect(up.delta?.text).toContain("+12.5");
    expect(up.delta?.text).toContain("同比");

    const down = layoutChart(chart({ chartType: "metric", metric: { value: 3, unit: "", delta: -4, deltaLabel: "" } }), 240, 130);
    if (down.kind !== "metric") throw new Error("expected metric");
    expect(down.delta?.sign).toBe(-1);
  });

  it("degrades to empty on a chart with no data", () => {
    expect(layoutChart(chart({ chartType: "line", series: [] }), 300, 200).kind).toBe("empty");
  });
});
