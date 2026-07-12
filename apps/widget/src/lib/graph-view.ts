import type { Edge } from "@xyflow/react";
import { resolveEdgeHandles } from "../sync";
import type { GraphEdge, GraphNode, Layout, Project } from "../types";
import { DocumentCard, ImageCard, LinkCard, VisualGroupCard } from "../components/nodes/ContentCards";
import { ChartCard } from "../components/nodes/ChartCard";
import { WeaverEdge } from "../components/WeaverEdge";

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

export function toFlowEdge(item: GraphEdge, layout: Layout): Edge {
  const edgeTheme = layout.theme?.edgeStyles.default;
  const route = layout.edges?.[item.id];
  const handles = resolveEdgeHandles(layout.nodes[item.sourceNodeId], layout.nodes[item.targetNodeId]);
  const sourceHandle = route?.sourcePort ? `source-${route.sourcePort.replace(/^(source|target)-/, "")}` : handles.sourceHandle;
  const targetHandle = route?.targetPort ? `target-${route.targetPort.replace(/^(source|target)-/, "")}` : handles.targetHandle;
  return {
    id: item.id, source: item.sourceNodeId, target: item.targetNodeId, label: item.type,
    sourceHandle, targetHandle,
    type: "weaver",
    data: { routing: route?.routing ?? edgeTheme?.routing ?? "bezier", waypoints: route?.waypoints ?? [], semanticType: item.type },
    style: { stroke: edgeTheme?.color, strokeWidth: edgeTheme?.width, strokeDasharray: edgeTheme?.dashed ? "6 5" : undefined },
  };
}

export const nodeTypes = { document: DocumentCard, image: ImageCard, link: LinkCard, chart: ChartCard, visualGroup: VisualGroupCard };
export const edgeTypes = { weaver: WeaverEdge };
