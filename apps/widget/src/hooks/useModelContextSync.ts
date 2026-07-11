import { useEffect, useRef } from "react";
import { hostMode, mcp } from "../mcp-client";
import { describeCanvasSelection } from "../lib/graph-view";
import type { GraphNode } from "../types";

// Silently keeps Codex's model context aware of the current canvas selection/anchor,
// independent from useCanvasBindingSync's heavier debounce (which also fires on
// viewport/heartbeat/node-drag) — this only reacts to the identity of the selection.
export function useModelContextSync(params: { standaloneDemo: boolean; selection: string[]; anchorNodeId?: string; nodes: GraphNode[] }) {
  const { standaloneDemo, selection, anchorNodeId, nodes } = params;
  const nodesRef = useRef(nodes);
  useEffect(() => { nodesRef.current = nodes; }, [nodes]);

  useEffect(() => {
    // Only the Codex Apps-SDK host has a model-context channel (postMessage to parent).
    if (standaloneDemo || hostMode !== "codex") return;
    const timer = window.setTimeout(() => {
      void mcp.updateModelContext({ content: [{ type: "text", text: describeCanvasSelection(nodesRef.current, selection, anchorNodeId) }] }).catch(() => {});
    }, 400);
    return () => window.clearTimeout(timer);
  }, [standaloneDemo, selection, anchorNodeId]);
}
