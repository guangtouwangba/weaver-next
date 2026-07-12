import { BaseEdge, EdgeLabelRenderer, getBezierPath, getSmoothStepPath, getStraightPath, type EdgeProps } from "@xyflow/react";
import type { EdgeArrows, EdgeLineStyle, EdgeRouting } from "../lib/edge-style";

type RouteData = { routing?: EdgeRouting; waypoints?: Array<{ x: number; y: number }>; semanticType?: string; arrows?: EdgeArrows; lineStyle?: EdgeLineStyle; muted?: boolean };

// Single arrowhead marker, shared by markerStart and markerEnd. orient
// "auto-start-reverse" flips it for the start end, so `both` reuses the same id.
// fill "context-stroke" inherits the edge's stroke colour, so selection (blue)
// and muted states colour the arrowhead automatically. Mounted once by the stage.
export const WEAVER_EDGE_MARKER_ID = "weaver-arrow";
export function WeaverEdgeMarkers() {
  return <svg aria-hidden style={{ position: "absolute", width: 0, height: 0, overflow: "hidden" }}>
    <defs>
      <marker id={WEAVER_EDGE_MARKER_ID} viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
        <path d="M0,0 L10,5 L0,10 z" fill="context-stroke" />
      </marker>
    </defs>
  </svg>;
}

export function WeaverEdge(props: EdgeProps) {
  const { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, selected, style, label, data } = props;
  const route = (data ?? {}) as RouteData;
  let path: string;
  let labelX: number;
  let labelY: number;
  if (route.waypoints && route.waypoints.length > 2) {
    const points = [{ x: sourceX, y: sourceY }, ...route.waypoints.slice(1, -1), { x: targetX, y: targetY }];
    path = points.map((point, index) => `${index ? "L" : "M"}${point.x},${point.y}`).join(" ");
    const middle = points[Math.floor(points.length / 2)]; labelX = middle.x; labelY = middle.y;
  } else if (route.routing === "orthogonal") {
    [path, labelX, labelY] = getSmoothStepPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, borderRadius: 12 });
  } else if (route.routing === "bezier" || route.routing === "bundled") {
    [path, labelX, labelY] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
  } else {
    // Straight is the default routing for typed edges.
    [path, labelX, labelY] = getStraightPath({ sourceX, sourceY, targetX, targetY });
  }
  const arrows = route.arrows ?? "forward";
  const dashed = route.lineStyle === "dashed";
  const muted = route.muted ?? false;
  const markerRef = `url(#${WEAVER_EDGE_MARKER_ID})`;
  const baseWidth = Number(style?.strokeWidth ?? 1.5);
  return <>
    <BaseEdge id={id} path={path} interactionWidth={24}
      markerStart={arrows === "both" ? markerRef : undefined}
      markerEnd={arrows === "forward" || arrows === "both" ? markerRef : undefined}
      style={{
        ...style,
        stroke: selected ? "var(--blue)" : style?.stroke,
        strokeWidth: selected ? baseWidth + 1 : baseWidth,
        strokeDasharray: dashed ? "6 5" : undefined,
        opacity: selected ? 1 : muted ? 0.5 : style?.opacity,
      }} />
    {label ? <EdgeLabelRenderer><span className="weaver-edge-label" data-selected={selected || undefined} data-muted={muted || undefined} style={{ transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)` }}>{String(label)}</span></EdgeLabelRenderer> : null}
  </>;
}
