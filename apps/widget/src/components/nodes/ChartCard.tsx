import { useLayoutEffect, useRef, useState } from "react";
import type { Node, NodeProps } from "@xyflow/react";
import { TrendingDown, TrendingUp } from "lucide-react";
import type { CardData, ChartContent } from "../../types";
import { layoutChart } from "../../lib/chart-svg";
import { NodeShell } from "./NodeShell";
import { useI18n } from "../../lib/i18n";

// Inline-SVG data card. All geometry comes from the pure layoutChart(); colors
// follow the node's theme vars (axes/text) with the chart palette for series, so
// it stays theme-aware without hardcoded light/dark hex. No external chart lib.
function ChartSvg({ spec, width, height }: { spec: ChartContent; width: number; height: number }) {
  const { t } = useI18n();
  const model = layoutChart(spec, width, height);
  const axis = "var(--node-border, rgba(127,127,127,.3))";
  const text = "var(--muted, #7a7a7a)";
  const accent = "var(--node-accent, var(--blue, #1fa2dc))";

  if (model.kind === "empty") return <div className="chart-empty">{t("noData")}</div>;

  if (model.kind === "metric") {
    const sign = model.delta?.sign ?? 0;
    return <div className="chart-metric">
      <strong className="chart-metric-value">{model.value}</strong>
      {model.delta ? <span className="chart-metric-delta" data-sign={sign}>{sign > 0 ? <TrendingUp size={13} /> : sign < 0 ? <TrendingDown size={13} /> : null}{model.delta.text}</span> : null}
    </div>;
  }

  return <svg className="chart-svg" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img">
    {model.kind === "pie" ? <>
      {model.slices.length === 0 ? null : model.slices.map((slice, index) => <path key={index} d={slice.path} fill={slice.color} stroke="var(--node-fill, #1f1f1f)" strokeWidth={1} />)}
    </> : <>
      {model.yTicks.map((tick, index) => <g key={`y${index}`}>
        <line x1={model.box.x} y1={tick.y} x2={model.box.x + model.box.width} y2={tick.y} stroke={axis} strokeWidth={index === model.yTicks.length - 1 ? 1 : 0.5} strokeDasharray={index === model.yTicks.length - 1 ? undefined : "2 3"} />
        <text x={model.box.x - 4} y={tick.y} textAnchor="end" dominantBaseline="middle" fill={text} className="chart-axis-label">{tick.label}</text>
      </g>)}
      {model.kind === "bar"
        ? model.bars.map((bar, index) => <rect key={index} x={bar.x} y={bar.y} width={bar.width} height={bar.height} fill={bar.series === 0 && model.legend.length === 1 ? accent : bar.color} rx={1.5} />)
        : model.series.map((line, index) => <g key={index}>
            {spec.chartType === "area" ? <path d={line.areaPath} fill={model.series.length === 1 ? accent : line.color} fillOpacity={0.16} /> : null}
            <polyline points={line.polyline} fill="none" stroke={model.series.length === 1 ? accent : line.color} strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" />
            {line.points.map((point, pi) => <circle key={pi} cx={point.x} cy={point.y} r={2} fill={model.series.length === 1 ? accent : line.color} />)}
          </g>)}
      {model.xLabels.map((tick, index) => (index === 0 || index === model.xLabels.length - 1 || model.xLabels.length <= 6)
        ? <text key={`x${index}`} x={tick.x} y={height - 6} textAnchor={index === 0 ? "start" : index === model.xLabels.length - 1 ? "end" : "middle"} fill={text} className="chart-axis-label">{tick.label}</text>
        : null)}
    </>}
  </svg>;
}

export function ChartCard({ data, id, selected }: NodeProps<Node<CardData>>) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 300, height: 170 });
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect) setSize({ width: Math.max(80, rect.width), height: Math.max(48, rect.height) });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const spec = data.chart;
  const footer = spec ? [spec.sourceNote, spec.asOf].filter(Boolean).join(" · ") : "";
  return <NodeShell data={data} className="chart-card" id={id} selected={selected}>
    <div className="chart-head"><span>{spec?.chartType ?? "chart"}</span><strong>{spec?.title || data.title || "Untitled chart"}</strong></div>
    <div className="chart-canvas" ref={ref}>{spec ? <ChartSvg spec={spec} width={size.width} height={size.height} /> : null}</div>
    {footer ? <div className="chart-foot">{footer}</div> : null}
  </NodeShell>;
}
