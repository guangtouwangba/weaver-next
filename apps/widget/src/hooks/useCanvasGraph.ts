import { useCallback, useEffect } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type { CanvasEdge as Edge, CanvasNode as Node } from "../lib/canvas-model";
import { callTool } from "../mcp-client";
import { applyLayoutOperations, type LayoutOperation } from "../sync";
import { excerpt, toFlowEdge } from "../lib/graph-view";
import { canvasThemeForMode, normalizeCanvasTheme } from "../lib/canvas-theme";
import type { Bootstrap, CardData, GraphEdge, GraphNode, Layout, Project } from "../types";

// Domain B: renderer-neutral node/edge derivation and node layout mutations (persistNodeFrame,
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
    try { const next = await callTool<Layout>("weaver_canvas_action", { workspaceDir: bootstrap.workspaceDir, action: "layout_operations", projectId: project.id, viewId: currentLayout.viewId, baseLayoutRevision: currentLayout.layoutRevision, operations: [{ type: "set-node-frame", viewId: currentLayout.viewId, nodeId: node.id, frame: { x: node.position.x, y: node.position.y, width: Number(node.style?.width ?? 280), height: Number(node.style?.height ?? 160) } }, { type: "pin-node", viewId: currentLayout.viewId, nodeId: node.id }] }); layoutRef.current = next; setLayout(next); setStatus(`Manual layout saved · r${next.layoutRevision}`); }
    catch (error) { setStatus(error instanceof Error ? error.message : String(error)); await load(); }
  }

  async function persistSelectionFrames(selectedNodes: Node[]) {
    const currentLayout = layoutRef.current ?? layout; const currentProject = projectRef.current ?? project;
    if (!currentLayout || !selectedNodes.length) return;
    const operations: LayoutOperation[] = selectedNodes.flatMap((node) => [
      { type: "set-node-frame", viewId: currentLayout.viewId, nodeId: node.id, frame: { x: node.position.x, y: node.position.y, width: Number(node.style?.width ?? currentLayout.nodes[node.id]?.width ?? 280), height: Number(node.style?.height ?? currentLayout.nodes[node.id]?.height ?? 160) } },
      { type: "pin-node", viewId: currentLayout.viewId, nodeId: node.id },
    ] as LayoutOperation[]);
    if (standaloneDemo || !currentProject) { const next = applyLayoutOperations(currentLayout, currentLayout.layoutRevision + 1, operations); layoutRef.current = next; setLayout(next); return; }
    try { const next = await callTool<Layout>("weaver_canvas_action", { workspaceDir: bootstrap.workspaceDir, action: "layout_operations", projectId: currentProject.id, viewId: currentLayout.viewId, baseLayoutRevision: currentLayout.layoutRevision, operations }); layoutRef.current = next; setLayout(next); setStatus(`Moved ${selectedNodes.length} nodes · r${next.layoutRevision}`); }
    catch (error) { setStatus(error instanceof Error ? error.message : String(error)); await load(); }
  }

  async function linkNodes(sourceNodeId: string, targetNodeId: string, edgeType: string) {
    const currentProject = projectRef.current ?? project;
    if (!currentProject || sourceNodeId === targetNodeId) { setStatus(sourceNodeId === targetNodeId ? "A node cannot connect to itself" : "No active project"); return; }
    if (standaloneDemo) { setStatus(`${edgeType} connection previewed`); return; }
    try { await callTool("weaver_canvas_action", { action: "link_nodes", workspaceDir: bootstrap.workspaceDir, projectId: currentProject.id, sourceNodeId, targetNodeId, edgeType, baseGraphRevision: currentProject.graphRevision }); setStatus(`Created ${edgeType} relation`); await load(); }
    catch (error) { setStatus(error instanceof Error ? error.message : String(error)); await load(); }
  }

  async function duplicateSelection() {
    const currentProject = projectRef.current ?? project; const currentLayout = layoutRef.current ?? layout;
    if (!currentProject || !currentLayout || !selection.length) return;
    if (standaloneDemo) { setStatus(`Duplicated ${selection.length} nodes in preview`); return; }
    let offset = 32;
    try {
      for (const nodeId of selection) {
        const source = graphNodes.find((node) => node.id === nodeId); const frame = currentLayout.nodes[nodeId];
        if (!source || !frame) continue;
        await callTool("weaver_canvas_action", { action: "create_node", workspaceDir: bootstrap.workspaceDir, projectId: currentProject.id, viewId: currentLayout.viewId, semanticType: source.type, title: `${source.title} copy`, content: source.content, x: frame.x + offset, y: frame.y + offset });
        offset += 8;
      }
      setStatus(`Duplicated ${selection.length} nodes`); await load();
    } catch (error) { setStatus(error instanceof Error ? error.message : String(error)); await load(); }
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
          await callTool<{ project: Project }>("weaver_canvas_action", { workspaceDir: bootstrap.workspaceDir, action: "archive_node", projectId: currentProject.id, nodeId, baseGraphRevision });
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
      const next = await callTool<Layout>("weaver_canvas_action", { workspaceDir: bootstrap.workspaceDir, action: "layout_operations", projectId: currentProject.id, viewId: currentLayout.viewId, baseLayoutRevision: currentLayout.layoutRevision, operations: [{ type: "set-node-frame", viewId: currentLayout.viewId, nodeId, frame }] });
      layoutRef.current = next; setLayout(next); setStatus(`Node size saved · ${Math.round(frame.width)}×${Math.round(frame.height)}`);
    } catch (error) { setStatus(error instanceof Error ? error.message : String(error)); await load(); }
  }

  // Manual per-edge visual override (DESIGN.md § Line: semantic default + manual
  // override). Emits a `set-edge-route` layout operation — visual only, never
  // bumps graphRevision. Merges the patch onto any existing override so changing
  // the arrow keeps a previously chosen line style.
  async function persistEdgeRoute(edgeId: string, patch: { lineStyle?: "solid" | "dashed"; arrows?: "none" | "forward" | "both"; routing?: "straight" | "bezier" | "orthogonal" | "bundled" }) {
    const currentLayout = layoutRef.current ?? layout;
    const currentProject = projectRef.current ?? project;
    if (!currentLayout) return;
    const existing = currentLayout.edges?.[edgeId];
    const route: Record<string, unknown> = { edgeId, routing: patch.routing ?? existing?.routing ?? "straight", waypoints: existing?.waypoints ?? [] };
    const lineStyle = patch.lineStyle ?? existing?.lineStyle; if (lineStyle) route.lineStyle = lineStyle;
    const arrows = patch.arrows ?? existing?.arrows; if (arrows) route.arrows = arrows;
    if (existing?.sourcePort) route.sourcePort = existing.sourcePort;
    if (existing?.targetPort) route.targetPort = existing.targetPort;
    const optimistic = { ...currentLayout, edges: { ...(currentLayout.edges ?? {}), [edgeId]: { ...(existing ?? {}), ...route } } } as Layout;
    layoutRef.current = optimistic; setLayout(optimistic);
    if (standaloneDemo || !currentProject) { setStatus("Edge style updated"); return; }
    try {
      const next = await callTool<Layout>("weaver_canvas_action", { workspaceDir: bootstrap.workspaceDir, action: "layout_operations", projectId: currentProject.id, viewId: currentLayout.viewId, baseLayoutRevision: currentLayout.layoutRevision, operations: [{ type: "set-edge-route", viewId: currentLayout.viewId, edgeId, route }] });
      layoutRef.current = next; setLayout(next); setStatus(`Edge style saved · r${next.layoutRevision}`);
    } catch (error) { setStatus(error instanceof Error ? error.message : String(error)); await load(); }
  }

  // In-card document editing (DESIGN.md § Point). The bulk graph read strips
  // Markdown to keep agent context small, so a node lazily fetches its own full
  // Markdown the first time it is edited, and saves it back as a graph mutation
  // (content is authoritative in the Graph, so this correctly bumps graphRevision).
  async function fetchMarkdown(nodeId: string): Promise<string> {
    if (standaloneDemo) { const node = graphNodes.find((item) => item.id === nodeId); return node?.content.kind === "document" ? node.content.markdown ?? "" : ""; }
    const currentProject = projectRef.current ?? project; if (!currentProject) return "";
    try { const res = await callTool<{ node: GraphNode }>("weaver_read_graph", { resource: "node", workspaceDir: bootstrap.workspaceDir, projectId: currentProject.id, nodeId }); const content = res.node.content; return content.kind === "document" ? content.markdown ?? "" : ""; }
    catch (error) { setStatus(error instanceof Error ? error.message : String(error)); return ""; }
  }

  async function saveMarkdown(nodeId: string, markdown: string) {
    const item = graphNodes.find((node) => node.id === nodeId); if (!item || item.content.kind !== "document") return;
    if (standaloneDemo) { setStatus("Saved locally"); return; }
    const currentProject = projectRef.current ?? project; if (!currentProject) return;
    const content = { ...item.content, markdown, excerpt: excerpt(markdown) };
    try {
      await callTool("weaver_canvas_action", { action: "update_node", workspaceDir: bootstrap.workspaceDir, projectId: currentProject.id, nodeId, baseGraphRevision: currentProject.graphRevision, content });
      setStatus("Saved");
      await load();
    } catch (error) { setStatus(error instanceof Error ? error.message : String(error)); await load(); }
  }

  // `@` reference from the in-card editor → a typed "reference" edge in the Graph
  // (idempotent server-side). Edges are Graph content, so this bumps graphRevision.
  async function linkReference(sourceNodeId: string, targetNodeId: string) {
    if (standaloneDemo) { setStatus("Reference added"); return; }
    const currentProject = projectRef.current ?? project; if (!currentProject) return;
    try {
      await callTool("weaver_canvas_action", { action: "link_nodes", workspaceDir: bootstrap.workspaceDir, projectId: currentProject.id, sourceNodeId, targetNodeId, edgeType: "reference", baseGraphRevision: currentProject.graphRevision });
      setStatus("Reference added");
      await load();
    } catch (error) { setStatus(error instanceof Error ? error.message : String(error)); await load(); }
  }

  // Operable groups (面 · DESIGN.md § Plane). All three are layout-only ops, so
  // they never bump graphRevision — grouping is a view arrangement, not a Graph
  // membership change. Optimistic in standalone; server-authoritative otherwise.
  async function persistGroupOps(operations: LayoutOperation[], message: string) {
    const currentLayout = layoutRef.current ?? layout; const currentProject = projectRef.current ?? project;
    if (!currentLayout || !operations.length) return;
    if (standaloneDemo || !currentProject) { const optimistic = applyLayoutOperations(currentLayout, currentLayout.layoutRevision + 1, operations); layoutRef.current = optimistic; setLayout(optimistic); setStatus(message); return; }
    try { const next = await callTool<Layout>("weaver_canvas_action", { workspaceDir: bootstrap.workspaceDir, action: "layout_operations", projectId: currentProject.id, viewId: currentLayout.viewId, baseLayoutRevision: currentLayout.layoutRevision, operations }); layoutRef.current = next; setLayout(next); setStatus(`${message} · r${next.layoutRevision}`); }
    catch (error) { setStatus(error instanceof Error ? error.message : String(error)); await load(); }
  }

  function groupSelection() {
    const currentLayout = layoutRef.current ?? layout; if (!currentLayout || selection.length < 1) return;
    const frames = selection.map((id) => currentLayout.nodes[id]).filter(Boolean);
    if (!frames.length) return;
    const pad = 28;
    const minX = Math.min(...frames.map((frame) => frame.x)) - pad, minY = Math.min(...frames.map((frame) => frame.y)) - pad;
    const maxX = Math.max(...frames.map((frame) => frame.x + frame.width)) + pad, maxY = Math.max(...frames.map((frame) => frame.y + frame.height)) + pad;
    const viewId = currentLayout.viewId;
    const groupId = `group:${crypto.randomUUID().slice(0, 8)}`;
    const operations: LayoutOperation[] = [
      { type: "create-group", viewId, groupId, frame: { x: minX, y: minY, width: maxX - minX, height: maxY - minY }, label: "Group", kind: "interaction" },
      ...selection.map((nodeId) => ({ type: "assign-node-to-group", viewId, nodeId, groupId } as LayoutOperation)),
    ];
    void persistGroupOps(operations, `Grouped ${selection.length} nodes`);
  }

  function renameGroup(groupId: string, label: string) {
    const viewId = (layoutRef.current ?? layout)?.viewId; if (!viewId || !label.trim()) return;
    void persistGroupOps([{ type: "rename-group", viewId, groupId, label: label.trim() }], "Group renamed");
  }

  function dissolveGroup(groupId: string) {
    const viewId = (layoutRef.current ?? layout)?.viewId; if (!viewId) return;
    void persistGroupOps([{ type: "delete-group", viewId, groupId }], "Group dissolved");
  }

  async function togglePinned() { if (!project || !layout || !selection.length || standaloneDemo) return; const shouldPin = selection.some((id) => !layout.nodes[id]?.pinned); try { const next = await callTool<Layout>("weaver_canvas_action", { workspaceDir: bootstrap.workspaceDir, action: "layout_operations", projectId: project.id, viewId: layout.viewId, baseLayoutRevision: layout.layoutRevision, operations: selection.map((nodeId) => ({ type: shouldPin ? "pin-node" : "unpin-node", viewId: layout.viewId, nodeId })) }); setLayout(next); setStatus(`${shouldPin ? "Pinned" : "Unpinned"} ${selection.length} nodes`); } catch (error) { setStatus(error instanceof Error ? error.message : String(error)); } }

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
      const next = await callTool<Layout>("weaver_canvas_action", { workspaceDir: bootstrap.workspaceDir, action: "layout_operations", projectId: currentProject.id, viewId: currentLayout.viewId, baseLayoutRevision: currentLayout.layoutRevision, operations: [{ type: "set-view-theme", viewId: currentLayout.viewId, theme }] });
      layoutRef.current = next; setLayout(next); setStatus(`${mode === "dark" ? "Dark" : "Light"} canvas · r${next.layoutRevision}`);
    } catch (error) { setStatus(error instanceof Error ? error.message : String(error)); await load(); }
  }

  useEffect(() => {
    if (!layout) return;
    // Normalise the stored theme to the design palette (near-monochrome, one blue)
    // for its own mode, so even a board with a legacy warm/green theme renders the
    // redesign without needing a theme toggle first.
    const theme = normalizeCanvasTheme(layout.theme);
    const visualGroups: Node[] = Object.values(layout.groups ?? {}).map((group) => ({ id: `visual-group:${group.groupId}`, type: "visualGroup", position: { x: group.x, y: group.y }, data: { groupId: group.groupId, label: group.label ?? group.groupId.split(":").slice(1).join(":"), kind: group.kind ?? "interaction", onRename: renameGroup, onDissolve: dissolveGroup }, style: { width: group.width, height: group.height, zIndex: -1 }, draggable: false, selectable: false, connectable: false }));
    const references = graphNodes.map((node) => ({ id: node.id, title: node.title }));
    setNodes([...visualGroups, ...graphNodes.map((item, index) => {
      const frame = layout.nodes[item.id] ?? { x: (index % 4) * 300, y: Math.floor(index / 4) * 190, width: item.contentKind === "chart" ? 320 : item.contentKind === "link" ? 300 : 280, height: item.contentKind === "chart" ? 220 : 160, pinned: false };
      const coverId = item.content.kind === "document" ? item.content.coverAssetId : item.content.kind === "image" ? item.content.assetId : item.content.kind === "link" ? item.content.imageAssetId : undefined;
      const nodeTheme = theme?.nodeStyles[item.type] ?? theme?.nodeStyles.default;
      const data: CardData = { title: item.title, semanticType: item.type, pinned: frame.pinned, contentKind: item.contentKind, excerpt: item.content.kind === "document" ? item.content.excerpt : undefined, imageSrc: coverId ? assetPreviews[coverId] : undefined, caption: item.content.kind === "image" ? item.content.caption : undefined, domain: item.content.kind === "link" ? item.content.domain : undefined, description: item.content.kind === "link" ? item.content.description : undefined, status: item.content.kind === "link" ? item.content.enrichmentStatus : undefined, chart: item.content.kind === "chart" ? item.content : undefined, fetchMarkdown, saveMarkdown, references, linkReference, onResizeStart: (nodeId) => { draggingNodeId.current = nodeId; setStatus("Resizing node…"); }, onResizeEnd: persistNodeResize };
      return { id: item.id, type: item.contentKind, position: { x: frame.x, y: frame.y }, data, style: { width: frame.width, height: frame.height, "--node-fill": nodeTheme?.fill, "--node-border": nodeTheme?.borderColor, "--node-text": nodeTheme?.textColor, "--node-accent": nodeTheme?.accentColor, "--node-radius": `${nodeTheme?.borderRadius ?? 8}px`, "--node-title-scale": nodeTheme?.titleScale ?? 1 } as React.CSSProperties };
    })]);
  }, [assetPreviews, graphNodes, layout, setNodes]);

  useEffect(() => { if (layout) { const normalized = { ...layout, theme: normalizeCanvasTheme(layout.theme) }; setEdges(graphEdges.map((item) => toFlowEdge(item, normalized))); } }, [graphEdges, layout, setEdges]);

  const handleSelectionChange = useCallback(({ nodes: selected }: { nodes: Node[] }) => { const next = selected.map((node) => node.id).sort(); setSelection((current) => current.length === next.length && current.every((id, index) => id === next[index]) ? current : next); }, [setSelection]);
  const handleNodeDrag = useCallback((_event: MouseEvent | TouchEvent, dragged: Node) => { setNodes((current) => current.map((node) => node.id === dragged.id ? { ...node, position: { x: dragged.position.x, y: dragged.position.y } } : node)); }, [setNodes]);
  return { persistNodeFrame, persistSelectionFrames, persistNodeResize, persistEdgeRoute, linkNodes, duplicateSelection, groupSelection, persistGroupOps, renameGroup, dissolveGroup, archiveNodes, togglePinned, toggleCanvasTheme, handleSelectionChange, handleNodeDrag };
}
