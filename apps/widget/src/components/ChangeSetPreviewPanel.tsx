import { Check, X } from "lucide-react";
import type { ChangeSetPreview } from "../types";
import { useI18n } from "../lib/i18n";

export function ChangeSetPreviewPanel({ changePreview, rejectChangeSet, applyChangeSet }: { changePreview: ChangeSetPreview | null; rejectChangeSet: () => void | Promise<void>; applyChangeSet: () => void | Promise<void> }) {
  const { t } = useI18n();
  if (!changePreview) return null;
  return <aside className="candidate-panel changeset-panel">
    <div><strong>{t("contentPreview")}</strong><small>{changePreview.changeSet.riskLevel} {t("risk")}</small></div>
    <h3>{changePreview.changeSet.rationale || t("agentChanges")}</h3>
    <p>+{changePreview.summary.addedNodes} {t("nodes")} · {changePreview.summary.updatedNodes} {t("updated")} · +{changePreview.summary.addedEdges} {t("relations")} · {changePreview.summary.layoutOperations} {t("layoutOps")}</p>
    {changePreview.stale ? <p className="stale-warning">{t("staleProposal")}</p> : null}
    <div className="candidate-actions"><button onClick={() => void rejectChangeSet()}><X size={14} /> {t("reject")}</button>{!changePreview.stale ? <button className="apply" onClick={() => void applyChangeSet()}><Check size={15} /> {t("applyAll")}</button> : null}</div>
  </aside>;
}
