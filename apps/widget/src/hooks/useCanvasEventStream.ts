import { useEffect, useRef, useState } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { callTool } from "../mcp-client";
import { applyGraphDelta, applyLayoutOperations, applyViewCatalogDelta, type GraphDelta, type LayoutOperation } from "../sync";
import type { AgentTask, Bootstrap, Candidate, ChangeSetPreview, ChatBindingBootstrap, GraphEdge, GraphNode, Layout, Manifest, Project, ProjectEvent, ProjectView } from "../types";

// Domain D: SSE stream + task/changeset/candidate lifecycle. The largest, most self-contained
// domain — owns the EventSource connection, live task/changeset/layout-candidate state, and
// reconciles server-pushed graph/layout/view-catalog deltas via sync.ts.
export function useCanvasEventStream(params: {
  standaloneDemo: boolean;
  bootstrap: Bootstrap;
  project: Project | null;
  layout: Layout | null;
  setProject: Dispatch<SetStateAction<Project | null>>;
  setLayout: Dispatch<SetStateAction<Layout | null>>;
  setGraphNodes: Dispatch<SetStateAction<GraphNode[]>>;
  setGraphEdges: Dispatch<SetStateAction<GraphEdge[]>>;
  setManifest: Dispatch<SetStateAction<Manifest | null>>;
  setStatus: Dispatch<SetStateAction<string>>;
  setBusy: Dispatch<SetStateAction<boolean>>;
  setBootstrap: Dispatch<SetStateAction<Bootstrap>>;
  projectRef: MutableRefObject<Project | null>;
  layoutRef: MutableRefObject<Layout | null>;
  graphNodesRef: MutableRefObject<GraphNode[]>;
  graphEdgesRef: MutableRefObject<GraphEdge[]>;
  bindingRef: MutableRefObject<ChatBindingBootstrap | undefined>;
  load: () => Promise<void>;
  hydratePreviews: (projectId: string, items: GraphNode[]) => Promise<void>;
  syncContext: () => Promise<void>;
  saveStateRef: MutableRefObject<"saved" | "dirty" | "saving" | "conflict">;
  activeDocumentRef: MutableRefObject<GraphNode | null>;
  setSaveState: Dispatch<SetStateAction<"saved" | "dirty" | "saving" | "conflict">>;
  draggingNodeId: MutableRefObject<string | null>;
  projectViewsRef: MutableRefObject<ProjectView[]>;
  setProjectViews: Dispatch<SetStateAction<ProjectView[]>>;
  setViewToast: Dispatch<SetStateAction<{ message: string; undoViewId?: string } | null>>;
  setActiveViewId: Dispatch<SetStateAction<string>>;
  sessionId: MutableRefObject<string>;
  stream: MutableRefObject<EventSource | null>;
}) {
  const { standaloneDemo, bootstrap, project, layout, setProject, setLayout, setGraphNodes, setGraphEdges, setManifest, setStatus, setBusy, setBootstrap, projectRef, layoutRef, graphNodesRef, graphEdgesRef, bindingRef, load, hydratePreviews, syncContext, saveStateRef, activeDocumentRef, setSaveState, draggingNodeId, projectViewsRef, setProjectViews, setViewToast, setActiveViewId, sessionId, stream } = params;

  const [streamState, setStreamState] = useState<"connecting" | "online" | "offline">("connecting");
  const [streamGeneration, setStreamGeneration] = useState(0);
  const [layoutRunId, setLayoutRunId] = useState<string | null>(null);
  const [activeTask, setActiveTask] = useState<AgentTask | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [changePreview, setChangePreview] = useState<ChangeSetPreview | null>(null);
  const [staleTask, setStaleTask] = useState<AgentTask | null>(null);
  const [candidateIndex, setCandidateIndex] = useState(0);
  const lastEventSequence = useRef(0);

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

  function resetLayoutRun() { setCandidates([]); setLayoutRunId(null); }
  function reconnect() { setStreamGeneration((value) => value + 1); }

  return { streamState, streamGeneration, activeTask, candidates, changePreview, staleTask, candidateIndex, setCandidateIndex, layoutRunId, handleTaskUpdate, cancelActiveTask, applyChangeSet, rejectChangeSet, applyCandidate, rejectLayout, revertLayout, resetLayoutRun, reconnect };
}
