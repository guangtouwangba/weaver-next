import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { App as McpApp } from "@modelcontextprotocol/ext-apps";
import {
  Background, BackgroundVariant, Controls, Handle, MiniMap, Position, ReactFlow, ReactFlowProvider,
  PanOnScrollMode, SelectionMode, useEdgesState, useNodesState, useReactFlow, type Edge, type Node, type NodeProps, type Viewport,
} from "@xyflow/react";
import {
  Bold, Check, ExternalLink, FileImage, FileText, GitBranch, Heading2, ImagePlus, LayoutTemplate,
  Link2, List, Loader2, Lock, MessageSquareText, PanelRightClose, Plus, RotateCcw, Sparkles, Unlock, X,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import "@xyflow/react/dist/style.css";
import "./styles.css";
import { applyGraphDelta, applyLayoutOperations, type GraphDelta, type LayoutOperation } from "./sync";

declare global { interface Window { openai?: { toolOutput?: Record<string, unknown> }; __weaverRoot?: ReturnType<typeof createRoot> } }

type ToolResult<T> = { structuredContent?: T; isError?: boolean; content?: Array<{ type: string; text?: string }> };
type Bootstrap = { workspaceDir: string; projectId?: string; preferredDisplayMode?: string };
type Project = { id: string; title: string; defaultViewId: string; graphRevision: number; scenePackId: string; scenePackVersion: string };
type Asset = { id: string; width: number; height: number; mimeType: string; thumbnailUri: string };
type DocumentContent = { kind: "document"; mode: "note" | "article"; markdown?: string; excerpt: string; coverAssetId?: string; embeddedAssetIds: string[] };
type ImageContent = { kind: "image"; assetId: string; alt: string; caption: string };
type LinkContent = { kind: "link"; url: string; title: string; description: string; domain: string; imageAssetId?: string; enrichmentStatus: "pending" | "ready" | "failed" };
type NodeContent = DocumentContent | ImageContent | LinkContent;
type GraphNode = { id: string; projectId: string; type: string; title: string; contentKind: NodeContent["kind"]; content: NodeContent; assets?: Asset[]; properties: Record<string, unknown>; archived: boolean; createdAt: string; updatedAt: string };
type GraphEdge = { id: string; sourceNodeId: string; targetNodeId: string; type: string };
type LayoutNode = { nodeId: string; x: number; y: number; width: number; height: number; pinned: boolean };
type Layout = { viewId: string; viewType: string; graphRevision: number; layoutRevision: number; nodes: Record<string, LayoutNode> };
type Candidate = { id: string; label: string; metrics: { score: number; overlapCount: number; edgeCrossings: number; hardViolations: string[] }; document: Layout };
type Manifest = { scenePack: { recommendedViews: string[]; nodeTypes: Array<{ key: string; label: string; defaultContentKind: NodeContent["kind"]; allowedContentKinds: NodeContent["kind"][] }> } };
type CardData = { title: string; semanticType: string; pinned: boolean; contentKind: NodeContent["kind"]; excerpt?: string; imageSrc?: string; caption?: string; domain?: string; description?: string; status?: string };
type EditorDraft = { title: string; semanticType: string; markdown: string; excerpt: string; coverAssetId?: string; embeddedAssetIds: string[] };
type TaskIntent = "develop_selection" | "layout_view" | "develop_then_layout";
type AgentTask = { taskId: string; canvasSessionId: string; projectId: string; taskRevision: number; intent: TaskIntent; activeStage: "content" | "layout"; status: string; results: { changeSetId?: string; layoutRunId?: string }; expectedGraphRevision: number; baseLayoutRevision?: number; userInstruction?: string; error?: { code: string; message: string } };
type ChangeSetPreview = { changeSet: { id: string; rationale: string; riskLevel: string; graphOperations: unknown[]; layoutOperations: unknown[] }; stale: boolean; currentGraphRevision: number; summary: { addedNodes: number; updatedNodes: number; archivedNodes: number; addedEdges: number; updatedEdges: number; archivedEdges: number; layoutOperations: number } };
type ProjectEvent = { sequence: number; kind: "task.updated" | "graph.changed" | "layout.changed" | "stream.reset"; payload: any; graphRevision?: number; layoutRevision?: number; viewId?: string };

const mcp = new McpApp({ name: "weaver-next-widget", version: "0.1.0" }, { availableDisplayModes: ["inline", "fullscreen"] }, { autoResize: true });

async function callTool<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const result = await mcp.callServerTool({ name, arguments: args }) as ToolResult<T>;
  if (result.isError) throw new Error(result.content?.find((item) => item.type === "text")?.text ?? `${name} failed`);
  const value = result.structuredContent as any;
  return (value && Object.keys(value).length === 1 && Array.isArray(value.items) ? value.items : value) as T;
}

function excerpt(markdown: string) { return markdown.replace(/[#>*_`\[\]()!-]/g, " ").replace(/\s+/g, " ").trim().slice(0, 280); }

function NodeShell({ children, data, className }: { children: React.ReactNode; data: CardData; className: string }) {
  return <article className={`content-card ${className}`} data-pinned={data.pinned}>
    <Handle type="target" position={Position.Left} />{children}<Handle type="source" position={Position.Right} />
  </article>;
}

function DocumentCard({ data }: NodeProps<Node<CardData>>) {
  return <NodeShell data={data} className="document-card">
    {data.imageSrc ? <img className="document-cover" src={data.imageSrc} alt="" /> : null}
    <div className="card-kicker"><FileText size={11} /> {data.semanticType}</div>
    <strong>{data.title || "Untitled article"}</strong>
    <p>{data.excerpt || "Open to begin writing."}</p>
    <div className="card-foot">{data.pinned ? <><Lock size={11} /> fixed</> : "document"}</div>
  </NodeShell>;
}

function ImageCard({ data }: NodeProps<Node<CardData>>) {
  return <NodeShell data={data} className="image-card">
    <div className="image-stage">{data.imageSrc ? <img src={data.imageSrc} alt={data.caption || data.title} /> : <FileImage size={30} />}</div>
    <div className="image-caption"><span>{data.semanticType}</span><strong>{data.caption || data.title || "Untitled image"}</strong></div>
  </NodeShell>;
}

function LinkCard({ data }: NodeProps<Node<CardData>>) {
  return <NodeShell data={data} className="link-card">
    {data.imageSrc ? <img className="link-cover" src={data.imageSrc} alt="" /> : <div className="link-mark"><ExternalLink size={22} /></div>}
    <div className="link-copy"><span>{data.domain || data.status || "LINK"}</span><strong>{data.title || "Untitled link"}</strong><p>{data.description || "Preview details will appear here."}</p></div>
  </NodeShell>;
}

const nodeTypes = { document: DocumentCard, image: ImageCard, link: LinkCard };

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
  const [instruction, setInstruction] = useState("");
  const [taskIntent, setTaskIntent] = useState<TaskIntent>("layout_view");
  const [status, setStatus] = useState("Connecting to Weaver…");
  const [streamState, setStreamState] = useState<"connecting" | "online" | "offline">("connecting");
  const [streamGeneration, setStreamGeneration] = useState(0);
  const [busy, setBusy] = useState(false);
  const [layoutRunId, setLayoutRunId] = useState<string | null>(null);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [changePreview, setChangePreview] = useState<ChangeSetPreview | null>(null);
  const [staleTask, setStaleTask] = useState<AgentTask | null>(null);
  const [candidateIndex, setCandidateIndex] = useState(0);
  const [activeViewId, setActiveViewId] = useState("");
  const [createMenu, setCreateMenu] = useState(false);
  const [linkComposer, setLinkComposer] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [activeDocument, setActiveDocument] = useState<GraphNode | null>(null);
  const [draft, setDraft] = useState<EditorDraft | null>(null);
  const [editorMode, setEditorMode] = useState<"write" | "preview">("write");
  const [saveState, setSaveState] = useState<"saved" | "dirty" | "saving" | "conflict">("saved");
  const fileInput = useRef<HTMLInputElement>(null);
  const imageAction = useRef<"node" | "cover" | "embedded">("node");
  const editorTextArea = useRef<HTMLTextAreaElement>(null);
  const sessionId = useRef(crypto.randomUUID());
  const sequence = useRef(0);
  const syncTimer = useRef<number | null>(null);
  const stream = useRef<EventSource | null>(null);
  const lastEventSequence = useRef(0);
  const continuedTasks = useRef(new Set<string>());
  const draggingNodeId = useRef<string | null>(null);
  const projectRef = useRef<Project | null>(null);
  const layoutRef = useRef<Layout | null>(null);
  const graphNodesRef = useRef<GraphNode[]>([]);
  const graphEdgesRef = useRef<GraphEdge[]>([]);
  const saveStateRef = useRef(saveState);
  const activeDocumentRef = useRef<GraphNode | null>(null);
  const viewport = useRef<Viewport>({ x: 0, y: 0, zoom: 1 });
  const { getViewport, screenToFlowPosition, setViewport } = useReactFlow();

  const demoImage = useMemo(() => `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="420"><rect width="640" height="420" fill="#d8dbcf"/><circle cx="160" cy="160" r="90" fill="#315cf6"/><path d="M280 310L390 130L520 310Z" fill="#eb775f"/></svg>')}`, []);

  useEffect(() => { projectRef.current = project; }, [project]);
  useEffect(() => { layoutRef.current = layout; }, [layout]);
  useEffect(() => { graphNodesRef.current = graphNodes; }, [graphNodes]);
  useEffect(() => { graphEdgesRef.current = graphEdges; }, [graphEdges]);
  useEffect(() => { saveStateRef.current = saveState; }, [saveState]);
  useEffect(() => { activeDocumentRef.current = activeDocument; }, [activeDocument]);

  useEffect(() => {
    const onToolResult = (event: Event) => { const payload = ((event as CustomEvent).detail as ToolResult<Bootstrap> | undefined)?.structuredContent; if (payload?.workspaceDir) setBootstrap(payload); };
    if (!standaloneDemo) { mcp.addEventListener("toolresult", onToolResult); void mcp.connect().then(() => mcp.requestDisplayMode?.({ mode: "fullscreen" })).catch((error) => setStatus(String(error))); }
    return () => mcp.removeEventListener("toolresult", onToolResult);
  }, [standaloneDemo]);

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
      const demoProject: Project = { id: "demo", title: "Research desk · Coffee culture", defaultViewId: "graph-default", graphRevision: 7, scenePackId: "free-brainstorming", scenePackVersion: "1.0.0" };
      const demoManifest: Manifest = { scenePack: { recommendedViews: ["graph", "canvas", "board"], nodeTypes: [{ key: "idea", label: "想法", defaultContentKind: "document", allowedContentKinds: ["document", "image", "link"] }, { key: "evidence", label: "证据", defaultContentKind: "document", allowedContentKinds: ["document", "image", "link"] }] } };
      const items: GraphNode[] = [
        { id: "article", projectId: "demo", type: "idea", title: "Why cafés became a third place", contentKind: "document", content: { kind: "document", mode: "article", markdown: "# Why cafés became a third place\n\nA working note about ritual, belonging, and urban life.", excerpt: "A working note about ritual, belonging, and urban life.", coverAssetId: "demo-image", embeddedAssetIds: [] }, assets: [{ id: "demo-image", width: 640, height: 420, mimeType: "image/png", thumbnailUri: "" }], properties: {}, archived: false, createdAt: timestamp, updatedAt: timestamp },
        { id: "image", projectId: "demo", type: "evidence", title: "Visual reference", contentKind: "image", content: { kind: "image", assetId: "demo-image", alt: "Abstract reference", caption: "A visual cue for the research" }, assets: [{ id: "demo-image", width: 640, height: 420, mimeType: "image/png", thumbnailUri: "" }], properties: {}, archived: false, createdAt: timestamp, updatedAt: timestamp },
        { id: "link", projectId: "demo", type: "evidence", title: "The social life of coffee", contentKind: "link", content: { kind: "link", url: "https://example.com/coffee", title: "The social life of coffee", description: "A source about cafés, cities, and informal gathering places.", domain: "example.com", enrichmentStatus: "ready" }, properties: {}, archived: false, createdAt: timestamp, updatedAt: timestamp },
      ];
      const demoLayout: Layout = { viewId: "graph-default", viewType: "graph", graphRevision: 7, layoutRevision: 4, nodes: { article: { nodeId: "article", x: 0, y: 30, width: 280, height: 160, pinned: true }, image: { nodeId: "image", x: 380, y: -80, width: 320, height: 240, pinned: false }, link: { nodeId: "link", x: 770, y: 80, width: 300, height: 180, pinned: false } } };
      previewCache.current = { "demo-image": demoImage }; setAssetPreviews(previewCache.current);
      setProject(demoProject); setManifest(demoManifest); setLayout(demoLayout); setGraphNodes(items); setActiveViewId(demoLayout.viewId);
      const demoEdges = [{ id: "e1", sourceNodeId: "article", targetNodeId: "image", type: "supported by" }, { id: "e2", sourceNodeId: "image", targetNodeId: "link", type: "source" }];
      setGraphEdges(demoEdges); setEdges(demoEdges.map((item) => ({ id: item.id, source: item.sourceNodeId, target: item.targetNodeId, label: item.type, type: "smoothstep" })));
      setStatus("Development preview · three content kinds"); return;
    }
    if (!bootstrap.workspaceDir) { setStatus("Open this widget from the Weaver Codex plugin, or provide ?workspaceDir=/path."); return; }
    setBusy(true);
    try {
      let projects = await callTool<Project[]>("weaver_list_projects", { workspaceDir: bootstrap.workspaceDir });
      if (!projects.length) projects = [await callTool<Project>("weaver_create_project", { workspaceDir: bootstrap.workspaceDir, title: "My knowledge space", goal: "Explore and organize ideas", scenePackId: "free-brainstorming" })];
      const active = projects.find((item) => item.id === bootstrap.projectId) ?? projects[0];
      const nextManifest = await callTool<Manifest>("weaver_get_project_manifest", { workspaceDir: bootstrap.workspaceDir, projectId: active.id });
      const viewId = activeViewId || active.defaultViewId;
      const graph = await callTool<{ project: Project; nodes: GraphNode[]; edges: GraphEdge[]; layout: Layout }>("weaver_get_project_graph", { workspaceDir: bootstrap.workspaceDir, projectId: active.id, viewId });
      setProject(graph.project); setManifest(nextManifest); setLayout(graph.layout); setGraphNodes(graph.nodes); setActiveViewId(graph.layout.viewId);
      setGraphEdges(graph.edges); setEdges(graph.edges.map((item) => ({ id: item.id, source: item.sourceNodeId, target: item.targetNodeId, label: item.type, type: "smoothstep" })));
      void hydratePreviews(graph.project.id, graph.nodes);
      setStatus(`${graph.nodes.length} nodes · graph r${graph.project.graphRevision} · layout r${graph.layout.layoutRevision}`);
    } catch (error) { setStatus(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }, [activeViewId, bootstrap, demoImage, hydratePreviews, setEdges, standaloneDemo]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!layout) return;
    setNodes(graphNodes.map((item, index) => {
      const frame = layout.nodes[item.id] ?? { x: (index % 4) * 300, y: Math.floor(index / 4) * 190, width: item.contentKind === "link" ? 300 : 280, height: 160, pinned: false };
      const coverId = item.content.kind === "document" ? item.content.coverAssetId : item.content.kind === "image" ? item.content.assetId : item.content.imageAssetId;
      const data: CardData = { title: item.title, semanticType: item.type, pinned: frame.pinned, contentKind: item.contentKind, excerpt: item.content.kind === "document" ? item.content.excerpt : undefined, imageSrc: coverId ? assetPreviews[coverId] : undefined, caption: item.content.kind === "image" ? item.content.caption : undefined, domain: item.content.kind === "link" ? item.content.domain : undefined, description: item.content.kind === "link" ? item.content.description : undefined, status: item.content.kind === "link" ? item.content.enrichmentStatus : undefined };
      return { id: item.id, type: item.contentKind, position: { x: frame.x, y: frame.y }, data, style: { width: frame.width, height: frame.height } };
    }));
  }, [assetPreviews, graphNodes, layout, setNodes]);

  const syncContext = useCallback(async () => {
    if (standaloneDemo || !project || !layout || !bootstrap.workspaceDir) return;
    sequence.current += 1;
    const timestamp = new Date().toISOString();
    try { await callTool("weaver_sync_canvas_context", { workspaceDir: bootstrap.workspaceDir, snapshot: { version: 1, canvasSessionId: sessionId.current, workspaceDir: bootstrap.workspaceDir, projectId: project.id, scenePackId: project.scenePackId, scenePackVersion: project.scenePackVersion, graphRevision: project.graphRevision, viewId: layout.viewId, viewType: layout.viewType, focusedNodeId: selection.length === 1 ? selection[0] : undefined, selectedNodeIds: selection, selectedEdgeIds: [], selectedGroupIds: [], pinnedContextNodeIds: nodes.filter((node) => Boolean((node.data as CardData).pinned)).map((node) => node.id), viewport: viewport.current, presence: { visible: !document.hidden, focused: document.hasFocus(), lastSeenAt: timestamp }, sequence: sequence.current, updatedAt: timestamp } }); }
    catch (error) { if (!(error instanceof Error) || !error.message.includes("STALE_CANVAS_SEQUENCE")) throw error; }
  }, [bootstrap.workspaceDir, layout, nodes, project, selection, standaloneDemo]);

  useEffect(() => { if (syncTimer.current) window.clearTimeout(syncTimer.current); syncTimer.current = window.setTimeout(() => void syncContext(), 250); return () => { if (syncTimer.current) window.clearTimeout(syncTimer.current); }; }, [syncContext]);

  useEffect(() => {
    if (standaloneDemo || !project || !layout) return;
    const heartbeat = window.setInterval(() => void syncContext(), 5_000);
    const syncPresence = () => void syncContext();
    window.addEventListener("focus", syncPresence); window.addEventListener("blur", syncPresence); document.addEventListener("visibilitychange", syncPresence);
    return () => { window.clearInterval(heartbeat); window.removeEventListener("focus", syncPresence); window.removeEventListener("blur", syncPresence); document.removeEventListener("visibilitychange", syncPresence); };
  }, [layout?.viewId, project?.id, standaloneDemo, syncContext]);

  async function continueMixedTask(task: AgentTask) {
    if (continuedTasks.current.has(task.taskId) || task.status !== "ready_to_continue") return;
    continuedTasks.current.add(task.taskId);
    try {
      const prompt = `[@weaver](plugin://weaver-next@personal) Continue Weaver mixed task with layout\n\nTask ID: ${task.taskId}\nProject ID: ${task.projectId}\nExpected graph revision: ${task.expectedGraphRevision}\n\nThe content ChangeSet has been applied. Use the weaver-layout-space skill to generate deterministic layout candidates for the updated graph.`;
      await mcp.sendMessage({ role: "user", content: [{ type: "text", text: prompt }] });
      await callTool("weaver_mark_task_dispatched", { workspaceDir: bootstrap.workspaceDir, taskId: task.taskId });
      setStatus("Content applied · layout stage sent to coding agent");
    } catch (error) {
      continuedTasks.current.delete(task.taskId);
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  async function handleTaskUpdate(task: AgentTask) {
    setActiveTaskId(task.taskId);
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
    if (task.status === "ready_to_continue" && task.intent === "develop_then_layout") void continueMixedTask(task);
    if (task.status === "stale") { setStaleTask(task); setChangePreview((current) => current ? { ...current, stale: true } : current); }
    if (["completed", "failed", "cancelled", "stale"].includes(task.status)) setActiveTaskId(null);
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
    setEdges(next.edges.map((item) => ({ id: item.id, source: item.sourceNodeId, target: item.targetNodeId, label: item.type, type: "smoothstep" })));
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
        const recoverableTasks = await callTool<AgentTask[]>("weaver_list_project_tasks", { workspaceDir: bootstrap.workspaceDir, projectId: project.id });
        for (const task of recoverableTasks.reverse()) await handleTaskUpdate(task);
        if (disposed) return;
        lastEventSequence.current = Math.max(lastEventSequence.current, grant.currentSequence);
        const source = new EventSource(grant.eventStreamUrl); stream.current?.close(); stream.current = source;
        source.onopen = () => { setStreamState("online"); setStatus((current) => current.includes("Agent task") ? current : "Live sync connected"); };
        source.onerror = () => { setStreamState("offline"); setStatus("Live sync disconnected · reconnecting…"); };
        for (const kind of ["task.updated", "graph.changed", "layout.changed", "stream.reset"] as const) source.addEventListener(kind, (message) => {
          try { handleProjectEvent(JSON.parse((message as MessageEvent).data) as ProjectEvent); }
          catch (error) { setStatus(`Invalid live event · ${error instanceof Error ? error.message : String(error)}`); }
        });
      } catch (error) { if (!disposed) { setStreamState("offline"); setStatus(error instanceof Error ? error.message : String(error)); } }
    })();
    return () => { disposed = true; stream.current?.close(); stream.current = null; };
  }, [bootstrap.workspaceDir, project?.id, layout?.viewId, standaloneDemo, streamGeneration]);

  async function dispatchAgentTask(intent: TaskIntent, userInstruction: string) {
    if (!userInstruction.trim() || !project || !layout) return;
    if (standaloneDemo) { setStatus("Open through the Codex plugin to send this agent task."); return; }
    setBusy(true);
    try {
      if (saveState === "dirty") await saveDocument();
      await syncContext();
      const task = await callTool<AgentTask>("weaver_prepare_agent_task", { workspaceDir: bootstrap.workspaceDir, canvasSessionId: sessionId.current, actionKey: intent, userInstruction: userInstruction.trim() });
      const skill = intent === "layout_view" ? "weaver-layout-space" : "weaver-develop-space";
      const instructionText = intent === "develop_then_layout" ? "First submit a content ChangeSet. After it is reviewed and applied, Weaver will ask you to continue with layout." : intent === "layout_view" ? "Generate a LayoutPlan; never invent final coordinates." : "Submit an auditable content ChangeSet; never write storage directly.";
      const prompt = `[@weaver](plugin://weaver-next@personal) Work on the current Weaver canvas\n\nTask ID: ${task.taskId}\nProject ID: ${project.id}\nIntent: ${intent}\nExpected graph revision: ${project.graphRevision}\nExpected layout revision: ${layout.layoutRevision}\n\nUser instruction:\n${userInstruction.trim()}\n\nUse the ${skill} skill. ${instructionText}`;
      await mcp.sendMessage({ role: "user", content: [{ type: "text", text: prompt }] });
      await callTool("weaver_mark_task_dispatched", { workspaceDir: bootstrap.workspaceDir, taskId: task.taskId });
      setActiveTaskId(task.taskId); setInstruction(""); setStaleTask(null); setStatus("Task sent to coding agent");
    }
    catch (error) { setStatus(error instanceof Error ? error.message : String(error)); } finally { setBusy(false); }
  }

  async function sendAgentTask() { await dispatchAgentTask(taskIntent, instruction); }
  async function regenerateStaleTask() { if (!staleTask) return; setChangePreview(null); setCandidates([]); setLayoutRunId(null); await dispatchAgentTask(staleTask.intent, staleTask.userInstruction ?? "Regenerate this task from the latest canvas state"); }

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

  async function saveDocument() {
    if (!activeDocument || !draft || !project || activeDocument.content.kind !== "document" || saveState === "saving") return;
    const content: DocumentContent = { kind: "document", mode: activeDocument.content.mode, markdown: draft.markdown, excerpt: excerpt(draft.markdown), coverAssetId: draft.coverAssetId, embeddedAssetIds: draft.embeddedAssetIds };
    if (standaloneDemo) { const updated = { ...activeDocument, title: draft.title, type: draft.semanticType, content, updatedAt: new Date().toISOString() }; setActiveDocument(updated); setGraphNodes((current) => current.map((node) => node.id === updated.id ? updated : node)); setProject({ ...project, graphRevision: project.graphRevision + 1 }); setSaveState("saved"); return; }
    setSaveState("saving");
    try { const output = await callTool<any>("weaver_update_node_content", { workspaceDir: bootstrap.workspaceDir, projectId: project.id, nodeId: activeDocument.id, baseGraphRevision: project.graphRevision, title: draft.title, semanticType: draft.semanticType, content }); setProject(output.project); setActiveDocument(output.node); setGraphNodes((current) => current.map((node) => node.id === output.node.id ? { ...node, title: output.node.title, type: output.node.type, content: { ...output.node.content, markdown: undefined } } : node)); setSaveState("saved"); setStatus(`Article saved · graph r${output.project.graphRevision}`); }
    catch (error) { const message = error instanceof Error ? error.message : String(error); setSaveState(message.includes("GRAPH_REVISION_CONFLICT") ? "conflict" : "dirty"); setStatus(message); }
  }

  useEffect(() => { if (saveState !== "dirty" || !draft) return; const timer = window.setTimeout(() => void saveDocument(), 800); return () => window.clearTimeout(timer); }, [draft, saveState]);

  function editDraft(patch: Partial<EditorDraft>) { setDraft((current) => current ? { ...current, ...patch } : current); setSaveState("dirty"); }
  function formatMarkdown(prefix: string, suffix = "") { const textarea = editorTextArea.current; if (!textarea || !draft) return; const start = textarea.selectionStart; const end = textarea.selectionEnd; const selected = draft.markdown.slice(start, end); editDraft({ markdown: `${draft.markdown.slice(0, start)}${prefix}${selected}${suffix}${draft.markdown.slice(end)}` }); requestAnimationFrame(() => { textarea.focus(); textarea.setSelectionRange(start + prefix.length, end + prefix.length); }); }

  async function switchView(viewType: string) { if (!project || viewType === layout?.viewType) return; if (standaloneDemo) { setStatus(`Development preview · ${viewType} projection`); return; } setBusy(true); try { const next = await callTool<Layout>("weaver_get_or_create_view", { workspaceDir: bootstrap.workspaceDir, projectId: project.id, viewType }); setCandidates([]); setLayoutRunId(null); setActiveViewId(next.viewId); } catch (error) { setStatus(error instanceof Error ? error.message : String(error)); } finally { setBusy(false); } }

  const displayedNodes = useMemo(() => { const candidate = candidates[candidateIndex]; if (!candidate) return nodes; return nodes.map((node) => ({ ...node, position: { x: candidate.document.nodes[node.id]?.x ?? node.position.x, y: candidate.document.nodes[node.id]?.y ?? node.position.y } })); }, [candidateIndex, candidates, nodes]);
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
      <div className="brand"><span>W</span><div><strong>{project?.title ?? "Weaver"}</strong><small>{status}</small></div></div>
      <nav className="view-tabs" aria-label="Project views">{manifest?.scenePack.recommendedViews.map((view) => <button key={view} data-active={layout?.viewType === view} onClick={() => void switchView(view)} disabled={busy}>{view}</button>)}</nav>
      <div className="top-actions">
        <button className="stream-status" data-state={streamState} onClick={() => streamState === "offline" && setStreamGeneration((value) => value + 1)} title={streamState === "offline" ? "Reconnect live sync" : "SSE live sync status"}><span /> {streamState === "online" ? "Live" : streamState === "connecting" ? "Connecting" : "Reconnect"}</button>
        <div className="create-anchor"><button className="create-button" onClick={() => { setCreateMenu(!createMenu); setLinkComposer(false); }}><Plus size={15} /> Create</button>
          {createMenu ? <div className="create-menu" role="menu"><button onClick={() => void createArticle()}><FileText size={17} /><span><strong>Article</strong><small>Write in the side editor</small></span></button><button onClick={() => chooseImage("node")}><ImagePlus size={17} /><span><strong>Image</strong><small>Upload or paste</small></span></button><button onClick={() => setLinkComposer(true)}><Link2 size={17} /><span><strong>Link</strong><small>Save a rich preview</small></span></button>{linkComposer ? <div className="link-composer"><label htmlFor="link-url">Public URL</label><input id="link-url" value={linkUrl} onChange={(event) => setLinkUrl(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void createLink(); }} placeholder="https://…" autoFocus /><button onClick={() => void createLink()} disabled={!linkUrl.trim() || busy}>Create link</button></div> : null}</div> : null}
        </div>
        <button onClick={() => void togglePinned()} disabled={!selection.length || standaloneDemo}>{selection.some((id) => layout?.nodes[id]?.pinned) ? <Unlock size={15} /> : <Lock size={15} />} {selection.some((id) => layout?.nodes[id]?.pinned) ? "Unpin" : "Pin"}</button>
        <button onClick={revertLayout} disabled={busy || standaloneDemo}><RotateCcw size={15} /> Undo layout</button>
      </div>
    </header>
    <section className="workspace-stage">
      <section className="canvas-wrap" onWheelCapture={handleCanvasWheel}>
        <ReactFlow nodes={displayedNodes} edges={edges} nodeTypes={nodeTypes} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
          nodesDraggable elementsSelectable nodeDragThreshold={1} selectNodesOnDrag
          panOnDrag panOnScroll panOnScrollMode={PanOnScrollMode.Free} panOnScrollSpeed={0.72} panActivationKeyCode="Space"
          zoomOnScroll={false} zoomOnPinch zoomOnDoubleClick={false} selectionOnDrag={false} selectionMode={SelectionMode.Partial} selectionKeyCode="Shift"
          autoPanOnNodeDrag autoPanOnConnect autoPanOnSelection autoPanSpeed={18}
          onMove={(_event, nextViewport) => { viewport.current = nextViewport; }} onMoveEnd={(_event, nextViewport) => { viewport.current = nextViewport; void syncContext(); }}
          onNodeDrag={handleNodeDrag} onNodeDragStart={(_event, node) => { draggingNodeId.current = node.id; setStatus("Moving node…"); }} onNodeDragStop={(_event, node) => { draggingNodeId.current = null; void persistNodeFrame(node); }} onNodeDoubleClick={(_event, node) => void openDocument(node.id)} onSelectionChange={handleSelectionChange}
          fitView fitViewOptions={{ padding: 0.18, maxZoom: 1.15 }} minZoom={0.05} maxZoom={4}>
          <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#cdd1ca" /><Controls showInteractive={false} /><MiniMap pannable zoomable nodeColor={(node) => node.type === "image" ? "#eb775f" : node.type === "link" ? "#282d28" : "#315cf6"} />
        </ReactFlow>
        <div className="canvas-gesture-hint"><span>Drag canvas</span><span>Scroll to pan</span><span>⌘/Ctrl + scroll to zoom</span><span>Shift to select</span></div>
        <div className="layout-composer"><div className="composer-label"><Sparkles size={13} /> CODING AGENT <div className="intent-tabs">{([['develop_selection', '内容'], ['layout_view', '布局'], ['develop_then_layout', '内容 + 布局']] as Array<[TaskIntent, string]>).map(([intent, label]) => <button key={intent} data-active={taskIntent === intent} onClick={() => setTaskIntent(intent)}>{label}</button>)}</div></div><div className="composer-row"><LayoutTemplate size={19} /><input value={instruction} onChange={(event) => setInstruction(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void sendAgentTask(); }} placeholder={taskIntent === "layout_view" ? "按主题分组，主结论放中间，不移动固定节点…" : "围绕选中的节点补充内容和关系…"} /><button onClick={() => void sendAgentTask()} disabled={busy || !instruction.trim()}>{busy ? <Loader2 className="spin" size={16} /> : <GitBranch size={16} />} Ask agent</button></div></div>
        {changePreview ? <aside className="candidate-panel changeset-panel"><div><strong>Content preview</strong><small>{changePreview.changeSet.riskLevel} risk</small></div><h3>{changePreview.changeSet.rationale || "Agent changes"}</h3><p>+{changePreview.summary.addedNodes} nodes · {changePreview.summary.updatedNodes} updated · +{changePreview.summary.addedEdges} relations · {changePreview.summary.layoutOperations} layout ops</p>{changePreview.stale ? <p className="stale-warning">This proposal is stale and cannot be applied.</p> : null}<div className="candidate-actions"><button onClick={() => void rejectChangeSet()}><X size={14} /> Reject</button>{changePreview.stale ? <button className="apply" onClick={() => void regenerateStaleTask()}><RotateCcw size={14} /> Regenerate</button> : <button className="apply" onClick={() => void applyChangeSet()}><Check size={15} /> Apply all</button>}</div></aside> : null}
        {candidates.length ? <aside className="candidate-panel"><div><strong>Layout preview</strong><small>{candidateIndex + 1} / {candidates.length}</small></div><h3>{candidates[candidateIndex].label}</h3><p>Score {candidates[candidateIndex].metrics.score.toFixed(1)} · {candidates[candidateIndex].metrics.edgeCrossings} crossings</p><div className="candidate-actions"><button onClick={() => void rejectLayout()}><X size={14} /> Reject</button><button onClick={() => setCandidateIndex((candidateIndex + 1) % candidates.length)}>Next option</button><button className="apply" onClick={() => void applyCandidate()}><Check size={15} /> Apply</button></div></aside> : null}
        {staleTask && !changePreview && !candidates.length ? <aside className="candidate-panel changeset-panel"><div><strong>Task is stale</strong><small>{staleTask.error?.code}</small></div><p>{staleTask.error?.message ?? "The canvas changed while the task was running."}</p><div className="candidate-actions"><button className="apply" onClick={() => void regenerateStaleTask()}><RotateCcw size={14} /> Regenerate from latest</button></div></aside> : null}
      </section>
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
