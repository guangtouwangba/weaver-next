import { BaseEdge, EdgeLabelRenderer, getBezierPath, getSmoothStepPath, getStraightPath, type EdgeProps } from "@xyflow/react";

type RouteData = { routing?: "straight" | "bezier" | "orthogonal" | "bundled"; waypoints?: Array<{ x: number; y: number }>; semanticType?: string };

export function WeaverEdge(props: EdgeProps) {
  const { id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, markerEnd, style, label, data } = props;
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
  } else if (route.routing === "straight") {
    [path, labelX, labelY] = getStraightPath({ sourceX, sourceY, targetX, targetY });
  } else {
    [path, labelX, labelY] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
  }
  const reference = route.semanticType === "context-reference";
  return <>
    <BaseEdge id={id} path={path} markerEnd={markerEnd} style={{ ...style, strokeDasharray: reference ? "5 6" : style?.strokeDasharray, opacity: reference ? 0.58 : style?.opacity }} />
    {label ? <EdgeLabelRenderer><span className="weaver-edge-label" data-reference={reference} style={{ transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)` }}>{String(label)}</span></EdgeLabelRenderer> : null}
  </>;
}
