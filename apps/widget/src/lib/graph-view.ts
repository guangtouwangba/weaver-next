import type { CanvasEdge } from "./canvas-model";
import { resolveEdgeHandles } from "../sync";
import type { GraphEdge, GraphNode, Layout, Project } from "../types";
import { resolveEdgeVisual } from "./edge-style";

export function excerpt(markdown: string) { return markdown.replace(/[#>*_`[\]()!-]/g, " ").replace(/\s+/g, " ").trim().slice(0, 280); }

// True when a Chat has no existing project binding and the workspace has more than one
// Project — ambiguous, so the caller should show a picker instead of silently defaulting
// to the first project in the list.
export function shouldPromptForProject(projects: Project[], boundProjectId?: string): boolean {
  return !boundProjectId && projects.length > 1;
}

export function describeCanvasSelection(nodes: GraphNode[], selection: string[], anchorNodeId?: string): string {
  if (!selection.length) return "Canvas selection: no nodes are currently selected.";
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const label = (nodeId: string) => { const node = byId.get(nodeId); return node ? `"${node.title}" (${nodeId})` : nodeId; };
  const anchor = anchorNodeId && selection.includes(anchorNodeId) ? anchorNodeId : selection[0];
  const references = selection.filter((nodeId) => nodeId !== anchor);
  return `Canvas selection — anchor: ${label(anchor)}${references.length ? `; also referencing: ${references.map(label).join(", ")}` : ""}.`;
}

export function toFlowEdge(item: GraphEdge, layout: Layout): CanvasEdge {
  const edgeTheme = layout.theme?.edgeStyles.default;
  const route = layout.edges?.[item.id];
  const handles = resolveEdgeHandles(layout.nodes[item.sourceNodeId], layout.nodes[item.targetNodeId]);
  const sourceHandle = route?.sourcePort ? `source-${route.sourcePort.replace(/^(source|target)-/, "")}` : handles.sourceHandle;
  const targetHandle = route?.targetPort ? `target-${route.targetPort.replace(/^(source|target)-/, "")}` : handles.targetHandle;
  // Per-edge layout override wins over the relationship type's semantic default.
  const visual = resolveEdgeVisual(item.type, route);
  return {
    id: item.id, source: item.sourceNodeId, target: item.targetNodeId, label: item.type,
    type: "weaver", sourceHandle, targetHandle,
    data: { routing: visual.routing, arrows: visual.arrows, lineStyle: visual.lineStyle, muted: visual.muted, waypoints: route?.waypoints ?? [], semanticType: item.type, sourceHandle, targetHandle },
    style: { stroke: edgeTheme?.color, strokeWidth: edgeTheme?.width },
  };
}
