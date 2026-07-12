import { Check, X } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";
import type { Candidate } from "../types";
import { useI18n } from "../lib/i18n";

export function LayoutCandidatePanel({ candidates, candidateIndex, setCandidateIndex, rejectLayout, applyCandidate }: { candidates: Candidate[]; candidateIndex: number; setCandidateIndex: Dispatch<SetStateAction<number>>; rejectLayout: () => void | Promise<void>; applyCandidate: () => void | Promise<void> }) {
  const { t } = useI18n();
  if (!candidates.length) return null;
  return <aside className="candidate-panel">
    <div><strong>{t("layoutPreview")}</strong><small>{candidateIndex + 1} / {candidates.length}</small></div>
    <h3>{candidates[candidateIndex].label}</h3>
    <p>Score {candidates[candidateIndex].metrics.score.toFixed(1)} · {candidates[candidateIndex].metrics.edgeCrossings} crossings</p>
    <div className="candidate-actions"><button onClick={() => void rejectLayout()}><X size={14} /> {t("reject")}</button><button onClick={() => setCandidateIndex((candidateIndex + 1) % candidates.length)}>{t("nextOption")}</button><button className="apply" onClick={() => void applyCandidate()}><Check size={15} /> {t("apply")}</button></div>
  </aside>;
}
