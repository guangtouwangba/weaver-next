import { useCallback, useEffect, useRef } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type { Node, Viewport } from "@xyflow/react";
import { callTool, isLocalDevelopment } from "../mcp-client";
import type { Bootstrap, CardData, ChatBindingBootstrap, Layout, Project } from "../types";

// Domain C: canvas selection/viewport sync to server (debounced context sync + heartbeat).
export function useCanvasBindingSync(params: {
  standaloneDemo: boolean;
  project: Project | null;
  layout: Layout | null;
  bootstrap: Bootstrap;
  bindingRef: MutableRefObject<ChatBindingBootstrap | undefined>;
  setStatus: Dispatch<SetStateAction<string>>;
  selection: string[];
  nodes: Node[];
  viewport: MutableRefObject<Viewport>;
  sessionId: MutableRefObject<string>;
  stream: MutableRefObject<EventSource | null>;
  pendingInitialFitView: MutableRefObject<string | null>;
  pendingViewportRestore: MutableRefObject<{ viewId: string; viewport: Viewport } | null>;
}) {
  const { standaloneDemo, project, layout, bootstrap, bindingRef, setStatus, selection, nodes, viewport, sessionId, stream, pendingInitialFitView, pendingViewportRestore } = params;
  const sequence = useRef(0);
  const syncTimer = useRef<number | null>(null);

  const syncContext = useCallback(async () => {
    if (standaloneDemo || !project || !layout || !bootstrap.workspaceDir) return;
    if (pendingInitialFitView.current === layout.viewId || pendingViewportRestore.current?.viewId === layout.viewId) return;
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

  return { syncContext };
}
