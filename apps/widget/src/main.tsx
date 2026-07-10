import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { App as McpApp } from "@modelcontextprotocol/ext-apps";
import {
  Background, BackgroundVariant, Controls, Handle, MiniMap, Position, ReactFlow, ReactFlowProvider,
  NodeResizer, PanOnScrollMode, SelectionMode, useEdgesState, useNodesState, useReactFlow, type Edge, type Node, type NodeProps, type Viewport,
} from "@xyflow/react";
import {
  Bold, Check, Copy, ExternalLink, FileImage, FileText, Heading2, Home, ImagePlus, LayoutTemplate, Library,
  Link2, List, Loader2, Lock, Maximize2, MoreHorizontal, PanelLeftClose, PanelRightClose, Pencil, Pin as PinIcon, Plus, RotateCcw, Search, Sparkles, Trash2, Undo2, Unlock, X,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import "@xyflow/react/dist/style.css";
import "./styles.css";
import { applyGraphDelta, applyLayoutOperations, applyViewCatalogDelta, findTemplateInstances, selectSwitcherViews, type GraphDelta, type LayoutOperation } from "./sync";

declare global { interface Window { openai?: { toolOutput?: Record<string, unknown> }; __weaverRoot?: ReturnType<typeof createRoot> } }

type ToolResult<T> = { structuredContent?: T; isError?: boolean; content?: Array<{ type: string; text?: string }> };
type ChatBindingBootstrap = { leaseId: string; bindingRevision: number; projectId?: string; viewId?: string };
type Bootstrap = { workspaceDir: string; projectId?: string; preferredDisplayMode?: string; chatBinding?: ChatBindingBootstrap };
type Project = { id: string; title: string; defaultViewId: string; graphRevision: number; viewCatalogRevision: number; scenePackId: string; scenePackVersion: string };
type Asset = { id: string; width: number; height: number; mimeType: string; thumbnailUri: string };
type DocumentContent = { kind: "document"; mode: "note" | "article"; markdown?: string; excerpt: string; coverAssetId?: string; embeddedAssetIds: string[] };
type ImageContent = { kind: "image"; assetId: string; alt: string; caption: string };
type LinkContent = { kind: "link"; url: string; title: string; description: string; domain: string; imageAssetId?: string; enrichmentStatus: "pending" | "ready" | "failed" };
type NodeContent = DocumentContent | ImageContent | LinkContent;
type GraphNode = { id: string; projectId: string; type: string; title: string; contentKind: NodeContent["kind"]; content: NodeContent; assets?: Asset[]; properties: Record<string, unknown>; archived: boolean; createdAt: string; updatedAt: string };
type GraphEdge = { id: string; sourceNodeId: string; targetNodeId: string; type: string };
type LayoutNode = { nodeId: string; x: number; y: number; width: number; height: number; pinned: boolean };
type LayoutGroup = { groupId: string; x: number; y: number; width: number; height: number };
type ViewTheme = { canvas: { backgroundColor: string; pattern: "dots" | "grid" | "plain"; patternColor: string }; nodeStyles: Record<string, { fill: string; borderColor: string; textColor: string; accentColor?: string; borderRadius: number; titleScale: number }>; edgeStyles: Record<string, { color: string; width: number; dashed: boolean; routing: string; marker: string }> };
type Layout = { viewId: string; viewName: string; viewType: string; graphRevision: number; layoutRevision: number; templateRef?: { id: string; version: string }; projection?: { kind: string; [key: string]: any }; theme?: ViewTheme; nodes: Record<string, LayoutNode>; groups?: Record<string, LayoutGroup> };
type Candidate = { id: string; label: string; metrics: { score: number; overlapCount: number; edgeCrossings: number; hardViolations: string[] }; document: Layout };
type ViewSummary = { viewId: string; viewName: string; viewType: string; layoutRevision: number; templateRef?: { id: string; version: string } };
type ProjectView = { id: string; projectId: string; name: string; viewType: string; templateRef?: { id: string; version: string }; status: "active" | "trashed"; pinned: boolean; pinnedOrder?: number; createdBy: "user" | "agent" | "template"; createdAt: string; updatedAt: string; lastOpenedAt: string; trashedAt?: string; purgeAfter?: string; nodeCount?: number };
type Manifest = { scenePack: { id?: string; recommendedViews: string[]; recommendedTemplateIds?: string[]; nodeTypes: Array<{ key: string; label: string; defaultContentKind: NodeContent["kind"]; allowedContentKinds: NodeContent["kind"][] }> }; views?: ViewSummary[] };
type VisualFamily = "canvas" | "hierarchy" | "relationship" | "flow" | "temporal" | "board" | "matrix" | "table";
type VisualTemplate = { id: string; version: string; name: string; description: string; family: VisualFamily; renderer: string; defaultScenePackId: string; compatibleScenePackIds: string[]; starterBlueprint: { nodes: Array<{ key: string; role: string; title: string }>; edges: Array<{ sourceKey: string; targetKey: string }> }; theme: ViewTheme; projection: { kind: string }; layoutPreset: { strategy: string } };
type TemplateValidation = { compatible: boolean; ready: boolean; matchedNodeCount: number; unmatchedNodeCount: number; missingRequiredFields: Array<{ nodeId?: string; nodeType: string; propertyKey: string }>; warnings: string[] };
type CardData = { title: string; semanticType: string; pinned: boolean; contentKind: NodeContent["kind"]; excerpt?: string; imageSrc?: string; caption?: string; domain?: string; description?: string; status?: string; onResizeStart?: (nodeId: string) => void; onResizeEnd?: (nodeId: string, frame: { x: number; y: number; width: number; height: number }) => void };
type EditorDraft = { title: string; semanticType: string; markdown: string; excerpt: string; coverAssetId?: string; embeddedAssetIds: string[] };
type TaskIntent = "develop_selection" | "layout_view" | "develop_then_layout";
type AgentTask = { taskId: string; canvasSessionId: string; projectId: string; taskRevision: number; intent: TaskIntent; activeStage: "content" | "layout"; status: string; results: { changeSetId?: string; layoutRunId?: string }; expectedGraphRevision: number; baseLayoutRevision?: number; userInstruction?: string; dispatches: Array<{ dispatchKey: string; stage: "content" | "layout"; state: string }>; error?: { code: string; message: string } };
type ChangeSetPreview = { changeSet: { id: string; rationale: string; riskLevel: string; graphOperations: unknown[]; layoutOperations: unknown[] }; stale: boolean; currentGraphRevision: number; summary: { addedNodes: number; updatedNodes: number; archivedNodes: number; addedEdges: number; updatedEdges: number; archivedEdges: number; layoutOperations: number } };
type ProjectEvent = { sequence: number; kind: "task.updated" | "graph.changed" | "layout.changed" | "view.created" | "view.catalog.changed" | "chat.binding.changed" | "stream.reset"; payload: any; graphRevision?: number; layoutRevision?: number; viewId?: string };

const mcp = new McpApp({ name: "weaver-next-widget", version: "0.1.0" }, { availableDisplayModes: ["inline", "fullscreen"] }, { autoResize: true });
const isLocalDevelopment = ["localhost", "127.0.0.1"].includes(location.hostname);

async function callTool<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const result = isLocalDevelopment
    ? await fetch("/api/mcp", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, arguments: args }) }).then(async (response) => {
      const value = await response.json() as ToolResult<T>;
      if (!response.ok && !value.isError) throw new Error(`Local MCP proxy failed: ${response.status}`);
      return value;
    })
    : await mcp.callServerTool({ name, arguments: args }) as ToolResult<T>;
  if (result.isError) throw new Error(result.content?.find((item) => item.type === "text")?.text ?? `${name} failed`);
  const value = result.structuredContent as any;
  return (value && Object.keys(value).length === 1 && Array.isArray(value.items) ? value.items : value) as T;
}

function excerpt(markdown: string) { return markdown.replace(/[#>*_`\[\]()!-]/g, " ").replace(/\s+/g, " ").trim().slice(0, 280); }

function NodeShell({ children, data, className, id, selected }: { children: React.ReactNode; data: CardData; className: string; id: string; selected: boolean }) {
  const minimum = data.contentKind === "image" ? { width: 160, height: 140 } : data.contentKind === "link" ? { width: 220, height: 120 } : { width: 180, height: 100 };
  return <>
    <NodeResizer isVisible={selected} minWidth={minimum.width} minHeight={minimum.height} maxWidth={900} maxHeight={700} color="#315cf6" onResizeStart={() => data.onResizeStart?.(id)} onResizeEnd={(_event, frame) => data.onResizeEnd?.(id, frame)} />
    <article className={`content-card ${className}`} data-pinned={data.pinned}>
      <Handle type="target" position={Position.Left} />{children}<div className="card-open-hint"><Maximize2 size={10} /> double-click</div><Handle type="source" position={Position.Right} />
    </article>
  </>;
}

function DocumentCard({ data, id, selected }: NodeProps<Node<CardData>>) {
  return <NodeShell data={data} className="document-card" id={id} selected={selected}>
    {data.imageSrc ? <img className="document-cover" src={data.imageSrc} alt="" /> : null}
    <div className="card-kicker"><FileText size={11} /> {data.semanticType}</div>
    <strong>{data.title || "Untitled article"}</strong>
    <p>{data.excerpt || "Open to begin writing."}</p>
    <div className="card-foot">{data.pinned ? <><Lock size={11} /> fixed</> : "document"}</div>
  </NodeShell>;
}

function ImageCard({ data, id, selected }: NodeProps<Node<CardData>>) {
  return <NodeShell data={data} className="image-card" id={id} selected={selected}>
    <div className="image-stage">{data.imageSrc ? <img src={data.imageSrc} alt={data.caption || data.title} /> : <FileImage size={30} />}</div>
    <div className="image-caption"><span>{data.semanticType}</span><strong>{data.caption || data.title || "Untitled image"}</strong></div>
  </NodeShell>;
}

function LinkCard({ data, id, selected }: NodeProps<Node<CardData>>) {
  return <NodeShell data={data} className="link-card" id={id} selected={selected}>
    {data.imageSrc ? <img className="link-cover" src={data.imageSrc} alt="" /> : <div className="link-mark"><ExternalLink size={22} /></div>}
    <div className="link-copy"><span>{data.domain || data.status || "LINK"}</span><strong>{data.title || "Untitled link"}</strong><p>{data.description || "Preview details will appear here."}</p></div>
  </NodeShell>;
}

function VisualGroupCard({ data }: NodeProps<Node<{ label: string; kind: string }>>) { return <section className="visual-group-card" data-kind={data.kind}><strong>{data.label}</strong></section>; }

const nodeTypes = { document: DocumentCard, image: ImageCard, link: LinkCard, visualGroup: VisualGroupCard };

function WeaverWidget() {
  const query = new URLSearchParams(location.search);
  const standaloneDemo = query.get("demo") === "1";
  const initial = (window.openai?.toolOutput ?? {}) as Partial<Bootstrap>;
  const [bootstrap, setBootstrap] = useState<Bootstrap>({ workspaceDir: String(initial.workspaceDir ?? query.get("workspaceDir") ?? ""), projectId: String(initial.projectId ?? query.get("projectId") ?? "") || undefined });
  const [project, setProject] = useState<Project | null>(null);
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [layout, setLayout] = useState<Layout | null>(null);
  const [graphNodes, setGraphNodes] = useState<GraphNode[]>([]);
  const [graphEdges, setGraphEdges] = useState<GraphEdge[]>([]);
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [assetPreviews, setAssetPreviews] = useState<Record<string, string>>({});
  const previewCache = useRef<Record<string, string>>({});
  const [selection, setSelection] = useState<string[]>([]);
  const [status, setStatus] = useState("Connecting to Weaver…");
  const [streamState, setStreamState] = useState<"connecting" | "online" | "offline">("connecting");
  const [streamGeneration, setStreamGeneration] = useState(0);
  const [busy, setBusy] = useState(false);
  const [layoutRunId, setLayoutRunId] = useState<string | null>(null);
  const [activeTask, setActiveTask] = useState<AgentTask | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [changePreview, setChangePreview] = useState<ChangeSetPreview | null>(null);
  const [staleTask, setStaleTask] = useState<AgentTask | null>(null);
  const [candidateIndex, setCandidateIndex] = useState(0);
  const [activeViewId, setActiveViewId] = useState("");
  const [projectViews, setProjectViews] = useState<ProjectView[]>([]);
  const [viewLibrary, setViewLibrary] = useState(false);
  const [viewQuery, setViewQuery] = useState("");
  const [viewMenuId, setViewMenuId] = useState<string | null>(null);
  const [renamingViewId, setRenamingViewId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [purgeConfirmId, setPurgeConfirmId] = useState<string | null>(null);
  const [draggedViewId, setDraggedViewId] = useState<string | null>(null);
  const [viewToast, setViewToast] = useState<{ message: string; undoViewId?: string } | null>(null);
  const [createMenu, setCreateMenu] = useState(false);
  const [linkComposer, setLinkComposer] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [activeDocument, setActiveDocument] = useState<GraphNode | null>(null);
  const [activeViewer, setActiveViewer] = useState<GraphNode | null>(null);
  const [templateGallery, setTemplateGallery] = useState(false);
  const [templateMode, setTemplateMode] = useState<"project" | "view">("view");
  const [templates, setTemplates] = useState<VisualTemplate[]>([]);
  const [templateFamily, setTemplateFamily] = useState<VisualFamily | "all">("all");
  const [templateSearch, setTemplateSearch] = useState("");
  const [selectedTemplate, setSelectedTemplate] = useState<VisualTemplate | null>(null);
  const [templateValidation, setTemplateValidation] = useState<TemplateValidation | null>(null);
  const [templatePreview, setTemplatePreview] = useState<Layout | null>(null);
  const [templateTitle, setTemplateTitle] = useState("New Weaver space");
  const [templateGoal, setTemplateGoal] = useState("");
  const [templateScenePackId, setTemplateScenePackId] = useState("free-brainstorming");
  const [templateViewName, setTemplateViewName] = useState("");
  const [duplicateViewConfirmed, setDuplicateViewConfirmed] = useState(false);
  const [draft, setDraft] = useState<EditorDraft | null>(null);
  const [editorMode, setEditorMode] = useState<"write" | "preview">("write");
  const [saveState, setSaveState] = useState<"saved" | "dirty" | "saving" | "conflict">("saved");
  const fileInput = useRef<HTMLInputElement>(null);
  const imageAction = useRef<"node" | "cover" | "embedded">("node");
  const editorTextArea = useRef<HTMLTextAreaElement>(null);
  const sessionId = useRef(crypto.randomUUID());
  const bindingRef = useRef<ChatBindingBootstrap | undefined>(bootstrap.chatBinding);
  const sequence = useRef(0);
  const syncTimer = useRef<number | null>(null);
  const stream = useRef<EventSource | null>(null);
  const lastEventSequence = useRef(0);
  const draggingNodeId = useRef<string | null>(null);
  const projectRef = useRef<Project | null>(null);
  const layoutRef = useRef<Layout | null>(null);
  const graphNodesRef = useRef<GraphNode[]>([]);
  const graphEdgesRef = useRef<GraphEdge[]>([]);
  const projectViewsRef = useRef<ProjectView[]>([]);
  const saveStateRef = useRef(saveState);
  const activeDocumentRef = useRef<GraphNode | null>(null);
  const viewport = useRef<Viewport>({ x: 0, y: 0, zoom: 1 });
  const { fitView, getViewport, screenToFlowPosition, setViewport } = useReactFlow();

  const demoImage = useMemo(() => `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="420"><rect width="640" height="420" fill="#d8dbcf"/><circle cx="160" cy="160" r="90" fill="#315cf6"/><path d="M280 310L390 130L520 310Z" fill="#eb775f"/></svg>')}`, []);

  useEffect(() => { projectRef.current = project; }, [project]);
  useEffect(() => { layoutRef.current = layout; }, [layout]);
  useEffect(() => { graphNodesRef.current = graphNodes; }, [graphNodes]);
  useEffect(() => { graphEdgesRef.current = graphEdges; }, [graphEdges]);
  useEffect(() => { projectViewsRef.current = projectViews; }, [projectViews]);
  useEffect(() => { saveStateRef.current = saveState; }, [saveState]);
  useEffect(() => { activeDocumentRef.current = activeDocument; }, [activeDocument]);
  useEffect(() => { bindingRef.current = bootstrap.chatBinding; }, [bootstrap.chatBinding]);

  useEffect(() => {
    const onToolResult = (event: Event) => { const payload = ((event as CustomEvent).detail as ToolResult<Bootstrap> | undefined)?.structuredContent; if (payload?.workspaceDir) setBootstrap(payload); };
    if (!standaloneDemo && !isLocalDevelopment) {
      mcp.addEventListener("toolresult", onToolResult);
      void mcp.connect().then(() => {
        setStatus("Codex connected to this canvas");
        return mcp.requestDisplayMode?.({ mode: "fullscreen" });
      }).catch((error) => setStatus(String(error)));
    }
    return () => mcp.removeEventListener("toolresult", onToolResult);
  }, [standaloneDemo]);

  useEffect(() => {
    if (!isLocalDevelopment || standaloneDemo || bootstrap.workspaceDir) return;
    void fetch("/api/bootstrap").then((response) => response.json()).then((value: Bootstrap) => setBootstrap(value)).catch((error) => setStatus(String(error)));
  }, [bootstrap.workspaceDir, standaloneDemo]);

  const ensureBindingTarget = useCallback(async (projectId: string, viewId: string) => {
    if (isLocalDevelopment || standaloneDemo) return undefined;
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
  }, [bootstrap.workspaceDir, standaloneDemo]);

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
      setGraphEdges(demoEdges); setEdges(demoEdges.map((item) => ({ id: item.id, source: item.sourceNodeId, target: item.targetNodeId, label: item.type, type: "smoothstep" })));
      setStatus("Development preview · three content kinds"); return;
    }
    if (!bootstrap.workspaceDir) { setStatus("Open this widget from the Weaver Codex plugin, or provide ?workspaceDir=/path."); return; }
    setBusy(true);
    try {
      const projects = await callTool<Project[]>("weaver_list_projects", { workspaceDir: bootstrap.workspaceDir });
      if (!projects.length) { setProject(null); setLayout(null); setGraphNodes([]); setGraphEdges([]); setProjectViews([]); setNodes([]); setEdges([]); setTemplateMode("project"); setTemplateGallery(true); setTemplates(await callTool<VisualTemplate[]>("weaver_list_visual_templates", {})); setStatus("Choose a visual template or start with a blank canvas"); return; }
      const active = projects.find((item) => item.id === bootstrap.projectId) ?? projects[0];
      const [nextManifest, nextViews] = await Promise.all([
        callTool<Manifest>("weaver_get_project_manifest", { workspaceDir: bootstrap.workspaceDir, projectId: active.id }),
        callTool<ProjectView[]>("weaver_list_project_views", { workspaceDir: bootstrap.workspaceDir, projectId: active.id }),
      ]);
      const requestedViewId = activeViewId || active.defaultViewId;
      const viewId = nextViews.some((view) => view.id === requestedViewId && view.status === "active") ? requestedViewId : active.defaultViewId;
      await ensureBindingTarget(active.id, viewId);
      const graph = await callTool<{ project: Project; nodes: GraphNode[]; edges: GraphEdge[]; layout: Layout }>("weaver_get_project_graph", { workspaceDir: bootstrap.workspaceDir, projectId: active.id, viewId });
      setProject(graph.project); setManifest(nextManifest); setProjectViews(nextViews); setLayout(graph.layout); setGraphNodes(graph.nodes); setActiveViewId(graph.layout.viewId);
      const edgeTheme = graph.layout.theme?.edgeStyles.default;
      setGraphEdges(graph.edges); setEdges(graph.edges.map((item) => ({ id: item.id, source: item.sourceNodeId, target: item.targetNodeId, label: item.type, type: edgeTheme?.routing === "orthogonal" ? "smoothstep" : "default", style: { stroke: edgeTheme?.color, strokeWidth: edgeTheme?.width, strokeDasharray: edgeTheme?.dashed ? "6 5" : undefined } })));
      const savedViewState = await callTool<any>("weaver_get_canvas_view_state", { workspaceDir: bootstrap.workspaceDir, canvasSessionId: sessionId.current, viewId: graph.layout.viewId });
      if (!savedViewState.firstOpen) { viewport.current = savedViewState.viewport; setSelection(savedViewState.selectedNodeIds ?? []); requestAnimationFrame(() => void setViewport(savedViewState.viewport, { duration: 0 })); }
      else requestAnimationFrame(() => requestAnimationFrame(() => void fitView({ padding: .18, maxZoom: 1.15, duration: 0 })));
      void hydratePreviews(graph.project.id, graph.nodes);
      setStatus(`${graph.nodes.length} nodes · graph r${graph.project.graphRevision} · layout r${graph.layout.layoutRevision}`);
    } catch (error) { setStatus(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }, [activeViewId, bootstrap.projectId, bootstrap.workspaceDir, demoImage, ensureBindingTarget, fitView, hydratePreviews, setEdges, setViewport, standaloneDemo]);

  useEffect(() => { void load(); }, [load]);

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

  const syncContext = useCallback(async () => {
    if (standaloneDemo || !project || !layout || !bootstrap.workspaceDir) return;
    sequence.current += 1;
    const timestamp = new Date().toISOString();
    const chatBinding = bindingRef.current;
    try { await callTool("weaver_sync_canvas_context", { workspaceDir: bootstrap.workspaceDir, snapshot: { version: 2, canvasSessionId: sessionId.current, workspaceDir: bootstrap.workspaceDir, projectId: project.id, scenePackId: project.scenePackId, scenePackVersion: project.scenePackVersion, graphRevision: project.graphRevision, viewId: layout.viewId, viewType: layout.viewType, focusedNodeId: selection.length === 1 ? selection[0] : undefined, selectedNodeIds: selection, selectedEdgeIds: [], selectedGroupIds: [], pinnedContextNodeIds: nodes.filter((node) => Boolean((node.data as CardData).pinned)).map((node) => node.id), viewport: viewport.current, presence: { visible: !document.hidden, focused: document.hasFocus(), lastSeenAt: timestamp }, chatBinding: !isLocalDevelopment ? chatBinding && { leaseId: chatBinding.leaseId, bindingRevision: chatBinding.bindingRevision } : undefined, agentEligible: !isLocalDevelopment && Boolean(chatBinding), sequence: sequence.current, updatedAt: timestamp } }); }
    catch (error) {
      if (error instanceof Error && error.message.includes("STALE_CANVAS_SEQUENCE")) return;
      if (error instanceof Error && error.message.includes("CHAT_CANVAS_LEASE_STALE")) { setStatus("Detached. This Chat is now attached to another Canvas"); stream.current?.close(); }
      throw error;
    }
  }, [bootstrap.workspaceDir, layout, nodes, project, selection, standaloneDemo]);

  useEffect(() => { if (syncTimer.current) window.clearTimeout(syncTimer.current); syncTimer.current = window.setTimeout(() => void syncContext(), 250); return () => { if (syncTimer.current) window.clearTimeout(syncTimer.current); }; }, [syncContext]);

  useEffect(() => {
    if (standaloneDemo || !project || !layout) return;
    const heartbeat = window.setInterval(() => void syncContext(), 5_000);
    const syncPresence = () => void syncContext();
    window.addEventListener("focus", syncPresence); window.addEventListener("blur", syncPresence); document.addEventListener("visibilitychange", syncPresence);
    return () => { window.clearInterval(heartbeat); window.removeEventListener("focus", syncPresence); window.removeEventListener("blur", syncPresence); document.removeEventListener("visibilitychange", syncPresence); };
  }, [layout?.viewId, project?.id, standaloneDemo, syncContext]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === "v" && project) { event.preventDefault(); setViewLibrary(true); requestAnimationFrame(() => document.querySelector<HTMLInputElement>("#view-library-search")?.focus()); }
      if (event.key === "Escape") { setViewLibrary(false); setViewMenuId(null); }
    };
    window.addEventListener("keydown", onKeyDown); return () => window.removeEventListener("keydown", onKeyDown);
  }, [project]);

  useEffect(() => { if (!viewToast) return; const timer = window.setTimeout(() => setViewToast(null), 6_000); return () => window.clearTimeout(timer); }, [viewToast]);

  async function handleTaskUpdate(task: AgentTask) {
    setActiveTask(task);
    setStatus(`Agent task · ${task.status.replaceAll("_", " ")}`);
    const changeSetId = task.results?.changeSetId;
    if (task.status === "pending_review" && task.activeStage === "content" && changeSetId) {
      try { setChangePreview(await callTool<ChangeSetPreview>("weaver_preview_changeset", { workspaceDir: bootstrap.workspaceDir, changeSetId })); }
      catch (error) { setStatus(error instanceof Error ? error.message : String(error)); }
    }
    const nextLayoutRunId = task.results?.layoutRunId;
    if (task.status === "pending_review" && task.activeStage === "layout" && nextLayoutRunId && nextLayoutRunId !== layoutRunId) {
      try { const run = await callTool<any>("weaver_get_layout_run", { workspaceDir: bootstrap.workspaceDir, layoutRunId: nextLayoutRunId }); setLayoutRunId(run.id); setCandidates(run.candidates); setCandidateIndex(0); }
      catch (error) { setStatus(error instanceof Error ? error.message : String(error)); }
    }
    if (task.status === "ready_to_continue" && task.intent === "develop_then_layout") setStatus("Content applied · tell Codex to continue with layout");
    if (task.status === "stale") { setStaleTask(task); setChangePreview((current) => current ? { ...current, stale: true } : current); }
    else if (["prepared", "dispatched", "running"].includes(task.status)) setStaleTask(null);
    if (["completed", "failed", "cancelled", "stale"].includes(task.status)) setActiveTask(null);
  }

  function handleGraphChanged(delta: GraphDelta<GraphNode, GraphEdge>) {
    const currentProject = projectRef.current;
    if (!currentProject) return;
    if (delta.toRevision <= currentProject.graphRevision) return;
    if (delta.fromRevision !== currentProject.graphRevision) { setStatus("Graph event gap detected · refreshing once"); void load(); return; }
    const protectedIds = new Set<string>();
    const editing = activeDocumentRef.current;
    if (editing && ["dirty", "saving", "conflict"].includes(saveStateRef.current)) {
      if (delta.updatedNodes.some((node) => node.id === editing.id) || delta.archivedNodeIds.includes(editing.id)) {
        protectedIds.add(editing.id); setSaveState("conflict");
      }
    }
    if (draggingNodeId.current) protectedIds.add(draggingNodeId.current);
    const next = applyGraphDelta(graphNodesRef.current, graphEdgesRef.current, delta, protectedIds);
    graphNodesRef.current = next.nodes; graphEdgesRef.current = next.edges;
    setGraphNodes(next.nodes); setGraphEdges(next.edges);
    const edgeTheme = layoutRef.current?.theme?.edgeStyles.default;
    setEdges(next.edges.map((item) => ({ id: item.id, source: item.sourceNodeId, target: item.targetNodeId, label: item.type, type: edgeTheme?.routing === "orthogonal" ? "smoothstep" : "default", style: { stroke: edgeTheme?.color, strokeWidth: edgeTheme?.width, strokeDasharray: edgeTheme?.dashed ? "6 5" : undefined } })));
    const nextProject = { ...currentProject, graphRevision: delta.toRevision }; projectRef.current = nextProject; setProject(nextProject);
    void hydratePreviews(currentProject.id, [...delta.addedNodes, ...delta.updatedNodes]);
  }

  function handleLayoutChanged(payload: { viewId: string; fromRevision: number; toRevision: number; operations: LayoutOperation[]; document?: Layout }) {
    const current = layoutRef.current;
    if (!current || payload.viewId !== current.viewId || payload.toRevision <= current.layoutRevision) return;
    if (payload.fromRevision !== current.layoutRevision) { setStatus("Layout event gap detected · refreshing once"); void load(); return; }
    const protectedNodeId = draggingNodeId.current;
    const operations = protectedNodeId ? (payload.operations ?? []).filter((operation) => !("nodeId" in operation) || operation.nodeId !== protectedNodeId) : (payload.operations ?? []);
    if (protectedNodeId && operations.length !== (payload.operations ?? []).length) setStatus("Remote layout arrived while dragging · kept your local position");
    const next = payload.document && !protectedNodeId ? payload.document : applyLayoutOperations(current, payload.toRevision, operations);
    layoutRef.current = next; setLayout(next);
  }

  function handleProjectEvent(event: ProjectEvent) {
    if (event.sequence <= lastEventSequence.current) return;
    lastEventSequence.current = event.sequence;
    if (event.kind === "task.updated") void handleTaskUpdate(event.payload as AgentTask);
    else if (event.kind === "graph.changed") handleGraphChanged(event.payload);
    else if (event.kind === "layout.changed") handleLayoutChanged(event.payload);
    else if (event.kind === "view.catalog.changed") {
      const currentProject = projectRef.current; if (!currentProject) return;
      if (Number(event.payload?.toRevision) <= currentProject.viewCatalogRevision) return;
      try {
        const next = applyViewCatalogDelta({ revision: currentProject.viewCatalogRevision, views: projectViewsRef.current, defaultViewId: currentProject.defaultViewId }, event.payload);
        projectViewsRef.current = next.views; setProjectViews(next.views);
        const nextProject = { ...currentProject, viewCatalogRevision: next.revision, defaultViewId: next.defaultViewId }; projectRef.current = nextProject; setProject(nextProject);
        const currentView = next.views.find((view) => view.id === layoutRef.current?.viewId);
        if (currentView?.status === "trashed" || !currentView) { const fallback = next.views.find((view) => view.id === next.defaultViewId && view.status === "active") ?? next.views.find((view) => view.status === "active"); if (fallback) { setActiveViewId(fallback.id); setViewToast({ message: "The current View was moved to Recycle Bin" }); } }
      } catch { setStatus("View catalog event gap detected · refreshing once"); void load(); }
    }
    else if (event.kind === "view.created") void (async () => { if (!projectRef.current) return; const next = await callTool<Manifest>("weaver_get_project_manifest", { workspaceDir: bootstrap.workspaceDir, projectId: projectRef.current.id }); setManifest(next); })();
    else if (event.kind === "chat.binding.changed" && event.payload?.status === "detached" && Number(event.payload.bindingRevision) > Number(bindingRef.current?.bindingRevision ?? 0)) {
      if (event.payload.reason === "VIEW_TRASHED" && bindingRef.current && event.payload.fallbackViewId) {
        const nextBinding = { ...bindingRef.current, bindingRevision: Number(event.payload.bindingRevision), viewId: String(event.payload.fallbackViewId) };
        bindingRef.current = nextBinding; setBootstrap((current) => ({ ...current, chatBinding: nextBinding })); setActiveViewId(nextBinding.viewId!); setViewToast({ message: "The current View was moved to Recycle Bin" });
      } else { stream.current?.close(); setStreamState("offline"); setStatus("Detached. This Chat is now attached to another Canvas"); }
    }
    else if (event.kind === "stream.reset") void load();
  }

  useEffect(() => {
    if (standaloneDemo || !project?.id || !layout?.viewId || !bootstrap.workspaceDir) return;
    let disposed = false;
    setStreamState("connecting");
    void (async () => {
      try {
        await syncContext();
        const grant = await callTool<{ eventStreamUrl: string; currentSequence: number }>("weaver_open_canvas_event_stream", { workspaceDir: bootstrap.workspaceDir, projectId: project.id, canvasSessionId: sessionId.current });
        await load();
        const recoverableTasks = await callTool<AgentTask[]>("weaver_list_canvas_tasks", { workspaceDir: bootstrap.workspaceDir, canvasSessionId: sessionId.current });
        for (const task of recoverableTasks.reverse()) await handleTaskUpdate(task);
        if (disposed) return;
        lastEventSequence.current = Math.max(lastEventSequence.current, grant.currentSequence);
        const source = new EventSource(grant.eventStreamUrl); stream.current?.close(); stream.current = source;
        source.onopen = () => { setStreamState("online"); setStatus((current) => current.includes("Agent task") ? current : "Live sync connected"); };
        source.onerror = () => { setStreamState("offline"); setStatus("Live sync disconnected · reconnecting…"); };
        for (const kind of ["task.updated", "graph.changed", "layout.changed", "view.created", "view.catalog.changed", "chat.binding.changed", "stream.reset"] as const) source.addEventListener(kind, (message) => {
          try { handleProjectEvent(JSON.parse((message as MessageEvent).data) as ProjectEvent); }
          catch (error) { setStatus(`Invalid live event · ${error instanceof Error ? error.message : String(error)}`); }
        });
      } catch (error) { if (!disposed) { setStreamState("offline"); setStatus(error instanceof Error ? error.message : String(error)); } }
    })();
    return () => { disposed = true; stream.current?.close(); stream.current = null; };
  }, [bootstrap.workspaceDir, project?.id, layout?.viewId, standaloneDemo, streamGeneration]);

  async function cancelActiveTask() { if (!activeTask) return; try { await callTool("weaver_cancel_agent_task", { workspaceDir: bootstrap.workspaceDir, taskId: activeTask.taskId }); setStatus("Agent task cancelled · later writes will be rejected"); } catch (error) { setStatus(error instanceof Error ? error.message : String(error)); } }

  async function applyChangeSet() { if (!changePreview) return; setBusy(true); try { await callTool("weaver_apply_changeset", { workspaceDir: bootstrap.workspaceDir, changeSetId: changePreview.changeSet.id }); setChangePreview(null); } catch (error) { setStatus(error instanceof Error ? error.message : String(error)); } finally { setBusy(false); } }
  async function rejectChangeSet() { if (!changePreview) return; setBusy(true); try { await callTool("weaver_reject_changeset", { workspaceDir: bootstrap.workspaceDir, changeSetId: changePreview.changeSet.id }); setChangePreview(null); } catch (error) { setStatus(error instanceof Error ? error.message : String(error)); } finally { setBusy(false); } }
  async function applyCandidate() { const candidate = candidates[candidateIndex]; if (!candidate || !layoutRunId) return; setBusy(true); try { await callTool("weaver_apply_layout", { workspaceDir: bootstrap.workspaceDir, layoutRunId, candidateId: candidate.id }); setCandidates([]); setLayoutRunId(null); } catch (error) { setStatus(error instanceof Error ? error.message : String(error)); } finally { setBusy(false); } }
  async function rejectLayout() { if (!layoutRunId) return; setBusy(true); try { await callTool("weaver_reject_layout", { workspaceDir: bootstrap.workspaceDir, layoutRunId }); setCandidates([]); setLayoutRunId(null); } catch (error) { setStatus(error instanceof Error ? error.message : String(error)); } finally { setBusy(false); } }
  async function revertLayout() { if (!project || !layout || standaloneDemo) return; setBusy(true); try { await callTool("weaver_revert_layout", { workspaceDir: bootstrap.workspaceDir, projectId: project.id, viewId: layout.viewId }); } catch (error) { setStatus(error instanceof Error ? error.message : String(error)); } finally { setBusy(false); } }

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

  function canvasCenter() { return screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 }); }
  function defaultSemanticType() { return manifest?.scenePack.nodeTypes[0]?.key ?? "idea"; }

  function createDemoNode(title: string, content: NodeContent, preview?: string) {
    if (!project || !layout) return null;
    const id = crypto.randomUUID(); const timestamp = new Date().toISOString(); const point = canvasCenter();
    const node: GraphNode = { id, projectId: project.id, type: defaultSemanticType(), title, contentKind: content.kind, content, properties: {}, archived: false, createdAt: timestamp, updatedAt: timestamp };
    const width = content.kind === "link" ? 300 : content.kind === "image" ? 320 : 280; const height = content.kind === "image" ? 220 : content.kind === "link" ? 180 : 160;
    if (content.kind === "image" && preview) { previewCache.current[content.assetId] = preview; setAssetPreviews({ ...previewCache.current }); node.assets = [{ id: content.assetId, width, height, mimeType: "image/png", thumbnailUri: "" }]; }
    setGraphNodes((current) => [...current, node]); setProject({ ...project, graphRevision: project.graphRevision + 1 }); setLayout({ ...layout, graphRevision: project.graphRevision + 1, layoutRevision: layout.layoutRevision + 1, nodes: { ...layout.nodes, [id]: { nodeId: id, x: point.x, y: point.y, width, height, pinned: false } } });
    return node;
  }

  async function createArticle() {
    if (!project || !layout) return; setCreateMenu(false); const content: DocumentContent = { kind: "document", mode: "article", markdown: "", excerpt: "", embeddedAssetIds: [] };
    if (standaloneDemo) { const node = createDemoNode("Untitled article", content); if (node) openDocument(node.id, node); return; }
    const point = canvasCenter(); const output = await callTool<any>("weaver_create_content_node", { workspaceDir: bootstrap.workspaceDir, projectId: project.id, viewId: layout.viewId, semanticType: defaultSemanticType(), title: "Untitled article", content, x: point.x, y: point.y }); setProject(output.project); setLayout(output.layout); await load(); await openDocument(output.node.id, output.node);
  }

  function chooseImage(action: "node" | "cover" | "embedded") { imageAction.current = action; fileInput.current?.click(); }
  async function fileBase64(file: File) { return new Promise<string>((resolveValue, reject) => { const reader = new FileReader(); reader.onload = () => resolveValue(String(reader.result).split(",", 2)[1] ?? ""); reader.onerror = () => reject(reader.error); reader.readAsDataURL(file); }); }

  async function importImageFile(file: File, action = imageAction.current) {
    if (!project || !layout) return;
    if (!["image/jpeg", "image/png", "image/webp", "image/gif"].includes(file.type)) { setStatus("Choose a JPEG, PNG, WebP, or GIF image."); return; }
    if (file.size > 20 * 1024 * 1024) { setStatus("Image is larger than the 20MB limit."); return; }
    setBusy(true);
    try {
      if (standaloneDemo) { const preview = URL.createObjectURL(file); if (action === "node") createDemoNode(file.name, { kind: "image", assetId: crypto.randomUUID(), alt: file.name, caption: "" }, preview); else if (activeDocument?.content.kind === "document" && draft) { const assetId = crypto.randomUUID(); previewCache.current[assetId] = preview; setAssetPreviews({ ...previewCache.current }); setDraft({ ...draft, coverAssetId: action === "cover" ? assetId : draft.coverAssetId, embeddedAssetIds: action === "embedded" ? [...draft.embeddedAssetIds, assetId] : draft.embeddedAssetIds }); setSaveState("dirty"); } return; }
      const imported = await callTool<any>("weaver_import_image_asset", { workspaceDir: bootstrap.workspaceDir, projectId: project.id, mimeType: file.type, base64: await fileBase64(file) });
      if (action === "node") { const point = canvasCenter(); await callTool("weaver_create_content_node", { workspaceDir: bootstrap.workspaceDir, projectId: project.id, viewId: layout.viewId, semanticType: defaultSemanticType(), title: file.name.replace(/\.[^.]+$/, ""), content: { kind: "image", assetId: imported.asset.id, alt: file.name, caption: "" }, x: point.x, y: point.y }); await load(); }
      else if (activeDocument) { const output = await callTool<any>("weaver_attach_asset", { workspaceDir: bootstrap.workspaceDir, projectId: project.id, nodeId: activeDocument.id, assetId: imported.asset.id, role: action, baseGraphRevision: project.graphRevision }); setProject(output.project); await openDocument(activeDocument.id); await load(); }
    } catch (error) { setStatus(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); if (fileInput.current) fileInput.current.value = ""; }
  }

  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => { const target = event.target as HTMLElement | null; if (target?.closest("input, textarea, [contenteditable='true']")) return; const image = [...(event.clipboardData?.items ?? [])].find((item) => item.type.startsWith("image/"))?.getAsFile(); if (image) { event.preventDefault(); void importImageFile(image, "node"); } };
    window.addEventListener("paste", onPaste); return () => window.removeEventListener("paste", onPaste);
  }, [project, layout, standaloneDemo]);

  async function createLink() {
    if (!project || !layout || !linkUrl.trim()) return;
    let url: URL; try { url = new URL(linkUrl.trim()); if (!["http:", "https:"].includes(url.protocol)) throw new Error(); } catch { setStatus("Enter a public HTTP or HTTPS URL."); return; }
    setBusy(true);
    try {
      const content: LinkContent = { kind: "link", url: url.href, title: url.hostname, description: "", domain: url.hostname, enrichmentStatus: "pending" };
      if (standaloneDemo) createDemoNode(url.hostname, { ...content, title: `Reference from ${url.hostname}`, description: "Development preview link card.", enrichmentStatus: "ready" });
      else { const point = canvasCenter(); const created = await callTool<any>("weaver_create_content_node", { workspaceDir: bootstrap.workspaceDir, projectId: project.id, viewId: layout.viewId, semanticType: defaultSemanticType(), title: url.hostname, content, x: point.x, y: point.y }); try { await callTool("weaver_enrich_link", { workspaceDir: bootstrap.workspaceDir, projectId: project.id, nodeId: created.node.id, baseGraphRevision: created.project.graphRevision }); } catch (error) { setStatus(error instanceof Error ? error.message : String(error)); } await load(); }
      setLinkUrl(""); setLinkComposer(false); setCreateMenu(false);
    } finally { setBusy(false); }
  }

  async function openDocument(nodeId: string, knownNode?: GraphNode) {
    const summary = knownNode ?? graphNodes.find((node) => node.id === nodeId); if (!summary || summary.contentKind !== "document") return;
    try { const full = standaloneDemo ? summary : (await callTool<{ node: GraphNode }>("weaver_get_node_content", { workspaceDir: bootstrap.workspaceDir, projectId: summary.projectId, nodeId })).node; const content = full.content as DocumentContent; setActiveDocument(full); setDraft({ title: full.title, semanticType: full.type, markdown: content.markdown ?? "", excerpt: content.excerpt, coverAssetId: content.coverAssetId, embeddedAssetIds: content.embeddedAssetIds }); setSaveState("saved"); setEditorMode("write"); }
    catch (error) { setStatus(error instanceof Error ? error.message : String(error)); }
  }

  async function openNodeViewer(nodeId: string) {
    const summary = graphNodesRef.current.find((node) => node.id === nodeId); if (!summary) return;
    try {
      const node = summary.contentKind === "document" && !standaloneDemo
        ? (await callTool<{ node: GraphNode }>("weaver_get_node_content", { workspaceDir: bootstrap.workspaceDir, projectId: summary.projectId, nodeId })).node
        : summary;
      setActiveViewer(node);
    } catch (error) { setStatus(error instanceof Error ? error.message : String(error)); }
  }

  async function saveDocument() {
    if (!activeDocument || !draft || !project || activeDocument.content.kind !== "document" || saveState === "saving") return true;
    const content: DocumentContent = { kind: "document", mode: activeDocument.content.mode, markdown: draft.markdown, excerpt: excerpt(draft.markdown), coverAssetId: draft.coverAssetId, embeddedAssetIds: draft.embeddedAssetIds };
    if (standaloneDemo) { const updated = { ...activeDocument, title: draft.title, type: draft.semanticType, content, updatedAt: new Date().toISOString() }; setActiveDocument(updated); setGraphNodes((current) => current.map((node) => node.id === updated.id ? updated : node)); setProject({ ...project, graphRevision: project.graphRevision + 1 }); saveStateRef.current = "saved"; setSaveState("saved"); return true; }
    setSaveState("saving");
    try { const output = await callTool<any>("weaver_update_node_content", { workspaceDir: bootstrap.workspaceDir, projectId: project.id, nodeId: activeDocument.id, baseGraphRevision: project.graphRevision, title: draft.title, semanticType: draft.semanticType, content }); setProject(output.project); setActiveDocument(output.node); setGraphNodes((current) => current.map((node) => node.id === output.node.id ? { ...node, title: output.node.title, type: output.node.type, content: { ...output.node.content, markdown: undefined } } : node)); saveStateRef.current = "saved"; setSaveState("saved"); setStatus(`Article saved · graph r${output.project.graphRevision}`); return true; }
    catch (error) { const message = error instanceof Error ? error.message : String(error); const nextState = message.includes("GRAPH_REVISION_CONFLICT") ? "conflict" : "dirty"; saveStateRef.current = nextState; setSaveState(nextState); setStatus(message); return false; }
  }

  useEffect(() => { if (saveState !== "dirty" || !draft) return; const timer = window.setTimeout(() => void saveDocument(), 800); return () => window.clearTimeout(timer); }, [draft, saveState]);

  function editDraft(patch: Partial<EditorDraft>) { setDraft((current) => current ? { ...current, ...patch } : current); setSaveState("dirty"); }
  function formatMarkdown(prefix: string, suffix = "") { const textarea = editorTextArea.current; if (!textarea || !draft) return; const start = textarea.selectionStart; const end = textarea.selectionEnd; const selected = draft.markdown.slice(start, end); editDraft({ markdown: `${draft.markdown.slice(0, start)}${prefix}${selected}${suffix}${draft.markdown.slice(end)}` }); requestAnimationFrame(() => { textarea.focus(); textarea.setSelectionRange(start + prefix.length, end + prefix.length); }); }

  async function openTemplateGallery(mode: "project" | "view") {
    setCreateMenu(false); setTemplateMode(mode); setTemplateGallery(true); setSelectedTemplate(null); setTemplateValidation(null); setTemplatePreview(null); setTemplateSearch(""); setTemplateFamily("all");
    setBusy(true);
    try { setTemplates(await callTool<VisualTemplate[]>("weaver_list_visual_templates", mode === "view" && project ? { scenePackId: project.scenePackId } : {})); }
    catch (error) { setStatus(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }

  async function chooseVisualTemplate(template: VisualTemplate) {
    setSelectedTemplate(template); setTemplateScenePackId(templateMode === "view" && project ? project.scenePackId : template.defaultScenePackId); setTemplateViewName(template.name); setDuplicateViewConfirmed(false); setTemplateValidation(null); setTemplatePreview(null);
    if (templateMode !== "view" || !project) return;
    setBusy(true);
    try {
      const [validation, preview] = await Promise.all([
        callTool<TemplateValidation>("weaver_validate_visual_template", { workspaceDir: bootstrap.workspaceDir, projectId: project.id, templateId: template.id, version: template.version }),
        callTool<Layout>("weaver_preview_visual_template", { workspaceDir: bootstrap.workspaceDir, projectId: project.id, templateId: template.id, version: template.version, baseGraphRevision: project.graphRevision, viewName: template.name }),
      ]);
      setTemplateValidation(validation); setTemplatePreview(preview);
    } catch (error) { setStatus(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }

  async function applyVisualTemplate() {
    if (!selectedTemplate || !bootstrap.workspaceDir) return;
    setBusy(true);
    try {
      if (templateMode === "project") {
        const currentBinding = bindingRef.current;
        const created = await callTool<{ project: Project; binding?: ChatBindingBootstrap }>("weaver_create_project_from_visual_template", { workspaceDir: bootstrap.workspaceDir, title: templateTitle.trim() || selectedTemplate.name, goal: templateGoal, scenePackId: templateScenePackId, templateId: selectedTemplate.id, version: selectedTemplate.version, leaseId: !isLocalDevelopment ? currentBinding?.leaseId : undefined, bindingRevision: !isLocalDevelopment ? currentBinding?.bindingRevision : undefined });
        const nextBinding = created.binding ? { ...created.binding, projectId: created.project.id, viewId: created.project.defaultViewId } : undefined;
        bindingRef.current = nextBinding;
        setActiveViewId(""); setBootstrap((current) => ({ ...current, projectId: created.project.id, chatBinding: nextBinding })); setStatus(`Created ${created.project.title} from ${selectedTemplate.name}`);
      } else if (project) {
        if (!templateValidation?.ready) throw new Error("VISUAL_TEMPLATE_DATA_NOT_READY");
        if (templateInstances.length && !duplicateViewConfirmed) { setDuplicateViewConfirmed(true); setStatus("Review existing Views before creating another copy"); return; }
        const next = await callTool<Layout & { chatBinding?: ChatBindingBootstrap }>("weaver_create_view_from_visual_template", { workspaceDir: bootstrap.workspaceDir, projectId: project.id, templateId: selectedTemplate.id, version: selectedTemplate.version, baseGraphRevision: project.graphRevision, viewName: templateViewName.trim() || selectedTemplate.name });
        if (next.chatBinding) { bindingRef.current = next.chatBinding; setBootstrap((current) => ({ ...current, chatBinding: next.chatBinding })); }
        else await ensureBindingTarget(project.id, next.viewId);
        setActiveViewId(next.viewId); setStatus(`Created visual view · ${next.viewName}`);
      }
      setTemplateGallery(false); setSelectedTemplate(null); setCandidates([]); setLayoutRunId(null);
    } catch (error) { setStatus(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }

  function catalogLeaseArgs() { const binding = bindingRef.current; return !isLocalDevelopment && binding ? { leaseId: binding.leaseId, bindingRevision: binding.bindingRevision } : {}; }

  function applyCatalogResult(output: { project: Project; delta: { fromRevision: number; toRevision: number; upsertedViews: ProjectView[]; removedViewIds: string[]; defaultViewId?: string } }) {
    const currentProject = projectRef.current; if (!currentProject) return;
    if (output.delta.toRevision <= currentProject.viewCatalogRevision) return;
    try {
      const next = applyViewCatalogDelta({ revision: currentProject.viewCatalogRevision, views: projectViewsRef.current, defaultViewId: currentProject.defaultViewId }, output.delta);
      projectViewsRef.current = next.views; setProjectViews(next.views);
      const nextProject = { ...currentProject, ...output.project, defaultViewId: next.defaultViewId, viewCatalogRevision: next.revision }; projectRef.current = nextProject; setProject(nextProject);
    } catch { void load(); }
  }

  async function renameProjectView(viewId: string) {
    if (!project || !renameValue.trim()) return;
    try { const output = await callTool<any>("weaver_rename_project_view", { workspaceDir: bootstrap.workspaceDir, projectId: project.id, viewId, name: renameValue.trim(), baseCatalogRevision: project.viewCatalogRevision, ...catalogLeaseArgs() }); applyCatalogResult(output); setRenamingViewId(null); setViewMenuId(null); setStatus(`Renamed View to ${output.view.name}`); }
    catch (error) { setStatus(error instanceof Error ? error.message : String(error)); }
  }

  async function pinProjectView(view: ProjectView) {
    if (!project) return;
    try { const output = await callTool<any>("weaver_pin_project_view", { workspaceDir: bootstrap.workspaceDir, projectId: project.id, viewId: view.id, pinned: !view.pinned, baseCatalogRevision: project.viewCatalogRevision, ...catalogLeaseArgs() }); applyCatalogResult(output); setViewMenuId(null); }
    catch (error) { setStatus(error instanceof Error ? error.message : String(error)); }
  }

  async function setDefaultView(view: ProjectView) {
    if (!project) return;
    try { const output = await callTool<any>("weaver_set_default_view", { workspaceDir: bootstrap.workspaceDir, projectId: project.id, viewId: view.id, baseCatalogRevision: project.viewCatalogRevision, ...catalogLeaseArgs() }); applyCatalogResult(output); setViewMenuId(null); setStatus(`${view.name} is now the default View`); }
    catch (error) { setStatus(error instanceof Error ? error.message : String(error)); }
  }

  async function reorderPinnedViews(targetViewId: string) {
    if (!project || !draggedViewId || draggedViewId === targetViewId) return;
    const ordered = fixedCatalogViews.map((view) => view.id); const from = ordered.indexOf(draggedViewId); const to = ordered.indexOf(targetViewId);
    if (from < 0 || to < 0) return;
    ordered.splice(to, 0, ordered.splice(from, 1)[0]);
    try { const output = await callTool<any>("weaver_reorder_pinned_views", { workspaceDir: bootstrap.workspaceDir, projectId: project.id, viewIds: ordered, baseCatalogRevision: project.viewCatalogRevision, ...catalogLeaseArgs() }); applyCatalogResult(output); }
    catch (error) { setStatus(error instanceof Error ? error.message : String(error)); }
    finally { setDraggedViewId(null); }
  }

  async function trashProjectView(view: ProjectView) {
    if (!project) return;
    try {
      const fallback = projectViews.find((candidate) => candidate.status === "active" && candidate.id !== view.id);
      const output = await callTool<any>("weaver_trash_project_view", { workspaceDir: bootstrap.workspaceDir, projectId: project.id, viewId: view.id, fallbackViewId: fallback?.id, baseCatalogRevision: project.viewCatalogRevision, ...catalogLeaseArgs() });
      if (output.binding) { bindingRef.current = output.binding; setBootstrap((current) => ({ ...current, chatBinding: output.binding })); }
      applyCatalogResult(output); setViewMenuId(null); setViewToast({ message: `Moved “${view.name}” to Recycle Bin`, undoViewId: view.id });
      if (layout?.viewId === view.id) { setCandidates([]); setLayoutRunId(null); setActiveViewId(output.fallbackView.id); }
    } catch (error) { setStatus(error instanceof Error ? error.message : String(error)); }
  }

  async function restoreProjectView(viewId: string) {
    const currentProject = projectRef.current; if (!currentProject) return;
    try { const output = await callTool<any>("weaver_restore_project_view", { workspaceDir: bootstrap.workspaceDir, projectId: currentProject.id, viewId, baseCatalogRevision: currentProject.viewCatalogRevision, ...catalogLeaseArgs() }); applyCatalogResult(output); setViewToast({ message: `Restored “${output.view.name}”` }); }
    catch (error) { setStatus(error instanceof Error ? error.message : String(error)); }
  }

  async function purgeProjectView(view: ProjectView) {
    if (!project) return;
    if (purgeConfirmId !== view.id) { setPurgeConfirmId(view.id); return; }
    try { const output = await callTool<any>("weaver_purge_project_view", { workspaceDir: bootstrap.workspaceDir, projectId: project.id, viewId: view.id, baseCatalogRevision: project.viewCatalogRevision, ...catalogLeaseArgs() }); applyCatalogResult(output); setPurgeConfirmId(null); setViewToast({ message: `Permanently deleted “${view.name}”` }); }
    catch (error) { setStatus(error instanceof Error ? error.message : String(error)); }
  }

  async function duplicateProjectView(view: ProjectView) {
    if (!project) return;
    try { const output = await callTool<any>("weaver_duplicate_project_view", { workspaceDir: bootstrap.workspaceDir, projectId: project.id, viewId: view.id, name: `${view.name} copy`, baseCatalogRevision: project.viewCatalogRevision, ...catalogLeaseArgs() }); applyCatalogResult(output); setViewMenuId(null); await switchView(output.view.id); }
    catch (error) { setStatus(error instanceof Error ? error.message : String(error)); }
  }

  async function switchView(viewId: string) {
    if (viewId === layout?.viewId) { setViewLibrary(false); return; }
    if (standaloneDemo) { setStatus(`Development preview · ${viewId}`); setViewLibrary(false); return; }
    if (!project) return;
    try {
      if (saveStateRef.current === "dirty" || saveStateRef.current === "conflict") { const saved = await saveDocument(); if (!saved) return; }
      await syncContext(); await ensureBindingTarget(project.id, viewId);
      const openedAt = new Date().toISOString(); setProjectViews((current) => current.map((view) => view.id === viewId ? { ...view, lastOpenedAt: openedAt } : view));
      setCandidates([]); setLayoutRunId(null); setSelection([]); setActiveViewId(viewId); setViewLibrary(false);
    } catch (error) { setStatus(error instanceof Error ? error.message : String(error)); }
  }

  const filteredTemplates = useMemo(() => templates.filter((item) => (templateFamily === "all" || item.family === templateFamily) && `${item.name} ${item.description}`.toLowerCase().includes(templateSearch.toLowerCase())), [templateFamily, templateSearch, templates]);
  const switcherViews = useMemo(() => selectSwitcherViews(projectViews, layout?.viewId ?? activeViewId), [activeViewId, layout?.viewId, projectViews]);
  const activeCatalogViews = useMemo(() => projectViews.filter((view) => view.status === "active" && (!viewQuery.trim() || `${view.name} ${view.viewType} ${view.templateRef?.id ?? ""}`.toLowerCase().includes(viewQuery.toLowerCase()))), [projectViews, viewQuery]);
  const trashedCatalogViews = useMemo(() => projectViews.filter((view) => view.status === "trashed" && (!viewQuery.trim() || view.name.toLowerCase().includes(viewQuery.toLowerCase()))), [projectViews, viewQuery]);
  const fixedCatalogViews = useMemo(() => activeCatalogViews.filter((view) => view.pinned).sort((left, right) => (left.pinnedOrder ?? 999) - (right.pinnedOrder ?? 999)), [activeCatalogViews]);
  const recentCatalogViews = useMemo(() => [...activeCatalogViews].sort((left, right) => Date.parse(right.lastOpenedAt) - Date.parse(left.lastOpenedAt)).slice(0, 5), [activeCatalogViews]);
  const templateInstances = useMemo(() => selectedTemplate ? findTemplateInstances(projectViews, selectedTemplate.id) : [], [projectViews, selectedTemplate]);
  const visualPreviewItems = useMemo(() => {
    if (templatePreview) {
      const entries = graphNodes.slice(0, 10).map((node) => ({ key: node.id, label: node.title, frame: templatePreview.nodes[node.id] })).filter((item) => item.frame);
      if (entries.length) { const xs = entries.map((item) => item.frame.x); const ys = entries.map((item) => item.frame.y); const minX = Math.min(...xs); const minY = Math.min(...ys); const width = Math.max(1, Math.max(...xs) - minX); const height = Math.max(1, Math.max(...ys) - minY); return entries.map((item) => ({ key: item.key, label: item.label, x: 12 + (item.frame.x - minX) / width * 176, y: 18 + (item.frame.y - minY) / height * 145 })); }
    }
    return selectedTemplate?.starterBlueprint.nodes.slice(0, 7).map((node, index) => ({ key: node.key, label: node.role, x: index === 0 ? 100 : 100 + Math.cos((index - 1) * Math.PI * 2 / Math.max((selectedTemplate.starterBlueprint.nodes.length - 1), 1)) * 76, y: index === 0 ? 90 : 90 + Math.sin((index - 1) * Math.PI * 2 / Math.max((selectedTemplate.starterBlueprint.nodes.length - 1), 1)) * 62 })) ?? [];
  }, [graphNodes, selectedTemplate, templatePreview]);

  function beginRename(view: ProjectView) { setRenamingViewId(view.id); setRenameValue(view.name); setViewMenuId(null); setViewLibrary(true); requestAnimationFrame(() => document.querySelector<HTMLInputElement>(`[data-rename-view="${view.id}"]`)?.focus()); }

  function renderViewActions(view: ProjectView) {
    return <div className="view-action-menu" role="menu" onClick={(event) => event.stopPropagation()}>
      <button onClick={() => beginRename(view)}><Pencil size={13} /> Rename</button>
      <button onClick={() => void pinProjectView(view)}><PinIcon size={13} /> {view.pinned ? "Unpin" : "Pin to top"}</button>
      <button onClick={() => void duplicateProjectView(view)}><Copy size={13} /> Duplicate</button>
      <button onClick={() => void setDefaultView(view)} disabled={project?.defaultViewId === view.id}><Home size={13} /> {project?.defaultViewId === view.id ? "Default View" : "Set as default"}</button>
      <button className="danger" onClick={() => void trashProjectView(view)} disabled={projectViews.filter((candidate) => candidate.status === "active").length <= 1}><Trash2 size={13} /> Move to Recycle Bin</button>
    </div>;
  }

  function renderViewRow(view: ProjectView, options: { compact?: boolean } = {}) {
    const current = layout?.viewId === view.id;
    if (view.status === "trashed") return <div className="view-library-row trashed" key={`trash-${view.id}`}>
      <div className="view-miniature" data-type={view.viewType}><span /><span /><span /></div>
      <div className="view-row-copy"><strong>{view.name}</strong><small>{view.viewType} · deletes {view.purgeAfter ? new Date(view.purgeAfter).toLocaleDateString() : "in 30 days"}</small></div>
      <div className="view-row-actions"><button onClick={() => void restoreProjectView(view.id)}><Undo2 size={14} /> Restore</button><button className="danger" onClick={() => void purgeProjectView(view)}><Trash2 size={14} /> {purgeConfirmId === view.id ? "Confirm delete" : "Delete forever"}</button></div>
    </div>;
    return <div className="view-library-row" data-current={current} key={`${options.compact ? "compact" : "all"}-${view.id}`} onClick={() => void switchView(view.id)}>
      <div className="view-miniature" data-type={view.viewType}><span /><span /><span /></div>
      <div className="view-row-copy">{renamingViewId === view.id ? <input data-rename-view={view.id} value={renameValue} onChange={(event) => setRenameValue(event.target.value)} onClick={(event) => event.stopPropagation()} onKeyDown={(event) => { if (event.key === "Enter") void renameProjectView(view.id); if (event.key === "Escape") setRenamingViewId(null); }} onBlur={() => renameValue.trim() && renameValue !== view.name ? void renameProjectView(view.id) : setRenamingViewId(null)} /> : <><strong>{view.name}{project?.defaultViewId === view.id ? <Home size={11} /> : null}</strong><small>{view.viewType}{view.templateRef ? ` · ${view.templateRef.id}` : ""}{typeof view.nodeCount === "number" ? ` · ${view.nodeCount} nodes` : ""}</small></>}</div>
      <div className="view-row-actions" onClick={(event) => event.stopPropagation()}><button aria-label={view.pinned ? `Unpin ${view.name}` : `Pin ${view.name}`} onClick={() => void pinProjectView(view)}><PinIcon size={14} fill={view.pinned ? "currentColor" : "none"} /></button><button aria-label={`More actions for ${view.name}`} onClick={() => setViewMenuId(viewMenuId === view.id ? null : view.id)}><MoreHorizontal size={16} /></button>{viewMenuId === view.id ? renderViewActions(view) : null}</div>
    </div>;
  }

  const displayedNodes = useMemo(() => { const candidate = candidates[candidateIndex]; if (!candidate) return nodes; return nodes.map((node) => ({ ...node, position: { x: candidate.document.nodes[node.id]?.x ?? node.position.x, y: candidate.document.nodes[node.id]?.y ?? node.position.y } })); }, [candidateIndex, candidates, nodes]);
  const viewerAssetId = activeViewer?.content.kind === "image" ? activeViewer.content.assetId : activeViewer?.content.kind === "document" ? activeViewer.content.coverAssetId : activeViewer?.content.kind === "link" ? activeViewer.content.imageAssetId : undefined;
  const viewerImage = viewerAssetId ? assetPreviews[viewerAssetId] : undefined;
  const handleSelectionChange = useCallback(({ nodes: selected }: { nodes: Node[] }) => { const next = selected.map((node) => node.id).sort(); setSelection((current) => current.length === next.length && current.every((id, index) => id === next[index]) ? current : next); }, []);
  const handleNodeDrag = useCallback((_event: React.MouseEvent, dragged: Node) => { setNodes((current) => current.map((node) => node.id === dragged.id ? { ...node, position: { x: dragged.position.x, y: dragged.position.y } } : node)); }, [setNodes]);
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
  }, [getViewport, setViewport]);

  return <main className="weaver-shell" data-editor-open={Boolean(activeDocument)}>
    <header className="topbar">
      <div className="brand"><span>W</span><div><strong title={project?.title ?? "Weaver"}>{project?.title ?? "Weaver"}</strong><small>{status}</small></div></div>
      <nav className="view-tabs" aria-label="Project views">{switcherViews.map((view) => <div className="view-tab" data-active={layout?.viewId === view.id} data-dragging={draggedViewId === view.id} draggable={view.pinned} onDragStart={() => view.pinned && setDraggedViewId(view.id)} onDragOver={(event) => view.pinned && event.preventDefault()} onDrop={() => void reorderPinnedViews(view.id)} onDragEnd={() => setDraggedViewId(null)} key={view.id}><button onClick={() => void switchView(view.id)} disabled={busy}>{view.pinned ? <PinIcon size={10} fill="currentColor" /> : null}{view.name}</button><button className="view-tab-more" aria-label={`More actions for ${view.name}`} onClick={() => setViewMenuId(viewMenuId === view.id ? null : view.id)}><MoreHorizontal size={13} /></button>{viewMenuId === view.id ? renderViewActions(view) : null}</div>)}<button className="all-views-button" onClick={() => setViewLibrary(true)} disabled={!project}><Library size={12} /> All Views <span>{projectViews.filter((view) => view.status === "active").length}</span></button><button className="new-view" aria-label="New visual view" onClick={() => void openTemplateGallery("view")} disabled={!project || busy}><Plus size={12} /></button></nav>
      <div className="top-actions">
        <button className="stream-status" data-state={streamState} onClick={() => streamState === "offline" && setStreamGeneration((value) => value + 1)} title={streamState === "offline" ? "Reconnect live sync" : "SSE live sync status"}><span /> {streamState === "online" ? "Live" : streamState === "connecting" ? "Connecting" : "Reconnect"}</button>
        <div className="create-anchor"><button className="create-button" onClick={() => { setCreateMenu(!createMenu); setLinkComposer(false); }}><Plus size={15} /> Create</button>
          {createMenu ? <div className="create-menu" role="menu"><button onClick={() => void openTemplateGallery("project")}><LayoutTemplate size={17} /><span><strong>Project from template</strong><small>Create starter structure and visual</small></span></button><button onClick={() => void openTemplateGallery("view")} disabled={!project}><Sparkles size={17} /><span><strong>New visual view</strong><small>Project current content without changing it</small></span></button><button onClick={() => void createArticle()} disabled={!project}><FileText size={17} /><span><strong>Article</strong><small>Write in the side editor</small></span></button><button onClick={() => chooseImage("node")} disabled={!project}><ImagePlus size={17} /><span><strong>Image</strong><small>Upload or paste</small></span></button><button onClick={() => setLinkComposer(true)} disabled={!project}><Link2 size={17} /><span><strong>Link</strong><small>Save a rich preview</small></span></button>{linkComposer ? <div className="link-composer"><label htmlFor="link-url">Public URL</label><input id="link-url" value={linkUrl} onChange={(event) => setLinkUrl(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void createLink(); }} placeholder="https://…" autoFocus /><button onClick={() => void createLink()} disabled={!linkUrl.trim() || busy}>Create link</button></div> : null}</div> : null}
        </div>
        <button onClick={() => void togglePinned()} disabled={!selection.length || standaloneDemo}>{selection.some((id) => layout?.nodes[id]?.pinned) ? <Unlock size={15} /> : <Lock size={15} />} {selection.some((id) => layout?.nodes[id]?.pinned) ? "Unpin" : "Pin"}</button>
        <button onClick={revertLayout} disabled={busy || standaloneDemo}><RotateCcw size={15} /> Undo layout</button>
      </div>
    </header>
    <section className="workspace-stage">
      {viewLibrary ? <div className="view-library-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setViewLibrary(false); }}><aside className="view-library-drawer" aria-label="View Library">
        <header><div><span>PROJECT VIEWS</span><h2>All Views</h2></div><button aria-label="Close View Library" onClick={() => setViewLibrary(false)}><PanelLeftClose size={18} /></button></header>
        <label className="view-library-search"><Search size={15} /><input id="view-library-search" value={viewQuery} onChange={(event) => setViewQuery(event.target.value)} placeholder="Search views…" /></label>
        <div className="view-library-scroll">
          {fixedCatalogViews.length ? <section><h3><PinIcon size={12} /> Fixed <span>{fixedCatalogViews.length}</span></h3>{fixedCatalogViews.map((view) => renderViewRow(view, { compact: true }))}</section> : null}
          {!viewQuery && recentCatalogViews.length ? <section><h3>Recent <span>{recentCatalogViews.length}</span></h3>{recentCatalogViews.map((view) => renderViewRow(view, { compact: true }))}</section> : null}
          <section><h3>All Views <span>{activeCatalogViews.length}</span></h3>{activeCatalogViews.length ? activeCatalogViews.map((view) => renderViewRow(view)) : <div className="view-library-empty">No Views match “{viewQuery}”.</div>}</section>
          <section className="recycle-section"><h3><Trash2 size={12} /> Recycle Bin <span>{trashedCatalogViews.length}</span></h3>{trashedCatalogViews.length ? trashedCatalogViews.map((view) => renderViewRow(view)) : <div className="view-library-empty">Deleted Views stay here for 30 days.</div>}</section>
        </div>
        <footer><span>⌘/Ctrl + Shift + V</span><button onClick={() => { setViewLibrary(false); void openTemplateGallery("view"); }}><Plus size={13} /> New visual view</button></footer>
      </aside></div> : null}
      <section className="canvas-wrap" onWheelCapture={handleCanvasWheel} style={{ background: layout?.theme?.canvas.backgroundColor } as React.CSSProperties}>
        <ReactFlow nodes={displayedNodes} edges={edges} nodeTypes={nodeTypes} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
          nodesDraggable elementsSelectable nodeDragThreshold={1} selectNodesOnDrag
          panOnDrag panOnScroll panOnScrollMode={PanOnScrollMode.Free} panOnScrollSpeed={0.72} panActivationKeyCode="Space"
          zoomOnScroll={false} zoomOnPinch zoomOnDoubleClick={false} selectionOnDrag={false} selectionMode={SelectionMode.Partial} selectionKeyCode="Shift"
          autoPanOnNodeDrag autoPanOnConnect autoPanOnSelection autoPanSpeed={18}
          onMove={(_event, nextViewport) => { viewport.current = nextViewport; }} onMoveEnd={(_event, nextViewport) => { viewport.current = nextViewport; void syncContext(); }}
          onNodeDrag={handleNodeDrag} onNodeDragStart={(_event, node) => { draggingNodeId.current = node.id; setStatus("Moving node…"); }} onNodeDragStop={(_event, node) => { draggingNodeId.current = null; void persistNodeFrame(node); }} onNodeDoubleClick={(_event, node) => void openNodeViewer(node.id)} onSelectionChange={handleSelectionChange}
          fitView fitViewOptions={{ padding: 0.18, maxZoom: 1.15 }} minZoom={0.05} maxZoom={4}>
          {layout?.theme?.canvas.pattern !== "plain" ? <Background variant={layout?.theme?.canvas.pattern === "grid" ? BackgroundVariant.Lines : BackgroundVariant.Dots} gap={20} size={1} color={layout?.theme?.canvas.patternColor ?? "#cdd1ca"} /> : null}<Controls showInteractive={false} /><MiniMap pannable zoomable nodeColor={(node) => node.type === "image" ? "#eb775f" : node.type === "link" ? "#282d28" : layout?.theme?.nodeStyles.default?.accentColor ?? "#315cf6"} />
        </ReactFlow>
        <div className="canvas-gesture-hint"><span>Drag canvas</span><span>Scroll to pan</span><span>⌘/Ctrl + scroll to zoom</span><span>Shift to select</span></div>
        <div className="codex-context-status"><Sparkles size={13} /><span>{isLocalDevelopment || standaloneDemo ? "Browser preview. Agent unavailable" : !bindingRef.current ? "Canvas is not bound to a Codex chat" : selection.length ? `${selection.length} selected · bound to this Codex chat` : "Bound to this Codex chat"}</span></div>
        {activeTask && activeTask.status !== "pending_review" ? <aside className="agent-task-panel"><div><span className="agent-task-pulse" /><strong>{activeTask.activeStage} · {activeTask.status.replaceAll("_", " ")}</strong></div><button onClick={() => void cancelActiveTask()}>Cancel</button></aside> : null}
        {changePreview ? <aside className="candidate-panel changeset-panel"><div><strong>Content preview</strong><small>{changePreview.changeSet.riskLevel} risk</small></div><h3>{changePreview.changeSet.rationale || "Agent changes"}</h3><p>+{changePreview.summary.addedNodes} nodes · {changePreview.summary.updatedNodes} updated · +{changePreview.summary.addedEdges} relations · {changePreview.summary.layoutOperations} layout ops</p>{changePreview.stale ? <p className="stale-warning">This proposal is stale. Ask Codex to regenerate it from the current canvas.</p> : null}<div className="candidate-actions"><button onClick={() => void rejectChangeSet()}><X size={14} /> Reject</button>{!changePreview.stale ? <button className="apply" onClick={() => void applyChangeSet()}><Check size={15} /> Apply all</button> : null}</div></aside> : null}
        {candidates.length ? <aside className="candidate-panel"><div><strong>Layout preview</strong><small>{candidateIndex + 1} / {candidates.length}</small></div><h3>{candidates[candidateIndex].label}</h3><p>Score {candidates[candidateIndex].metrics.score.toFixed(1)} · {candidates[candidateIndex].metrics.edgeCrossings} crossings</p><div className="candidate-actions"><button onClick={() => void rejectLayout()}><X size={14} /> Reject</button><button onClick={() => setCandidateIndex((candidateIndex + 1) % candidates.length)}>Next option</button><button className="apply" onClick={() => void applyCandidate()}><Check size={15} /> Apply</button></div></aside> : null}
        {staleTask && !changePreview && !candidates.length ? <aside className="candidate-panel changeset-panel"><div><strong>Task is stale</strong><small>{staleTask.error?.code}</small></div><p>{staleTask.error?.message ?? "The canvas changed while the task was running."} Ask Codex to regenerate it from the current canvas.</p></aside> : null}
        {viewToast ? <div className="view-toast" role="status"><span>{viewToast.message}</span>{viewToast.undoViewId ? <button onClick={() => { void restoreProjectView(viewToast.undoViewId!); setViewToast(null); }}>Undo</button> : null}<button aria-label="Dismiss notification" onClick={() => setViewToast(null)}><X size={13} /></button></div> : null}
      </section>
      {templateGallery ? <div className="template-gallery-backdrop" role="presentation"><section className="template-gallery" role="dialog" aria-modal="true" aria-label="Visual Template Gallery">
        <header><div><span>WEAVER VISUAL SYSTEM</span><h2>{templateMode === "project" ? "Create from a visual template" : "New visual view"}</h2><p>{templateMode === "project" ? "Start with a semantic skeleton, projection, layout and theme." : "Project the same content into another structure without changing the graph."}</p></div>{project ? <button aria-label="Close template gallery" onClick={() => setTemplateGallery(false)}><X size={19} /></button> : null}</header>
        <div className="template-gallery-body">
          <aside className="template-families"><button data-active={templateFamily === "all"} onClick={() => setTemplateFamily("all")}>All visuals</button>{(["canvas", "hierarchy", "relationship", "flow", "temporal", "board", "matrix", "table"] as VisualFamily[]).map((family) => <button key={family} data-active={templateFamily === family} onClick={() => setTemplateFamily(family)}>{family}</button>)}</aside>
          <section className="template-catalog"><label className="template-search"><Search size={15} /><input aria-label="Search visual templates" placeholder="Search templates…" value={templateSearch} onChange={(event) => setTemplateSearch(event.target.value)} /></label><div className="template-grid">{filteredTemplates.map((template) => { const existingCount = projectViews.filter((view) => view.status === "active" && view.templateRef?.id === template.id).length; return <button key={template.id} className="template-card" data-selected={selectedTemplate?.id === template.id} onClick={() => void chooseVisualTemplate(template)}><div className="template-thumbnail" style={{ background: template.theme.canvas.backgroundColor, color: template.theme.nodeStyles.default?.accentColor }}><i /><i /><i /><i /><span>{template.projection.kind}</span></div><strong>{template.name}{existingCount ? <em>{existingCount} existing</em> : null}</strong><small>{template.family} · {template.renderer}</small><p>{template.description}</p></button>; })}</div></section>
          <aside className="template-detail">{selectedTemplate ? <>
            <div className="template-detail-preview" style={{ background: selectedTemplate.theme.canvas.backgroundColor, "--preview-accent": selectedTemplate.theme.nodeStyles.default?.accentColor } as React.CSSProperties}>{visualPreviewItems.map((item, index) => <div className={index === 0 ? "preview-root" : "preview-node"} key={item.key} style={{ left: item.x, top: item.y, transform: "translate(-50%, -50%)" }} title={item.label}>{item.label.slice(0, 18)}</div>)}</div>
            <span className="template-kind">{selectedTemplate.family} · {selectedTemplate.layoutPreset.strategy}</span><h3>{selectedTemplate.name}</h3><p>{selectedTemplate.description}</p>
            {templateMode === "project" ? <div className="template-form"><label>Project title<input value={templateTitle} onChange={(event) => setTemplateTitle(event.target.value)} /></label><label>Goal<textarea value={templateGoal} onChange={(event) => setTemplateGoal(event.target.value)} placeholder="What do you want to explore?" /></label><label>Scene Pack<select value={templateScenePackId} onChange={(event) => setTemplateScenePackId(event.target.value)}>{selectedTemplate.compatibleScenePackIds.map((id) => <option key={id} value={id}>{id}</option>)}</select></label></div> : <>
              <div className="template-form"><label>View name<input value={templateViewName} onChange={(event) => setTemplateViewName(event.target.value)} placeholder="Name this perspective" /></label></div>
              {templateInstances.length ? <div className="existing-template-views"><strong>{templateInstances.length} existing {templateInstances.length === 1 ? "View" : "Views"}</strong><p>Open an existing perspective or intentionally create another.</p>{templateInstances.map((view) => <button key={view.id} onClick={() => { setTemplateGallery(false); void switchView(view.id); }}><span>{view.name}</span><small>Open</small></button>)}</div> : null}
              <div className="template-readiness" data-ready={templateValidation?.ready}>{busy && !templateValidation ? "Checking current data…" : templateValidation?.ready ? `${templateValidation.matchedNodeCount} nodes ready for this view` : templateValidation ? `${templateValidation.missingRequiredFields.length} required values missing` : "Select to validate current data"}{templateValidation?.missingRequiredFields.length ? <small>Missing: {[...new Set(templateValidation.missingRequiredFields.map((item) => item.propertyKey))].join(", ")}</small> : null}{templatePreview ? <small>Preview generated at graph r{templatePreview.graphRevision}</small> : null}</div>
            </>}
            <button className="use-template" onClick={() => void applyVisualTemplate()} disabled={busy || (templateMode === "view" && (!templateValidation?.ready || !templateViewName.trim()))}>{busy ? <Loader2 className="spin" size={16} /> : <Sparkles size={16} />}{templateMode === "project" ? "Create project" : templateInstances.length && !duplicateViewConfirmed ? "Create another View…" : "Create new View"}</button>
          </> : <div className="template-empty"><LayoutTemplate size={38} /><strong>Select a template</strong><p>Inspect its structure, data requirements, layout and theme before applying it.</p></div>}</aside>
        </div>
      </section></div> : null}
      {activeViewer ? <div className="node-viewer-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setActiveViewer(null); }}><article className="node-viewer" role="dialog" aria-modal="true" aria-label={`View ${activeViewer.title}`}>
        <header><div><span>{activeViewer.type} · {activeViewer.contentKind}</span><h2>{activeViewer.title}</h2></div><div className="node-viewer-actions">{activeViewer.contentKind === "document" ? <button onClick={() => { const node = activeViewer; setActiveViewer(null); void openDocument(node.id, node); }}><Pencil size={15} /> Edit</button> : null}<button aria-label="Close node viewer" onClick={() => setActiveViewer(null)}><X size={18} /></button></div></header>
        <div className="node-viewer-body">
          {activeViewer.content.kind === "document" ? <article className="node-viewer-markdown"><ReactMarkdown>{activeViewer.content.markdown || activeViewer.content.excerpt || "_Empty document_"}</ReactMarkdown></article> : null}
          {activeViewer.content.kind === "image" ? <figure>{viewerImage ? <img src={viewerImage} alt={activeViewer.content.alt || activeViewer.title} /> : <FileImage size={54} />}<figcaption>{activeViewer.content.caption || activeViewer.content.alt}</figcaption></figure> : null}
          {activeViewer.content.kind === "link" ? <div className="node-viewer-link">{viewerImage ? <img src={viewerImage} alt="" /> : <ExternalLink size={42} />}<p>{activeViewer.content.description}</p><a href={activeViewer.content.url} target="_blank" rel="noreferrer">{activeViewer.content.url}</a></div> : null}
        </div>
      </article></div> : null}
      {activeDocument && draft ? <aside className="editor-panel" aria-label="Article editor">
        <header><div><span>ARTICLE</span><strong>{saveState === "saving" ? "Saving draft…" : saveState === "dirty" ? "Unsaved changes" : saveState === "conflict" ? "Newer version exists" : "All changes saved"}</strong></div><button aria-label="Close article editor" onClick={() => setActiveDocument(null)}><PanelRightClose size={19} /></button></header>
        {saveState === "conflict" ? <div className="conflict-banner"><strong>Your draft was not overwritten.</strong><p>Another edit changed this project. Copy your draft or reload the latest version.</p><button onClick={async () => { await load(); await openDocument(activeDocument.id); }}>Reload latest</button></div> : null}
        <div className="editor-fields"><label>Title<input value={draft.title} onChange={(event) => editDraft({ title: event.target.value })} /></label><label>Semantic type<select value={draft.semanticType} onChange={(event) => editDraft({ semanticType: event.target.value })}>{manifest?.scenePack.nodeTypes.map((type) => <option key={type.key} value={type.key}>{type.label}</option>)}</select></label></div>
        <div className="editor-tabs" role="tablist"><button role="tab" aria-selected={editorMode === "write"} onClick={() => setEditorMode("write")}>Write</button><button role="tab" aria-selected={editorMode === "preview"} onClick={() => setEditorMode("preview")}>Preview</button><div className="editor-media"><button onClick={() => chooseImage("cover")}><FileImage size={14} /> Cover</button><button onClick={() => chooseImage("embedded")}><ImagePlus size={14} /> Attach</button></div></div>
        {editorMode === "write" ? <><div className="markdown-toolbar" aria-label="Markdown formatting"><button aria-label="Heading" onClick={() => formatMarkdown("## ")}><Heading2 size={16} /></button><button aria-label="Bold" onClick={() => formatMarkdown("**", "**")}><Bold size={16} /></button><button aria-label="Bulleted list" onClick={() => formatMarkdown("- ")}><List size={16} /></button></div><textarea ref={editorTextArea} className="markdown-editor" value={draft.markdown} onChange={(event) => editDraft({ markdown: event.target.value, excerpt: excerpt(event.target.value) })} placeholder="Start with a thought. Markdown is stored as the source of truth." /></> : <article className="markdown-preview"><ReactMarkdown>{draft.markdown || "_Nothing written yet._"}</ReactMarkdown></article>}
        <footer><span>{draft.markdown.length} characters</span><button onClick={() => void saveDocument()} disabled={saveState === "saving" || saveState === "saved"}>Save now</button></footer>
      </aside> : null}
    </section>
    <input ref={fileInput} className="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importImageFile(file); }} />
  </main>;
}

const root = window.__weaverRoot ?? createRoot(document.getElementById("root")!);
window.__weaverRoot = root;
root.render(<React.StrictMode><ReactFlowProvider><WeaverWidget /></ReactFlowProvider></React.StrictMode>);
