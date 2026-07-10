import { useCallback, useEffect } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type { Edge, Node, Viewport } from "@xyflow/react";
import { callTool } from "../mcp-client";
import { toFlowEdge } from "../lib/graph-view";
import type { Bootstrap, CardData, GraphEdge, GraphNode, Layout, Project } from "../types";

// Domain B: ReactFlow node/edge derivation, node layout mutations (persistNodeFrame,
// persistNodeResize, togglePinned), and the canvas gesture handlers.
export function useCanvasGraph(params: {
  standaloneDemo: boolean;
  nodes: Node[];
  setNodes: Dispatch<SetStateAction<Node[]>>;
  setEdges: Dispatch<SetStateAction<Edge[]>>;
  graphNodes: GraphNode[];
  graphEdges: GraphEdge[];
  assetPreviews: Record<string, string>;
  draggingNodeId: MutableRefObject<string | null>;
  viewport: MutableRefObject<Viewport>;
  selection: string[];
  setSelection: Dispatch<SetStateAction<string[]>>;
  bootstrap: Bootstrap;
  project: Project | null;
  layout: Layout | null;
  setLayout: Dispatch<SetStateAction<Layout | null>>;
  layoutRef: MutableRefObject<Layout | null>;
  projectRef: MutableRefObject<Project | null>;
  setStatus: Dispatch<SetStateAction<string>>;
  load: () => Promise<void>;
  pendingInitialFitView: MutableRefObject<string | null>;
  pendingViewportRestore: MutableRefObject<{ viewId: string; viewport: Viewport } | null>;
  fitView: (...args: any[]) => any;
  getViewport: () => Viewport;
  setViewport: (viewport: Viewport, options?: { duration?: number }) => any;
}) {
  const { standaloneDemo, nodes, setNodes, setEdges, graphNodes, graphEdges, assetPreviews, draggingNodeId, viewport, selection, setSelection, bootstrap, project, layout, setLayout, layoutRef, projectRef, setStatus, load, pendingInitialFitView, pendingViewportRestore, fitView, getViewport, setViewport } = params;

  async function persistNodeFrame(node: Node) {
    const currentLayout = layoutRef.current;
    if (!project || !currentLayout) return;
    if (standaloneDemo) { setLayout((current) => current ? { ...current, nodes: { ...current.nodes, [node.id]: { ...current.nodes[node.id], x: node.position.x, y: node.position.y } } } : current); setStatus(`Moved ${String((node.data as CardData).title ?? node.id)}`); return; }
    try { const next = await callTool<Layout>("weaver_apply_layout_operations", { workspaceDir: bootstrap.workspaceDir, projectId: project.id, viewId: currentLayout.viewId, baseLayoutRevision: currentLayout.layoutRevision, operations: [{ type: "set-node-frame", viewId: currentLayout.viewId, nodeId: node.id, frame: { x: node.position.x, y: node.position.y, width: Number(node.style?.width ?? 280), height: Number(node.style?.height ?? 160) } }] }); layoutRef.current = next; setLayout(next); setStatus(`Manual layout saved · r${next.layoutRevision}`); }
    catch (error) { setStatus(error instanceof Error ? error.message : String(error)); await load(); }
  }

  async function persistNodeResize(nodeId: string, frame: { x: number; y: number; width: number; height: number }) {
    draggingNodeId.current = null;
    const currentProject = projectRef.current; const currentLayout = layoutRef.current;
    if (!currentProject || !currentLayout) return;
    if (standaloneDemo) {
      const next = { ...currentLayout, layoutRevision: currentLayout.layoutRevision + 1, nodes: { ...currentLayout.nodes, [nodeId]: { ...currentLayout.nodes[nodeId], ...frame } } };
      layoutRef.current = next; setLayout(next); setStatus(`Resized node · ${Math.round(frame.width)}×${Math.round(frame.height)}`); return;
    }
    try {
      const next = await callTool<Layout>("weaver_apply_layout_operations", { workspaceDir: bootstrap.workspaceDir, projectId: currentProject.id, viewId: currentLayout.viewId, baseLayoutRevision: currentLayout.layoutRevision, operations: [{ type: "set-node-frame", viewId: currentLayout.viewId, nodeId, frame }] });
      layoutRef.current = next; setLayout(next); setStatus(`Node size saved · ${Math.round(frame.width)}×${Math.round(frame.height)}`);
    } catch (error) { setStatus(error instanceof Error ? error.message : String(error)); await load(); }
  }

  async function togglePinned() { if (!project || !layout || !selection.length || standaloneDemo) return; const shouldPin = selection.some((id) => !layout.nodes[id]?.pinned); try { const next = await callTool<Layout>("weaver_apply_layout_operations", { workspaceDir: bootstrap.workspaceDir, projectId: project.id, viewId: layout.viewId, baseLayoutRevision: layout.layoutRevision, operations: selection.map((nodeId) => ({ type: shouldPin ? "pin-node" : "unpin-node", viewId: layout.viewId, nodeId })) }); setLayout(next); setStatus(`${shouldPin ? "Pinned" : "Unpinned"} ${selection.length} nodes`); } catch (error) { setStatus(error instanceof Error ? error.message : String(error)); } }

  useEffect(() => {
    if (!layout) return;
    const visualGroups: Node[] = Object.values(layout.groups ?? {}).map((group) => ({ id: `visual-group:${group.groupId}`, type: "visualGroup", position: { x: group.x, y: group.y }, data: { label: group.groupId.split(":").slice(1).join(":"), kind: layout.projection?.kind ?? "group" }, style: { width: group.width, height: group.height, zIndex: -1 }, draggable: false, selectable: false, connectable: false }));
    setNodes([...visualGroups, ...graphNodes.map((item, index) => {
      const frame = layout.nodes[item.id] ?? { x: (index % 4) * 300, y: Math.floor(index / 4) * 190, width: item.contentKind === "link" ? 300 : 280, height: 160, pinned: false };
      const coverId = item.content.kind === "document" ? item.content.coverAssetId : item.content.kind === "image" ? item.content.assetId : item.content.imageAssetId;
      const nodeTheme = layout.theme?.nodeStyles[item.type] ?? layout.theme?.nodeStyles.default;
      const data: CardData = { title: item.title, semanticType: item.type, pinned: frame.pinned, contentKind: item.contentKind, excerpt: item.content.kind === "document" ? item.content.excerpt : undefined, imageSrc: coverId ? assetPreviews[coverId] : undefined, caption: item.content.kind === "image" ? item.content.caption : undefined, domain: item.content.kind === "link" ? item.content.domain : undefined, description: item.content.kind === "link" ? item.content.description : undefined, status: item.content.kind === "link" ? item.content.enrichmentStatus : undefined, onResizeStart: (nodeId) => { draggingNodeId.current = nodeId; setStatus("Resizing node…"); }, onResizeEnd: persistNodeResize };
      return { id: item.id, type: item.contentKind, position: { x: frame.x, y: frame.y }, data, style: { width: frame.width, height: frame.height, "--node-fill": nodeTheme?.fill, "--node-border": nodeTheme?.borderColor, "--node-text": nodeTheme?.textColor, "--node-accent": nodeTheme?.accentColor, "--node-radius": `${nodeTheme?.borderRadius ?? 8}px`, "--node-title-scale": nodeTheme?.titleScale ?? 1 } as React.CSSProperties };
    })]);
  }, [assetPreviews, graphNodes, layout, setNodes]);

  useEffect(() => { if (layout) setEdges(graphEdges.map((item) => toFlowEdge(item, layout))); }, [graphEdges, layout, setEdges]);

  useEffect(() => {
    if (!layout || !nodes.some((node) => !node.id.startsWith("visual-group:"))) return;
    const restore = pendingViewportRestore.current;
    if (restore?.viewId === layout.viewId) {
      let innerFrame = 0;
      const outerFrame = requestAnimationFrame(() => { innerFrame = requestAnimationFrame(() => { if (pendingViewportRestore.current !== restore) return; pendingViewportRestore.current = null; viewport.current = restore.viewport; void setViewport(restore.viewport, { duration: 0 }); }); });
      return () => { cancelAnimationFrame(outerFrame); if (innerFrame) cancelAnimationFrame(innerFrame); };
    }
    if (pendingInitialFitView.current !== layout.viewId) return;
    let innerFrame = 0;
    const outerFrame = requestAnimationFrame(() => { innerFrame = requestAnimationFrame(() => { if (pendingInitialFitView.current !== layout.viewId) return; pendingInitialFitView.current = null; void fitView({ padding: .18, maxZoom: 1.15, duration: 0 }); }); });
    return () => { cancelAnimationFrame(outerFrame); if (innerFrame) cancelAnimationFrame(innerFrame); };
  }, [fitView, layout, nodes, setViewport]);

  const handleSelectionChange = useCallback(({ nodes: selected }: { nodes: Node[] }) => { const next = selected.map((node) => node.id).sort(); setSelection((current) => current.length === next.length && current.every((id, index) => id === next[index]) ? current : next); }, [setSelection]);
  const handleNodeDrag = useCallback((_event: MouseEvent | TouchEvent, dragged: Node) => { setNodes((current) => current.map((node) => node.id === dragged.id ? { ...node, position: { x: dragged.position.x, y: dragged.position.y } } : node)); }, [setNodes]);
  const handleCanvasWheel = useCallback((event: React.WheelEvent<HTMLElement>) => {
    if (!event.metaKey && !event.ctrlKey) return;
    event.preventDefault(); event.stopPropagation();
    const current = getViewport();
    const nextZoom = Math.max(0.05, Math.min(4, current.zoom * Math.exp(-event.deltaY * 0.002)));
    const bounds = event.currentTarget.getBoundingClientRect();
    const pointer = { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
    const flowPoint = { x: (pointer.x - current.x) / current.zoom, y: (pointer.y - current.y) / current.zoom };
    const next = { x: pointer.x - flowPoint.x * nextZoom, y: pointer.y - flowPoint.y * nextZoom, zoom: nextZoom };
    viewport.current = next; void setViewport(next, { duration: 0 });
  }, [getViewport, setViewport, viewport]);

  return { persistNodeFrame, persistNodeResize, togglePinned, handleSelectionChange, handleNodeDrag, handleCanvasWheel };
}
