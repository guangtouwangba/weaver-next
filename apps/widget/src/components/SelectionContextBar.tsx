import { Check, Loader2, Send, X } from "lucide-react";
import { useEffect, useState } from "react";
import { hostMode } from "../mcp-client";
import type { AgentTask, GraphNode } from "../types";

// Human-readable state for the busy pill. Crucially distinguishes "dispatched"
// (the prompt is queued but no agent has picked it up yet — e.g. the terminal
// watcher isn't running) from "running" (an agent is actively working), so the
// user can tell whether anything is happening.
export function activeTaskBusyLabel(task: AgentTask | null): string | undefined {
  if (!task) return undefined;
  switch (task.status) {
    case "dispatched": return "等待接单…";
    case "running": return task.progressNote ?? (task.activeStage === "layout" ? "排版中…" : "生成中…");
    case "pending_review": return "待确认…";
    case "ready_to_continue": return "继续中…";
    default: return "处理中…";
  }
}

/** " · 已 N 分钟" once a task has run ≥1 minute — makes zombie tasks obvious at a glance. */
export function taskAgeSuffix(createdAt: string, nowMs: number): string {
  const minutes = Math.floor((nowMs - Date.parse(createdAt)) / 60_000);
  return Number.isFinite(minutes) && minutes >= 1 ? ` · 已 ${minutes} 分钟` : "";
}

// The canvas composer. On any agent host (Codex or Claude Code) it is a collapsed "ask"
// pill by default — so it never obstructs the canvas — that expands into a real input.
// Submitting sends the instruction against the bound canvas for the agent to pick up.
// The plain Vite dev preview has no agent, so it only surfaces selection context.
export function SelectionContextBar(props: {
  selection: string[];
  anchorNodeId?: string;
  nodes: GraphNode[];
  setAnchorNodeId: (nodeId: string) => void;
  removeNode: (nodeId: string) => void;
  submitPrompt: (instruction: string) => void | Promise<void>;
  cancelActiveTask?: () => void | Promise<void>;
  busy: boolean;
  busyLabel?: string;
  busySince?: string;
}) {
  const { selection, anchorNodeId, nodes, setAnchorNodeId, removeNode, submitPrompt, cancelActiveTask, busy, busyLabel, busySince } = props;
  const agentHost = hostMode !== "dev";
  const [expanded, setExpanded] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (!busy) return;
    setNowMs(Date.now());
    const id = window.setInterval(() => setNowMs(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, [busy]);
  const [draft, setDraft] = useState("");
  const byId = new Map(nodes.map((node) => [node.id, node]));

  const chips = selection.length ? <div className="follow-up-context">
    {selection.map((nodeId) => <div className="context-chip" data-anchor={nodeId === anchorNodeId} key={nodeId}>
      <button className="context-anchor" title="Use as branch anchor" onClick={() => setAnchorNodeId(nodeId)}>{nodeId === anchorNodeId ? <Check size={11} /> : null}<span>{byId.get(nodeId)?.title ?? nodeId}</span></button>
      <button className="context-remove" aria-label={`Remove ${byId.get(nodeId)?.title ?? nodeId}`} onClick={() => removeNode(nodeId)}><X size={10} /></button>
    </div>)}
  </div> : null;

  // Dev / demo preview: no agent — only surface the shared selection context.
  if (!agentHost) {
    if (!selection.length) return null;
    return <section className="follow-up-composer" data-expanded="true" aria-label="Canvas context">{chips}</section>;
  }

  if (busy) return <div className="prompt-trigger busy" aria-live="polite"><Loader2 size={14} className="spin" /><span>{`${busyLabel ?? "处理中…"}${busySince ? taskAgeSuffix(busySince, nowMs) : ""}`}</span>{cancelActiveTask ? <button type="button" className="prompt-cancel" onClick={() => void cancelActiveTask()} aria-label="Cancel" title="取消"><X size={12} /></button> : null}</div>;

  if (!expanded) return <button type="button" className="prompt-trigger" onClick={() => setExpanded(true)} aria-label="Ask on the canvas"><span>提问</span></button>;

  const anchorTitle = anchorNodeId ? byId.get(anchorNodeId)?.title : undefined;
  const send = () => { const text = draft.trim(); if (!text) return; setDraft(""); setExpanded(false); void submitPrompt(text); };
  return <section className="follow-up-composer" data-expanded="true" aria-label="Canvas prompt">
    {chips}
    <div className="prompt-input">
      <input
        autoFocus
        value={draft}
        placeholder={selection.length ? `发展「${anchorTitle ?? "选中节点"}」或提问…` : "在画布上提问…"}
        aria-label="Canvas prompt input"
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); send(); }
          else if (event.key === "Escape") { setDraft(""); setExpanded(false); }
        }}
        onBlur={() => { if (!draft.trim()) setExpanded(false); }}
      />
      <button className="prompt-send" disabled={!draft.trim()} onClick={send} aria-label="Send"><Send size={14} /></button>
    </div>
  </section>;
}
