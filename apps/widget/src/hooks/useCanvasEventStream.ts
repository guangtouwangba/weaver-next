import { useCallback, useEffect, useRef, useState } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { callTool, hostMode, isLocalDevelopment } from "../mcp-client";
import { applyGraphDelta, applyLayoutOperations, applyViewCatalogDelta, type GraphDelta, type LayoutOperation } from "../sync";
import type { AgentTask, Bootstrap, Candidate, CanvasAccessState, ChangeSetPreview, ChatBindingBootstrap, GraphEdge, GraphNode, Layout, Manifest, Project, ProjectEvent, ProjectView } from "../types";

// Domain D: SSE stream + task/changeset/candidate lifecycle. The largest, most self-contained
// domain — owns the EventSource connection, live task/changeset/layout-candidate state, and
// reconciles server-pushed graph/layout/view-catalog deltas via sync.ts.
export function useCanvasEventStream(params: {
  authority: { standaloneDemo: boolean; bootstrap: Bootstrap; project: Project | null; layout: Layout | null; accessState: CanvasAccessState };
  state: { setProject: Dispatch<SetStateAction<Project | null>>; setLayout: Dispatch<SetStateAction<Layout | null>>; setGraphNodes: Dispatch<SetStateAction<GraphNode[]>>; setGraphEdges: Dispatch<SetStateAction<GraphEdge[]>>; setManifest: Dispatch<SetStateAction<Manifest | null>>; setStatus: Dispatch<SetStateAction<string>>; setBusy: Dispatch<SetStateAction<boolean>>; setBootstrap: Dispatch<SetStateAction<Bootstrap>>; setSaveState: Dispatch<SetStateAction<"saved" | "dirty" | "saving" | "conflict">>; setProjectViews: Dispatch<SetStateAction<ProjectView[]>>; setViewToast: Dispatch<SetStateAction<{ message: string; undoViewId?: string } | null>>; setActiveViewId: Dispatch<SetStateAction<string>>; setAccessState: Dispatch<SetStateAction<CanvasAccessState>> };
  refs: { projectRef: MutableRefObject<Project | null>; layoutRef: MutableRefObject<Layout | null>; graphNodesRef: MutableRefObject<GraphNode[]>; graphEdgesRef: MutableRefObject<GraphEdge[]>; bindingRef: MutableRefObject<ChatBindingBootstrap | undefined>; saveStateRef: MutableRefObject<"saved" | "dirty" | "saving" | "conflict">; activeDocumentRef: MutableRefObject<GraphNode | null>; draggingNodeId: MutableRefObject<string | null>; projectViewsRef: MutableRefObject<ProjectView[]>; sessionId: MutableRefObject<string>; stream: MutableRefObject<EventSource | null> };
  effects: { load: () => Promise<void>; hydratePreviews: (projectId: string, items: GraphNode[]) => Promise<void>; syncContext: () => Promise<boolean | undefined>; openNodeViewer: (nodeId: string) => void | Promise<void> };
}) {
  const { standaloneDemo, bootstrap, project, layout, accessState } = params.authority;
  const { setProject, setLayout, setGraphNodes, setGraphEdges, setManifest, setStatus, setBusy, setBootstrap, setSaveState, setProjectViews, setViewToast, setActiveViewId, setAccessState } = params.state;
  const { projectRef, layoutRef, graphNodesRef, graphEdgesRef, bindingRef, saveStateRef, activeDocumentRef, draggingNodeId, projectViewsRef, sessionId, stream } = params.refs;
  const { load, hydratePreviews, syncContext, openNodeViewer } = params.effects;

  // "polling" is the Codex live path: the native panel's sandboxed iframe cannot
  // hold an EventSource to the loopback /events (SSE fails there even though plain
  // fetch to /mcp-rpc works), so Codex never opens one — it polls over the proven
  // fetch path instead. It is a healthy "Live" state, not a degraded one.
  const [streamState, setStreamState] = useState<"connecting" | "online" | "offline" | "polling">("connecting");
  const [streamGeneration, setStreamGeneration] = useState(0);
  const [layoutRunId, setLayoutRunId] = useState<string | null>(null);
  const [activeTask, setActiveTask] = useState<AgentTask | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [changePreview, setChangePreview] = useState<ChangeSetPreview | null>(null);
  const [staleTask, setStaleTask] = useState<AgentTask | null>(null);
  const [candidateIndex, setCandidateIndex] = useState(0);
  const lastEventSequence = useRef(0);
  const polledTaskRevs = useRef<Map<string, number>>(new Map());
  const streamReconnectAttempts = useRef(0);

  const reconcileRevisions = useCallback(async () => {
    if (isLocalDevelopment) return;
    if (!bootstrap.workspaceDir || !projectRef.current || !layoutRef.current) return;
    const bound = await callTool<{ projectId: string; viewId: string; canvasSessionId: string; bindingStatus: string; graphRevision: number; layoutRevision: number }>("weaver_read_session", { resource: "bound_canvas", workspaceDir: bootstrap.workspaceDir });
    if (bound.bindingStatus !== "active" || bound.canvasSessionId !== sessionId.current) {
      stream.current?.close(); setAccessState("detached"); setStatus("Detached. This Chat is now attached to another Canvas"); return;
    }
    const currentProject = projectRef.current; const currentLayout = layoutRef.current;
    if (bound.projectId !== currentProject.id || bound.viewId !== currentLayout.viewId || bound.graphRevision > currentProject.graphRevision || bound.layoutRevision > currentLayout.layoutRevision) {
      setStatus("Server revision changed · refreshing canvas"); await load();
    }
  }, [bootstrap.workspaceDir, load, projectRef, layoutRef, sessionId, setAccessState, setStatus, stream]);

  async function handleTaskUpdate(task: AgentTask) {
    setActiveTask(task);
    setStatus(`Agent task · ${task.status.replaceAll("_", " ")}`);
    const changeSetId = task.results?.changeSetId;
    if (task.status === "pending_review" && task.activeStage === "content" && changeSetId) {
      try { setChangePreview(await callTool<ChangeSetPreview>("weaver_review_action", { resource: "changeset", action: "preview", id: changeSetId, workspaceDir: bootstrap.workspaceDir })); }
      catch (error) { setStatus(error instanceof Error ? error.message : String(error)); }
    }
    const nextLayoutRunId = task.results?.layoutRunId;
    if (task.status === "pending_review" && task.activeStage === "layout" && nextLayoutRunId && nextLayoutRunId !== layoutRunId) {
      try { const run = await callTool<{ id: string; candidates: Candidate[] }>("weaver_review_action", { resource: "layout_run", action: "preview", id: nextLayoutRunId, workspaceDir: bootstrap.workspaceDir }); setLayoutRunId(run.id); setCandidates(run.candidates); setCandidateIndex(0); }
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
    else if (event.kind === "view.created") void (async () => { if (!projectRef.current) return; const next = await callTool<Manifest>("weaver_read_graph", { resource: "manifest", workspaceDir: bootstrap.workspaceDir, projectId: projectRef.current.id }); setManifest(next); })();
    else if (event.kind === "chat.binding.changed" && event.payload?.status === "detached" && (event.payload.reason === "CANVAS_TAKEN_OVER" || Number(event.payload.bindingRevision) > Number(bindingRef.current?.bindingRevision ?? 0))) {
      if (event.payload.reason === "VIEW_TRASHED" && bindingRef.current && event.payload.fallbackViewId) {
        const nextBinding = { ...bindingRef.current, bindingRevision: Number(event.payload.bindingRevision), viewId: String(event.payload.fallbackViewId) };
        bindingRef.current = nextBinding; setBootstrap((current) => ({ ...current, chatBinding: nextBinding })); setActiveViewId(nextBinding.viewId!); setViewToast({ message: "The current View was moved to Recycle Bin" });
      } else { stream.current?.close(); setStreamState("offline"); setAccessState("detached"); setStatus("Detached. This Chat is now attached to another Canvas"); }
    }
    else if (event.kind === "stream.reset") void load();
  }

  useEffect(() => {
    if (standaloneDemo || accessState !== "active" || !project?.id || !layout?.viewId || !bootstrap.workspaceDir) return;
    let disposed = false;
    let reconnectTimer: number | undefined;
    setStreamState("connecting");
    void (async () => {
      try {
        await syncContext();
        await reconcileRevisions();
        const recoverableTasks = await callTool<AgentTask[]>("weaver_read_session", { resource: "canvas_tasks", workspaceDir: bootstrap.workspaceDir, canvasSessionId: sessionId.current });
        for (const task of recoverableTasks.reverse()) await handleTaskUpdate(task);
        if (disposed) return;
        // Codex: no EventSource — the sandbox can't reach the loopback SSE. Enter
        // the polling live state (the effect below drives it) with an honest status.
        if (hostMode === "codex") { setStreamState("polling"); setStatus((current) => current.includes("Agent task") ? current : "实时同步已连接（轮询）"); return; }
        const grant = await callTool<{ eventStreamUrl: string; currentSequence: number }>("weaver_subscribe_canvas", { workspaceDir: bootstrap.workspaceDir, projectId: project.id, canvasSessionId: sessionId.current });
        lastEventSequence.current = Math.max(lastEventSequence.current, grant.currentSequence);
        const source = new EventSource(grant.eventStreamUrl); stream.current?.close(); stream.current = source;
        source.onopen = () => { streamReconnectAttempts.current = 0; setStreamState("online"); setStatus((current) => current.includes("Agent task") ? current : "Live sync connected"); };
        source.onerror = () => {
          if (disposed) return;
          source.close();
          setStreamState("offline"); setStatus("Live sync disconnected · reconnecting…");
          const delays = [250, 1_000, 3_000, 5_000];
          const delay = delays[Math.min(streamReconnectAttempts.current, delays.length - 1)];
          streamReconnectAttempts.current += 1;
          reconnectTimer = window.setTimeout(() => { if (!disposed) setStreamGeneration((value) => value + 1); }, delay);
        };
        for (const kind of ["task.updated", "graph.changed", "layout.changed", "view.created", "view.catalog.changed", "chat.binding.changed", "stream.reset"] as const) source.addEventListener(kind, (message) => {
          try { handleProjectEvent(JSON.parse((message as MessageEvent).data) as ProjectEvent); }
          catch (error) { setStatus(`Invalid live event · ${error instanceof Error ? error.message : String(error)}`); }
        });
        // Development-only: the MCP process pushes this when the widget bundle is rebuilt.
        source.addEventListener("widget.reload", () => location.reload());
      } catch (error) { if (!disposed) { setStreamState("offline"); setStatus(error instanceof Error ? error.message : String(error)); } }
    })();
    return () => { disposed = true; if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer); stream.current?.close(); stream.current = null; };
  }, [accessState, bootstrap.workspaceDir, project?.id, layout?.viewId, reconcileRevisions, standaloneDemo, streamGeneration]);

  useEffect(() => {
    if (standaloneDemo || accessState !== "active") return;
    const reconcile = () => { if (!document.hidden) void reconcileRevisions(); };
    window.addEventListener("focus", reconcile);
    document.addEventListener("visibilitychange", reconcile);
    return () => { window.removeEventListener("focus", reconcile); document.removeEventListener("visibilitychange", reconcile); };
  }, [accessState, reconcileRevisions, standaloneDemo]);

  // Codex live-update fallback. The embedded ui:// widget calls tools over the
  // Apps-SDK proxy (callServerTool), but the loopback SSE (/events) may be
  // unreachable from that sandboxed iframe. When the stream isn't online in Codex,
  // poll for graph/task/ChangeSet changes over the (working) proxy path so agent
  // ChangeSets still surface. Only runs while active AND the SSE is not online, so
  // it costs nothing when SSE works or the canvas is idle/detached.
  useEffect(() => {
    if (standaloneDemo || hostMode !== "codex" || accessState !== "active" || streamState === "online") return;
    if (!bootstrap.workspaceDir || !project?.id) return;
    let stopped = false;
    const tick = async () => {
      if (stopped) return;
      try {
        await reconcileRevisions();
        const tasks = await callTool<AgentTask[]>("weaver_read_session", { resource: "canvas_tasks", workspaceDir: bootstrap.workspaceDir, canvasSessionId: sessionId.current });
        for (const task of tasks) {
          if (polledTaskRevs.current.get(task.taskId) === task.taskRevision) continue;
          polledTaskRevs.current.set(task.taskId, task.taskRevision);
          await handleTaskUpdate(task);
        }
      } catch { /* transient proxy hiccup; next tick retries */ }
    };
    // Poll fast while a task is in flight (a ChangeSet may land any second), calm
    // when idle (just catching external edits). These are local loopback calls —
    // zero model tokens — but the slower idle cadence keeps logs and CPU quiet.
    const id = window.setInterval(() => void tick(), activeTask ? 3500 : 10000);
    void tick();
    return () => { stopped = true; window.clearInterval(id); };
  }, [standaloneDemo, accessState, streamState, bootstrap.workspaceDir, project?.id, reconcileRevisions, Boolean(activeTask)]);

  async function cancelActiveTask() { if (!activeTask) return; const taskId = activeTask.taskId; try { await callTool("weaver_task_action", { action: "cancel", workspaceDir: bootstrap.workspaceDir, taskId }); setActiveTask((current) => (current?.taskId === taskId ? null : current)); setStatus("Agent task cancelled · later writes will be rejected"); } catch (error) { setStatus(`取消失败,请重试:${error instanceof Error ? error.message : String(error)}`); } }

  async function applyChangeSet() {
    if (!changePreview) return;
    const changeSet = changePreview.changeSet;
    setBusy(true);
    try {
      await callTool("weaver_review_action", { resource: "changeset", action: "apply", id: changeSet.id, workspaceDir: bootstrap.workspaceDir });
      setChangePreview(null);
      // A ChangeSet often expands a node's *body*, which is invisible on the
      // small card face — so tell the user what changed and open the node so the
      // new content is actually visible, otherwise Apply feels like a no-op.
      const contentNodeIds = [...new Set(changeSet.graphOperations.flatMap((op) =>
        op.type === "set-node-content" || op.type === "update-node" ? [op.nodeId as string] : op.type === "add-node" ? [op.node.id as string] : []))];
      const titleOf = (id: string) => graphNodesRef.current.find((node) => node.id === id)?.title ?? "节点";
      if (contentNodeIds.length === 1) {
        setViewToast({ message: `已更新「${titleOf(contentNodeIds[0])}」，已展开该节点` });
        void openNodeViewer(contentNodeIds[0]);
      } else if (contentNodeIds.length > 1) {
        setViewToast({ message: `已更新 ${contentNodeIds.length} 个节点，包括「${titleOf(contentNodeIds[0])}」` });
      } else {
        setViewToast({ message: "改动已应用到画布" });
      }
    } catch (error) { setStatus(error instanceof Error ? error.message : String(error)); } finally { setBusy(false); }
  }
  async function rejectChangeSet() { if (!changePreview) return; setBusy(true); try { await callTool("weaver_review_action", { resource: "changeset", action: "reject", id: changePreview.changeSet.id, workspaceDir: bootstrap.workspaceDir }); setChangePreview(null); } catch (error) { setStatus(error instanceof Error ? error.message : String(error)); } finally { setBusy(false); } }
  async function applyCandidate() { const candidate = candidates[candidateIndex]; if (!candidate || !layoutRunId) return; setBusy(true); try { await callTool("weaver_review_action", { resource: "layout_run", action: "apply", id: layoutRunId, workspaceDir: bootstrap.workspaceDir, candidateId: candidate.id }); setCandidates([]); setLayoutRunId(null); } catch (error) { setStatus(error instanceof Error ? error.message : String(error)); } finally { setBusy(false); } }
  async function rejectLayout() { if (!layoutRunId) return; setBusy(true); try { await callTool("weaver_review_action", { resource: "layout_run", action: "reject", id: layoutRunId, workspaceDir: bootstrap.workspaceDir }); setCandidates([]); setLayoutRunId(null); } catch (error) { setStatus(error instanceof Error ? error.message : String(error)); } finally { setBusy(false); } }
  async function revertLayout() { if (!project || !layout || standaloneDemo) return; setBusy(true); try { await callTool("weaver_canvas_action", { action: "revert_layout", workspaceDir: bootstrap.workspaceDir, projectId: project.id, viewId: layout.viewId }); } catch (error) { setStatus(error instanceof Error ? error.message : String(error)); } finally { setBusy(false); } }

  function resetLayoutRun() { setCandidates([]); setLayoutRunId(null); }
  function reconnect() { setStreamGeneration((value) => value + 1); }

  return { streamState, streamGeneration, activeTask, candidates, changePreview, staleTask, candidateIndex, setCandidateIndex, layoutRunId, handleTaskUpdate, cancelActiveTask, applyChangeSet, rejectChangeSet, applyCandidate, rejectLayout, revertLayout, resetLayoutRun, reconnect };
}
