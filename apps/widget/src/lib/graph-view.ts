import type { Edge } from "@xyflow/react";
import { resolveEdgeHandles } from "../sync";
import type { GraphEdge, Layout } from "../types";
import { DocumentCard, ImageCard, LinkCard, VisualGroupCard } from "../components/nodes/ContentCards";

export function excerpt(markdown: string) { return markdown.replace(/[#>*_`[\]()!-]/g, " ").replace(/\s+/g, " ").trim().slice(0, 280); }

export function toFlowEdge(item: GraphEdge, layout: Layout): Edge {
  const edgeTheme = layout.theme?.edgeStyles.default;
  return {
    id: item.id, source: item.sourceNodeId, target: item.targetNodeId, label: item.type,
    ...resolveEdgeHandles(layout.nodes[item.sourceNodeId], layout.nodes[item.targetNodeId]),
    type: edgeTheme?.routing === "orthogonal" ? "smoothstep" : "default",
    style: { stroke: edgeTheme?.color, strokeWidth: edgeTheme?.width, strokeDasharray: edgeTheme?.dashed ? "6 5" : undefined },
  };
}

export const nodeTypes = { document: DocumentCard, image: ImageCard, link: LinkCard, visualGroup: VisualGroupCard };
