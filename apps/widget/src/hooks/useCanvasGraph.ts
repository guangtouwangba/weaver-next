import { useCallback, useEffect } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type { Edge, Node } from "@xyflow/react";
import { callTool } from "../mcp-client";
import { toFlowEdge } from "../lib/graph-view";
import { canvasThemeForMode } from "../lib/canvas-theme";
import type { Bootstrap, CardData, GraphEdge, GraphNode, Layout, Project } from "../types";

// Domain B: ReactFlow node/edge derivation, node layout mutations (persistNodeFrame,
// persistNodeResize, togglePinned), and the canvas gesture handlers.
export function useCanvasGraph(params: {
  standaloneDemo: boolean;
  setNodes: Dispatch<SetStateAction<Node[]>>;
  setEdges: Dispatch<SetStateAction<Edge[]>>;
  graphNodes: GraphNode[];
  graphEdges: GraphEdge[];
  assetPreviews: Record<string, string>;
  draggingNodeId: MutableRefObject<string | null>;
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
}) {
  const { standaloneDemo, setNodes, setEdges, graphNodes, graphEdges, assetPreviews, draggingNodeId, selection, setSelection, bootstrap, project, layout, setLayout, layoutRef, projectRef, setStatus, load } = params;

  async function persistNodeFrame(node: Node) {
    const currentLayout = layoutRef.current;
    if (!project || !currentLayout) return;
    if (standaloneDemo) { setLayout((current) => current ? { ...current, nodes: { ...current.nodes, [node.id]: { ...current.nodes[node.id], x: node.position.x, y: node.position.y } } } : current); setStatus(`Moved ${String((node.data as CardData).title ?? node.id)}`); return; }
    try { const next = await callTool<Layout>("weaver_apply_layout_operations", { workspaceDir: bootstrap.workspaceDir, projectId: project.id, viewId: currentLayout.viewId, baseLayoutRevision: currentLayout.layoutRevision, operations: [{ type: "set-node-frame", viewId: currentLayout.viewId, nodeId: node.id, frame: { x: node.position.x, y: node.position.y, width: Number(node.style?.width ?? 280), height: Number(node.style?.height ?? 160) } }] }); layoutRef.current = next; setLayout(next); setStatus(`Manual layout saved · r${next.layoutRevision}`); }
    catch (error) { setStatus(error instanceof Error ? error.message : String(error)); await load(); }
  }

  // Deleting a node (Delete key or the toolbar trash) must be archived in
  // storage, otherwise a reload resurrects it. Persist each deletion revision-
  // checked; the graph.changed SSE event then reconciles everyone. If the local
  // revision is stale, resync once and retry so a delete never silently no-ops.
  async function archiveNodes(nodeIds: string[]) {
    const currentProject = projectRef.current ?? project;
    if (standaloneDemo || !currentProject || !nodeIds.length) return;
    const ids = [...new Set(nodeIds)];
    let archived = 0;
    for (const nodeId of ids) {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const baseGraphRevision = (projectRef.current ?? currentProject).graphRevision;
        try {
          await callTool<{ project: Project }>("weaver_archive_node", { workspaceDir: bootstrap.workspaceDir, projectId: currentProject.id, nodeId, baseGraphRevision });
          archived += 1;
          break;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (attempt === 0 && message.includes("GRAPH_REVISION_CONFLICT")) { await load(); continue; }
          if (message.includes("NODE_NOT_FOUND")) break; // already gone
          setStatus(message); await load(); return;
        }
      }
    }
    if (!archived) return;
    setSelection((current) => current.filter((id) => !ids.includes(id)));
    setStatus(archived === 1 ? "已删除 1 个节点" : `已删除 ${archived} 个节点`);
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

  async function toggleCanvasTheme() {
    const currentLayout = layoutRef.current ?? layout;
    const currentProject = projectRef.current ?? project;
    if (!currentLayout?.theme) return;
    const mode = currentLayout.theme.canvas.mode === "dark" ? "light" : "dark";
    const theme = canvasThemeForMode(currentLayout.theme, mode);
    const optimistic = { ...currentLayout, layoutRevision: currentLayout.layoutRevision + 1, theme };
    layoutRef.current = optimistic;
    setLayout(optimistic);
    if (standaloneDemo || !currentProject) return;
    try {
      const next = await callTool<Layout>("weaver_apply_layout_operations", { workspaceDir: bootstrap.workspaceDir, projectId: currentProject.id, viewId: currentLayout.viewId, baseLayoutRevision: currentLayout.layoutRevision, operations: [{ type: "set-view-theme", viewId: currentLayout.viewId, theme }] });
      layoutRef.current = next; setLayout(next); setStatus(`${mode === "dark" ? "Dark" : "Light"} canvas · r${next.layoutRevision}`);
    } catch (error) { setStatus(error instanceof Error ? error.message : String(error)); await load(); }
  }

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

  const handleSelectionChange = useCallback(({ nodes: selected }: { nodes: Node[] }) => { const next = selected.map((node) => node.id).sort(); setSelection((current) => current.length === next.length && current.every((id, index) => id === next[index]) ? current : next); }, [setSelection]);
  const handleNodeDrag = useCallback((_event: MouseEvent | TouchEvent, dragged: Node) => { setNodes((current) => current.map((node) => node.id === dragged.id ? { ...node, position: { x: dragged.position.x, y: dragged.position.y } } : node)); }, [setNodes]);
  return { persistNodeFrame, persistNodeResize, archiveNodes, togglePinned, toggleCanvasTheme, handleSelectionChange, handleNodeDrag };
}
