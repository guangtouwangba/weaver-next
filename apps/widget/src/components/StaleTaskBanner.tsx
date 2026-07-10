import type { AgentTask, Candidate, ChangeSetPreview } from "../types";

export function StaleTaskBanner({ staleTask, changePreview, candidates }: { staleTask: AgentTask | null; changePreview: ChangeSetPreview | null; candidates: Candidate[] }) {
  if (!staleTask || changePreview || candidates.length) return null;
  return <aside className="candidate-panel changeset-panel">
    <div><strong>Task is stale</strong><small>{staleTask.error?.code}</small></div>
    <p>{staleTask.error?.message ?? "The canvas changed while the task was running."} Ask Codex to regenerate it from the current canvas.</p>
  </aside>;
}
