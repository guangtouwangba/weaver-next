import { useCallback, useEffect, useRef, useState } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type { CanvasNode as Node, CanvasViewport as Viewport } from "../lib/canvas-model";
import { callTool, hostMode, isLocalDevelopment, takeOverRuntimeProject } from "../mcp-client";
import type { Bootstrap, CanvasAccessState, CardData, ChatBindingBootstrap, Layout, Project } from "../types";
import { acknowledgedCanvasSequence, canvasAccessFromError, hasWidgetBuildMismatch } from "../canvas-access";
import { createCanvasSyncQueue, loadCanvasSequence, persistCanvasSequence, reserveCanvasSequence } from "../lib/canvas-session";

// Domain C: canvas selection/viewport sync to server (debounced context sync + heartbeat).
export function useCanvasBindingSync(params: {
  standaloneDemo: boolean;
  project: Project | null;
  layout: Layout | null;
  bootstrap: Bootstrap;
  bindingRef: MutableRefObject<ChatBindingBootstrap | undefined>;
  setStatus: Dispatch<SetStateAction<string>>;
  selection: string[];
  anchorNodeId?: string;
  nodes: Node[];
  viewport: MutableRefObject<Viewport>;
  sessionId: MutableRefObject<string>;
  stream: MutableRefObject<EventSource | null>;
  pendingInitialFitView: MutableRefObject<string | null>;
  pendingViewportRestore: MutableRefObject<{ viewId: string; viewport: Viewport } | null>;
}) {
  const { standaloneDemo, project, layout, bootstrap, bindingRef, setStatus, selection, anchorNodeId, nodes, viewport, sessionId, stream, pendingInitialFitView, pendingViewportRestore } = params;
  const sequence = useRef(loadCanvasSequence());
  const syncQueue = useRef(createCanvasSyncQueue());
  const syncTimer = useRef<number | null>(null);
  const buildMismatch = hasWidgetBuildMismatch(bootstrap, window.__weaverEmbeddedBuildId);
  const [accessState, setAccessState] = useState<CanvasAccessState>(buildMismatch ? "build-mismatch" : "claiming");
  const [claimError, setClaimError] = useState<string | null>(null);
  const [claimAttempt, setClaimAttempt] = useState(0);
  const accessStateRef = useRef(accessState);
  const takeoverGranted = useRef(false);
  const claimRetryScheduled = useRef(false);

  useEffect(() => { accessStateRef.current = accessState; }, [accessState]);

  useEffect(() => { if (buildMismatch) setAccessState("build-mismatch"); }, [buildMismatch]);
  useEffect(() => {
    if (!buildMismatch && hostMode === "runtime" && bootstrap.capabilities?.manualWrite === false && bootstrap.capabilities.canTakeOver) setAccessState("duplicate");
  }, [bootstrap.capabilities?.canTakeOver, bootstrap.capabilities?.manualWrite, buildMismatch]);

  const sendContextNow = useCallback(async (syncPurpose: "claim" | "state") => {
    if (standaloneDemo || !project || !layout || !bootstrap.workspaceDir || buildMismatch || ["duplicate", "detached", "build-mismatch"].includes(accessStateRef.current)) return false;
    if (syncPurpose === "state" && (accessStateRef.current !== "active" || pendingInitialFitView.current === layout.viewId || pendingViewportRestore.current?.viewId === layout.viewId)) return;
    sequence.current = reserveCanvasSequence(sequence.current);
    const timestamp = new Date().toISOString();
    const chatBinding = bindingRef.current;
    try {
      const result = await callTool<{ context?: { sequence?: number }; manualWrite?: boolean }>("weaver_canvas_action", { workspaceDir: bootstrap.workspaceDir, action: syncPurpose === "claim" ? "claim" : "sync", snapshot: { version: 2, syncPurpose, canvasSessionId: sessionId.current, workspaceDir: bootstrap.workspaceDir, projectId: project.id, scenePackId: project.scenePackId, scenePackVersion: project.scenePackVersion, graphRevision: project.graphRevision, viewId: layout.viewId, viewType: layout.viewType, focusedNodeId: anchorNodeId && selection.includes(anchorNodeId) ? anchorNodeId : selection[0], selectedNodeIds: selection, selectedEdgeIds: [], selectedGroupIds: [], pinnedContextNodeIds: nodes.filter((node) => Boolean((node.data as CardData).pinned)).map((node) => node.id), viewport: viewport.current, presence: { visible: !document.hidden, focused: document.hasFocus(), lastSeenAt: timestamp }, chatBinding: !isLocalDevelopment ? chatBinding && { leaseId: chatBinding.leaseId, bindingRevision: chatBinding.bindingRevision } : undefined, agentEligible: !isLocalDevelopment && Boolean(chatBinding), sequence: sequence.current, updatedAt: timestamp } });
      sequence.current = acknowledgedCanvasSequence(sequence.current, result);
      persistCanvasSequence(sequence.current);
      if (hostMode === "runtime" && result.manualWrite === false) { accessStateRef.current = "duplicate"; setAccessState("duplicate"); return false; }
      if (syncPurpose === "claim") { accessStateRef.current = "active"; setClaimError(null); setAccessState("active"); }
      return true;
    }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (hostMode === "runtime" && ["WORKER_RESTARTING", "WORKER_UNAVAILABLE", "fetch failed", "Failed to fetch"].some((code) => message.includes(code))) {
        setStatus("Canvas service reconnecting…");
        if (syncPurpose === "claim" && !claimRetryScheduled.current) {
          claimRetryScheduled.current = true;
          window.setTimeout(() => {
            claimRetryScheduled.current = false;
            accessStateRef.current = "claiming";
            setAccessState("claiming");
            setClaimAttempt((value) => value + 1);
          }, 250);
        }
        return false;
      }
      const blocked = canvasAccessFromError(error);
      if (blocked) { setAccessState(blocked); setStatus(blocked === "duplicate" ? "This canvas is already active in another tab" : blocked === "build-mismatch" ? "Widget build mismatch" : "Detached. This Chat is now attached to another Canvas"); stream.current?.close(); return false; }
      if (syncPurpose === "claim") { setClaimError(error instanceof Error ? error.message : String(error)); return false; }
      throw error;
    }
  }, [anchorNodeId, bootstrap.workspaceDir, buildMismatch, layout, nodes, project, selection, standaloneDemo]);

  const sendContext = useCallback((syncPurpose: "claim" | "state") => syncQueue.current(() => sendContextNow(syncPurpose)), [sendContextNow]);

  const syncContext = useCallback(() => sendContext("state"), [sendContext]);
  const sendContextRef = useRef(sendContext);
  useEffect(() => { sendContextRef.current = sendContext; }, [sendContext]);

  useEffect(() => {
    if (standaloneDemo || !project || !layout || !bootstrap.workspaceDir || buildMismatch || (hostMode === "runtime" && !takeoverGranted.current && bootstrap.capabilities?.manualWrite === false && bootstrap.capabilities.canTakeOver)) return;
    let cancelled = false;
    setClaimError(null); setAccessState("claiming");
    void sendContextRef.current("claim").then((ok) => {
      if (cancelled) return;
      if (ok) { window.setTimeout(() => void sendContextRef.current("state"), 0); return; }
      if (accessStateRef.current === "claiming" && !claimRetryScheduled.current) setAccessState("claim-failed");
    });
    return () => { cancelled = true; };
  }, [bootstrap.workspaceDir, buildMismatch, claimAttempt, layout?.viewId, project?.id, standaloneDemo]);

  useEffect(() => { if (syncTimer.current) window.clearTimeout(syncTimer.current); syncTimer.current = window.setTimeout(() => void syncContext(), 250); return () => { if (syncTimer.current) window.clearTimeout(syncTimer.current); }; }, [syncContext]);

  useEffect(() => {
    if (standaloneDemo || !project || !layout || accessState !== "active") return;
    const heartbeat = window.setInterval(() => void syncContext(), 5_000);
    const syncPresence = () => void syncContext();
    window.addEventListener("focus", syncPresence); window.addEventListener("blur", syncPresence); document.addEventListener("visibilitychange", syncPresence);
    return () => { window.clearInterval(heartbeat); window.removeEventListener("focus", syncPresence); window.removeEventListener("blur", syncPresence); document.removeEventListener("visibilitychange", syncPresence); };
  }, [accessState, layout?.viewId, project?.id, standaloneDemo, syncContext]);

  const retryClaim = useCallback(() => { setAccessState("claiming"); setClaimAttempt((value) => value + 1); }, []);
  const takeOver = useCallback(async () => {
    if (!project) return;
    await takeOverRuntimeProject(project.id);
    takeoverGranted.current = true;
    setAccessState("claiming");
    setClaimAttempt((value) => value + 1);
  }, [project]);
  return { syncContext, accessState, buildMismatch, setAccessState, claimError, retryClaim, takeOver };
}
