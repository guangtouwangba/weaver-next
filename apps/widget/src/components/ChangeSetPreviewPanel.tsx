import { Check, X } from "lucide-react";
import type { ChangeSetPreview } from "../types";

export function ChangeSetPreviewPanel({ changePreview, rejectChangeSet, applyChangeSet }: { changePreview: ChangeSetPreview | null; rejectChangeSet: () => void | Promise<void>; applyChangeSet: () => void | Promise<void> }) {
  if (!changePreview) return null;
  return <aside className="candidate-panel changeset-panel">
    <div><strong>Content preview</strong><small>{changePreview.changeSet.riskLevel} risk</small></div>
    <h3>{changePreview.changeSet.rationale || "Agent changes"}</h3>
    <p>+{changePreview.summary.addedNodes} nodes · {changePreview.summary.updatedNodes} updated · +{changePreview.summary.addedEdges} relations · {changePreview.summary.layoutOperations} layout ops</p>
    {changePreview.stale ? <p className="stale-warning">This proposal is stale. Ask Codex to regenerate it from the current canvas.</p> : null}
    <div className="candidate-actions"><button onClick={() => void rejectChangeSet()}><X size={14} /> Reject</button>{!changePreview.stale ? <button className="apply" onClick={() => void applyChangeSet()}><Check size={15} /> Apply all</button> : null}</div>
  </aside>;
}
