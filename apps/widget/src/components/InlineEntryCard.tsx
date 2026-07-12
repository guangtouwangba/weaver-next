import { Maximize2 } from "lucide-react";
import type { GraphNode, Layout, Project } from "../types";
import { useI18n } from "../lib/i18n";

export function InlineEntryCard({ project, layout, nodes, selectionCount, streamState, onOpen }: { project: Project | null; layout: Layout | null; nodes: GraphNode[]; selectionCount: number; streamState: string; onOpen: () => void | Promise<void> }) {
  const { t } = useI18n(); const preview = nodes.slice(0, 12);
  return <main className="inline-entry" aria-label={t("graphSnapshot")}>
    <header><div className="inline-brand"><span>W</span><div><strong>Weaver</strong><small>{t("currentSpace")}</small></div></div><div className="inline-context"><strong>{project?.title ?? t("emptySpace")}</strong><span>{layout?.viewName ?? "—"}</span><i data-live={streamState === "online" || streamState === "polling"} />{t(streamState === "connecting" ? "connecting" : "live")}</div><button className="inline-open" onClick={() => void onOpen()}><Maximize2 size={15} />{t("openFullscreen")}</button></header>
    <section className="inline-graph"><svg viewBox="0 0 800 220" role="img">{preview.slice(1).map((node, index) => <line key={`line-${node.id}`} x1="400" y1="110" x2={100 + (index % 6) * 120} y2={55 + Math.floor(index / 6) * 110} />)}{preview.map((node, index) => <g key={node.id} transform={`translate(${index ? 72 + ((index - 1) % 6) * 120 : 365},${index ? 35 + Math.floor((index - 1) / 6) * 110 : 88})`}><rect width={index ? 88 : 120} height="44" rx="8" /><text x={index ? 44 : 60} y="26" textAnchor="middle">{node.title.slice(0, 9)}</text></g>)}</svg></section>
    <footer><span>{t("selected")} {selectionCount} {t("nodes")}</span><span>G{project?.graphRevision ?? 0} · L{layout?.layoutRevision ?? 0} · C{project?.viewCatalogRevision ?? 0}</span></footer>
  </main>;
}
