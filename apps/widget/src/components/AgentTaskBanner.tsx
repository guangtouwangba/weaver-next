import type { AgentTask } from "../types";

export function AgentTaskBanner({ activeTask, cancelActiveTask }: { activeTask: AgentTask | null; cancelActiveTask: () => void | Promise<void> }) {
  if (!activeTask || activeTask.status === "pending_review") return null;
  return <aside className="agent-task-panel"><div><span className="agent-task-pulse" /><strong>{activeTask.activeStage} · {activeTask.status.replaceAll("_", " ")}</strong></div><button onClick={() => void cancelActiveTask()}>Cancel</button></aside>;
}
