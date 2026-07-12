import type { AgentTask, Candidate, ChangeSetPreview } from "../types";
import { useI18n } from "../lib/i18n";

export function StaleTaskBanner({ staleTask, changePreview, candidates }: { staleTask: AgentTask | null; changePreview: ChangeSetPreview | null; candidates: Candidate[] }) {
  const { t } = useI18n();
  if (!staleTask || changePreview || candidates.length) return null;
  return <aside className="candidate-panel changeset-panel">
    <div><strong>{t("taskStale")}</strong><small>{staleTask.error?.code}</small></div>
    <p>{staleTask.error?.message ?? t("taskStaleFallback")} {t("regenerate")}</p>
  </aside>;
}
