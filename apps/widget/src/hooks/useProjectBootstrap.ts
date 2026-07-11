import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type { Edge, Node, Viewport } from "@xyflow/react";
import { callTool, connectMcpApp, hostMode, mcp, setCodexLoopback, weaverPreview } from "../mcp-client";
import { shouldPromptForProject } from "../lib/graph-view";
import type { Bootstrap, ChatBindingBootstrap, GraphEdge, GraphNode, Layout, Manifest, Project, ProjectView, ToolResult, VisualTemplate } from "../types";

// Domain A: bootstrap/project/graph load. Owns the project/manifest/layout/graph state and
// the big `load()` reconciliation callback, plus the refs other domains read for stale-closure-safe
// access to the latest project/layout/graph values.
export function useProjectBootstrap(params: {
  standaloneDemo: boolean;
  activeViewId: string;
  setActiveViewId: Dispatch<SetStateAction<string>>;
  setProjectViews: Dispatch<SetStateAction<ProjectView[]>>;
  setNodes: Dispatch<SetStateAction<Node[]>>;
  setEdges: Dispatch<SetStateAction<Edge[]>>;
  setSelection: Dispatch<SetStateAction<string[]>>;
  previewCache: MutableRefObject<Record<string, string>>;
  setAssetPreviews: Dispatch<SetStateAction<Record<string, string>>>;
  setTemplateMode: Dispatch<SetStateAction<"project" | "view">>;
  setTemplateGallery: Dispatch<SetStateAction<boolean>>;
  setTemplates: Dispatch<SetStateAction<VisualTemplate[]>>;
  sessionId: MutableRefObject<string>;
  fitView: (...args: any[]) => any;
  setViewport: (...args: any[]) => any;
}) {
  const { standaloneDemo, activeViewId, setActiveViewId, setProjectViews, setNodes, setEdges, setSelection, previewCache, setAssetPreviews, setTemplateMode, setTemplateGallery, setTemplates, sessionId, fitView, setViewport } = params;
  const query = new URLSearchParams(location.search);
  const initial = (window.openai?.toolOutput ?? {}) as Partial<Bootstrap>;
  const [bootstrap, setBootstrap] = useState<Bootstrap>({ workspaceDir: String(initial.workspaceDir ?? query.get("workspaceDir") ?? ""), projectId: String(initial.projectId ?? query.get("projectId") ?? "") || undefined });
  const [project, setProject] = useState<Project | null>(null);
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [layout, setLayout] = useState<Layout | null>(null);
  const [graphNodes, setGraphNodes] = useState<GraphNode[]>([]);
  const [graphEdges, setGraphEdges] = useState<GraphEdge[]>([]);
  const [projectChoices, setProjectChoices] = useState<Project[] | null>(null);
  const [status, setStatus] = useState("Connecting to Weaver…");
  const [busy, setBusy] = useState(false);
  const projectRef = useRef<Project | null>(null);
  const layoutRef = useRef<Layout | null>(null);
  const graphNodesRef = useRef<GraphNode[]>([]);
  const graphEdgesRef = useRef<GraphEdge[]>([]);
  const bindingRef = useRef<ChatBindingBootstrap | undefined>(bootstrap.chatBinding);
  const pendingInitialFitView = useRef<string | null>(null);
  const pendingViewportRestore = useRef<{ viewId: string; viewport: Viewport } | null>(null);

  const demoImage = useMemo(() => `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="420"><rect width="640" height="420" fill="#d8dbcf"/><circle cx="160" cy="160" r="90" fill="#315cf6"/><path d="M280 310L390 130L520 310Z" fill="#eb775f"/></svg>')}`, []);

  useEffect(() => { projectRef.current = project; }, [project]);
  useEffect(() => { layoutRef.current = layout; }, [layout]);
  useEffect(() => { graphNodesRef.current = graphNodes; }, [graphNodes]);
  useEffect(() => { graphEdgesRef.current = graphEdges; }, [graphEdges]);
  useEffect(() => { bindingRef.current = bootstrap.chatBinding; }, [bootstrap.chatBinding]);

  useEffect(() => {
    const onToolResult = (result: unknown) => {
      const payload = (result as ToolResult<Bootstrap> | undefined)?.structuredContent as (Bootstrap & { previewUrl?: string; previewToken?: string }) | undefined;
      if (payload?.widget === "weaver-workspace" && payload.workspaceDir) {
        // Route this widget's tool calls to the loopback (bypassing Codex's -32000
        // proxy) using the endpoint the tool result carries.
        setCodexLoopback(payload.previewUrl, payload.previewToken);
        setBootstrap(payload);
      }
    };
    if (hostMode === "codex" && !standaloneDemo) {
      // Some Codex builds seed the tool output synchronously; use it if present.
      const seeded = initial as Partial<Bootstrap> & { previewUrl?: string; previewToken?: string };
      setCodexLoopback(seeded.previewUrl, seeded.previewToken);
      mcp.addEventListener("toolresult", onToolResult);
      void connectMcpApp().then(() => {
        setStatus("Codex connected to this canvas");
        return mcp.requestDisplayMode?.({ mode: "fullscreen" });
      }).catch((error) => setStatus(String(error)));
    }
    return () => mcp.removeEventListener("toolresult", onToolResult);
  }, [standaloneDemo]);

  useEffect(() => {
    if (standaloneDemo || bootstrap.workspaceDir) return;
    if (hostMode === "claude" && weaverPreview) {
      void fetch(weaverPreview.bootstrapPath, { headers: { "x-weaver-preview-token": weaverPreview.token } })
        .then((response) => response.json())
        .then((value: { workspaceDir: string; chatBinding?: ChatBindingBootstrap; runtimeMode?: "development" | "installed"; buildId?: string }) =>
          setBootstrap({ workspaceDir: value.workspaceDir, projectId: value.chatBinding?.projectId, chatBinding: value.chatBinding, runtimeMode: value.runtimeMode, widgetBuildId: value.buildId }))
        .catch((error) => setStatus(String(error)));
      return;
    }
    if (hostMode === "dev") {
      void fetch("/api/bootstrap").then((response) => response.json()).then((value: Bootstrap) => setBootstrap(value)).catch((error) => setStatus(String(error)));
    }
  }, [bootstrap.workspaceDir, standaloneDemo]);

  const ensureBindingTarget = useCallback(async (projectId: string, viewId: string) => {
    if (hostMode === "dev" || standaloneDemo) return undefined;
    const current = bindingRef.current;
    if (!current) throw new Error("CODEX_THREAD_CONTEXT_REQUIRED");
    if (current.projectId === projectId && current.viewId === viewId) return current;
    const next = await callTool<ChatBindingBootstrap>("weaver_switch_chat_canvas", { workspaceDir: bootstrap.workspaceDir, leaseId: current.leaseId, bindingRevision: current.bindingRevision, projectId, viewId });
    bindingRef.current = next;
    setBootstrap((value) => ({ ...value, projectId, chatBinding: next }));
    return next;
  }, [bootstrap.workspaceDir, standaloneDemo]);

  const hydratePreviews = useCallback(async (projectId: string, items: GraphNode[]) => {
    const assetIds = [...new Set(items.flatMap((node) => node.assets?.map((asset) => asset.id) ?? []))];
    const missing = assetIds.filter((id) => !previewCache.current[id]);
    if (!missing.length || standaloneDemo) return;
    const entries = await Promise.all(missing.map(async (assetId) => {
      try { const preview = await callTool<{ dataUrl: string }>("weaver_get_asset_preview", { workspaceDir: bootstrap.workspaceDir, projectId, assetId }); return [assetId, preview.dataUrl] as const; }
      catch { return [assetId, ""] as const; }
    }));
    previewCache.current = { ...previewCache.current, ...Object.fromEntries(entries) };
    setAssetPreviews(previewCache.current);
  }, [bootstrap.workspaceDir, previewCache, setAssetPreviews, standaloneDemo]);

  const startFromTemplateGallery = useCallback(async () => {
    setProject(null); setLayout(null); setGraphNodes([]); setGraphEdges([]); setProjectViews([]); setNodes([]); setEdges([]); setProjectChoices(null);
    setTemplateMode("project"); setTemplateGallery(true);
    try { setTemplates(await callTool<VisualTemplate[]>("weaver_list_visual_templates", {})); setStatus("Choose a visual template or start with a blank canvas"); }
    catch (error) { setStatus(error instanceof Error ? error.message : String(error)); }
  }, [setEdges, setNodes, setTemplateGallery, setTemplateMode, setTemplates]);

  const chooseProject = useCallback((projectId: string) => {
    setProjectChoices(null);
    setBootstrap((current) => ({ ...current, projectId }));
  }, [setBootstrap]);

  const load = useCallback(async () => {
    if (standaloneDemo) {
      const timestamp = new Date().toISOString();
      const demoProject: Project = { id: "demo", title: "Research desk · Coffee culture", defaultViewId: "graph-default", graphRevision: 7, viewCatalogRevision: 1, scenePackId: "free-brainstorming", scenePackVersion: "1.0.0" };
      const demoManifest: Manifest = { scenePack: { id: "free-brainstorming", recommendedViews: ["graph", "canvas", "board"], nodeTypes: [{ key: "idea", label: "想法", defaultContentKind: "document", allowedContentKinds: ["document", "image", "link"] }, { key: "evidence", label: "证据", defaultContentKind: "document", allowedContentKinds: ["document", "image", "link"] }] }, views: [{ viewId: "graph-default", viewName: "Concept network", viewType: "graph", layoutRevision: 4 }] };
      const items: GraphNode[] = [
        { id: "article", projectId: "demo", type: "idea", title: "Why cafés became a third place", contentKind: "document", content: { kind: "document", mode: "article", markdown: "# Why cafés became a third place\n\nA working note about ritual, belonging, and urban life.", excerpt: "A working note about ritual, belonging, and urban life.", coverAssetId: "demo-image", embeddedAssetIds: [] }, assets: [{ id: "demo-image", width: 640, height: 420, mimeType: "image/png", thumbnailUri: "" }], properties: {}, archived: false, createdAt: timestamp, updatedAt: timestamp },
        { id: "image", projectId: "demo", type: "evidence", title: "Visual reference", contentKind: "image", content: { kind: "image", assetId: "demo-image", alt: "Abstract reference", caption: "A visual cue for the research" }, assets: [{ id: "demo-image", width: 640, height: 420, mimeType: "image/png", thumbnailUri: "" }], properties: {}, archived: false, createdAt: timestamp, updatedAt: timestamp },
        { id: "link", projectId: "demo", type: "evidence", title: "The social life of coffee", contentKind: "link", content: { kind: "link", url: "https://example.com/coffee", title: "The social life of coffee", description: "A source about cafés, cities, and informal gathering places.", domain: "example.com", enrichmentStatus: "ready" }, properties: {}, archived: false, createdAt: timestamp, updatedAt: timestamp },
      ];
      const demoLayout: Layout = { viewId: "graph-default", viewName: "Concept network", viewType: "graph", graphRevision: 7, layoutRevision: 4, nodes: { article: { nodeId: "article", x: 0, y: 30, width: 280, height: 160, pinned: true }, image: { nodeId: "image", x: 380, y: -80, width: 320, height: 240, pinned: false }, link: { nodeId: "link", x: 770, y: 80, width: 300, height: 180, pinned: false } } };
      previewCache.current = { "demo-image": demoImage }; setAssetPreviews(previewCache.current);
      setProject(demoProject); setManifest(demoManifest); setLayout(demoLayout); setGraphNodes(items); setActiveViewId(demoLayout.viewId);
      setProjectViews([{ id: demoLayout.viewId, projectId: demoProject.id, name: demoLayout.viewName, viewType: demoLayout.viewType, status: "active", pinned: true, pinnedOrder: 0, createdBy: "template", createdAt: timestamp, updatedAt: timestamp, lastOpenedAt: timestamp }]);
      const demoEdges = [{ id: "e1", sourceNodeId: "article", targetNodeId: "image", type: "supported by" }, { id: "e2", sourceNodeId: "image", targetNodeId: "link", type: "source" }];
      setGraphEdges(demoEdges);
      setStatus("Development preview · three content kinds"); return;
    }
    if (!bootstrap.workspaceDir) { setStatus("Open this widget from the Weaver Codex plugin, or provide ?workspaceDir=/path."); return; }
    setBusy(true);
    try {
      const projects = await callTool<Project[]>("weaver_list_projects", { workspaceDir: bootstrap.workspaceDir });
      if (!projects.length) { await startFromTemplateGallery(); return; }
      if (shouldPromptForProject(projects, bootstrap.projectId)) { setProjectChoices(projects); setStatus("Choose a project to open"); return; }
      setProjectChoices(null);
      const active = projects.find((item) => item.id === bootstrap.projectId) ?? projects[0];
      const [nextManifest, nextViews] = await Promise.all([
        callTool<Manifest>("weaver_get_project_manifest", { workspaceDir: bootstrap.workspaceDir, projectId: active.id }),
        callTool<ProjectView[]>("weaver_list_project_views", { workspaceDir: bootstrap.workspaceDir, projectId: active.id }),
      ]);
      const requestedViewId = activeViewId || active.defaultViewId;
      const viewId = nextViews.some((view) => view.id === requestedViewId && view.status === "active") ? requestedViewId : active.defaultViewId;
      await ensureBindingTarget(active.id, viewId);
      const graph = await callTool<{ project: Project; nodes: GraphNode[]; edges: GraphEdge[]; layout: Layout }>("weaver_get_project_graph", { workspaceDir: bootstrap.workspaceDir, projectId: active.id, viewId });
      const alreadyShowingView = projectRef.current?.id === graph.project.id && layoutRef.current?.viewId === graph.layout.viewId;
      if (!alreadyShowingView) { pendingInitialFitView.current = graph.layout.viewId; pendingViewportRestore.current = null; }
      // Never render soft-deleted (archived) nodes/edges — otherwise a deleted
      // node reappears on every reload. (get_project_graph returns them for
      // history; the live canvas only shows active graph content.)
      const liveNodes = graph.nodes.filter((node) => !node.archived);
      const liveNodeIds = new Set(liveNodes.map((node) => node.id));
      const liveEdges = graph.edges.filter((edge) => !(edge as { archived?: boolean }).archived && liveNodeIds.has(edge.sourceNodeId) && liveNodeIds.has(edge.targetNodeId));
      setProject(graph.project); setManifest(nextManifest); setProjectViews(nextViews); setLayout(graph.layout); setGraphNodes(liveNodes); setActiveViewId(graph.layout.viewId);
      setGraphEdges(liveEdges);
      if (!alreadyShowingView) {
        const savedViewState = await callTool<any>("weaver_get_canvas_view_state", { workspaceDir: bootstrap.workspaceDir, canvasSessionId: sessionId.current, viewId: graph.layout.viewId });
        if (!savedViewState.firstOpen) { pendingInitialFitView.current = null; pendingViewportRestore.current = { viewId: graph.layout.viewId, viewport: savedViewState.viewport }; setSelection(savedViewState.selectedNodeIds ?? []); }
      }
      void hydratePreviews(graph.project.id, liveNodes);
      const runtime = bootstrap.runtimeMode === "development" ? ` · Development ${bootstrap.widgetBuildId ?? "unknown"}` : "";
      setStatus(`${liveNodes.length} nodes · graph r${graph.project.graphRevision} · layout r${graph.layout.layoutRevision}${runtime}`);
    } catch (error) { setStatus(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }, [activeViewId, bootstrap.projectId, bootstrap.runtimeMode, bootstrap.widgetBuildId, bootstrap.workspaceDir, demoImage, ensureBindingTarget, fitView, hydratePreviews, setEdges, setViewport, standaloneDemo, startFromTemplateGallery]);

  useEffect(() => { void load(); }, [load]);

  return {
    bootstrap, setBootstrap, project, setProject, manifest, setManifest, layout, setLayout, graphNodes, setGraphNodes, graphEdges, setGraphEdges, status, setStatus, busy, setBusy,
    projectRef, layoutRef, graphNodesRef, graphEdgesRef, bindingRef, pendingInitialFitView, pendingViewportRestore,
    projectChoices, chooseProject, startFromTemplateGallery,
    load, ensureBindingTarget, hydratePreviews,
  };
}
