import { Maximize2 } from "lucide-react";
import type { GraphEdge, GraphNode, Layout, Project } from "../types";
import { useI18n } from "../lib/i18n";

type InlinePreviewNode = { id: string; title: string; x: number; y: number };
type InlinePreviewEdge = { id: string; sourceNodeId: string; targetNodeId: string };

export function buildInlinePreview(nodes: GraphNode[], edges: GraphEdge[], layout: Layout | null): { nodes: InlinePreviewNode[]; edges: InlinePreviewEdge[] } {
  const visible = nodes.filter((node) => layout?.nodes[node.id]?.hidden !== true).slice(0, 12);
  if (!visible.length) return { nodes: [], edges: [] };
  const positioned = visible.map((node, index) => {
    const frame = layout?.nodes[node.id];
    return { node, x: frame ? frame.x + frame.width / 2 : (index % 4) * 260, y: frame ? frame.y + frame.height / 2 : Math.floor(index / 4) * 160 };
  });
  const xs = positioned.map((item) => item.x); const ys = positioned.map((item) => item.y);
  const minX = Math.min(...xs); const maxX = Math.max(...xs); const minY = Math.min(...ys); const maxY = Math.max(...ys);
  const scale = (value: number, min: number, max: number, start: number, end: number) => max === min ? (start + end) / 2 : start + ((value - min) / (max - min)) * (end - start);
  const previewNodes = positioned.map(({ node, x, y }) => ({ id: node.id, title: node.title, x: scale(x, minX, maxX, 90, 710), y: scale(y, minY, maxY, 40, 180) }));
  const visibleIds = new Set(previewNodes.map((node) => node.id));
  const previewEdges = edges.filter((edge) => visibleIds.has(edge.sourceNodeId) && visibleIds.has(edge.targetNodeId)).map(({ id, sourceNodeId, targetNodeId }) => ({ id, sourceNodeId, targetNodeId }));
  return { nodes: previewNodes, edges: previewEdges };
}

export function InlineEntryCard({ project, layout, nodes, edges, selectionCount, streamState, onOpen }: { project: Project | null; layout: Layout | null; nodes: GraphNode[]; edges: GraphEdge[]; selectionCount: number; streamState: string; onOpen: () => void | Promise<void> }) {
  const { t } = useI18n();
  const preview = buildInlinePreview(nodes, edges, layout);
  const byId = new Map(preview.nodes.map((node) => [node.id, node]));
  return <main className="inline-entry" aria-label={t("graphSnapshot")}>
    <header><div className="inline-brand"><span>W</span><div><strong>Weaver</strong><small>{t("currentSpace")}</small></div></div><div className="inline-context"><strong>{project?.title ?? t("emptySpace")}</strong><span>{layout?.viewName ?? "—"}</span><i data-live={streamState === "online" || streamState === "polling"} />{t(streamState === "connecting" ? "connecting" : "live")}</div><button className="inline-open" onClick={() => void onOpen()}><Maximize2 size={15} />{t("openFullscreen")}</button></header>
    <section className="inline-graph"><svg viewBox="0 0 800 220" role="img">{preview.edges.map((edge) => { const source = byId.get(edge.sourceNodeId); const target = byId.get(edge.targetNodeId); return source && target ? <line key={edge.id} data-edge-id={edge.id} x1={source.x} y1={source.y} x2={target.x} y2={target.y} /> : null; })}{preview.nodes.map((node) => <g key={node.id} data-node-id={node.id} transform={`translate(${node.x - 50},${node.y - 22})`}><rect width="100" height="44" rx="8" /><text x="50" y="26" textAnchor="middle">{node.title.slice(0, 9)}</text></g>)}</svg></section>
    <footer><span>{t("selected")} {selectionCount} {t("nodes")}</span><span>G{project?.graphRevision ?? 0} · L{layout?.layoutRevision ?? 0} · C{project?.viewCatalogRevision ?? 0}</span></footer>
  </main>;
}
