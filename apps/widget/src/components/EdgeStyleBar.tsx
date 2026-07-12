import type { Edge } from "@xyflow/react";
import type { EdgeArrows, EdgeLineStyle, EdgeRouting } from "../lib/edge-style";
import { useI18n } from "../lib/i18n";

// Floating override for a single selected edge (DESIGN.md § Line: semantic
// default + manual override). Line style, arrowheads, and routing are visual —
// they emit a set-edge-route layout op scoped to the current view only.
type EdgePatch = { lineStyle?: EdgeLineStyle; arrows?: EdgeArrows; routing?: EdgeRouting };

export function EdgeStyleBar(props: { edge: Edge | null; persistEdgeRoute: (edgeId: string, patch: EdgePatch) => void | Promise<void> }) {
  const { edge, persistEdgeRoute } = props;
  const { t } = useI18n();
  if (!edge) return null;
  const data = (edge.data ?? {}) as { lineStyle?: EdgeLineStyle; arrows?: EdgeArrows; routing?: EdgeRouting };
  const lineStyle: EdgeLineStyle = data.lineStyle ?? "solid";
  const arrows: EdgeArrows = data.arrows ?? "forward";
  const routing: EdgeRouting = data.routing ?? "straight";
  const set = (patch: EdgePatch) => void persistEdgeRoute(edge.id, patch);
  const curved = routing === "bezier" || routing === "bundled";
  return <div className="edge-style-bar floating-panel" role="toolbar" aria-label={t("edgeStyleBar")}>
    <div className="edge-style-group" role="group" aria-label={t("lineStyleLabel")}>
      <button type="button" title={t("solidLine")} data-active={lineStyle === "solid" || undefined} onClick={() => set({ lineStyle: "solid" })} aria-pressed={lineStyle === "solid"}>
        <svg width="24" height="12" aria-hidden><line x1="2" y1="6" x2="22" y2="6" stroke="currentColor" strokeWidth="2" /></svg>
        <span className="visually-hidden">{t("solidLine")}</span>
      </button>
      <button type="button" title={t("dashedLine")} data-active={lineStyle === "dashed" || undefined} onClick={() => set({ lineStyle: "dashed" })} aria-pressed={lineStyle === "dashed"}>
        <svg width="24" height="12" aria-hidden><line x1="2" y1="6" x2="22" y2="6" stroke="currentColor" strokeWidth="2" strokeDasharray="5 4" /></svg>
        <span className="visually-hidden">{t("dashedLine")}</span>
      </button>
    </div>
    <i className="edge-style-sep" />
    <div className="edge-style-group" role="group" aria-label={t("arrowsLabel")}>
      <button type="button" title={t("noArrow")} data-active={arrows === "none" || undefined} onClick={() => set({ arrows: "none" })} aria-pressed={arrows === "none"}>
        <svg width="26" height="12" aria-hidden><line x1="2" y1="6" x2="24" y2="6" stroke="currentColor" strokeWidth="2" /></svg>
        <span className="visually-hidden">{t("noArrow")}</span>
      </button>
      <button type="button" title={t("singleArrow")} data-active={arrows === "forward" || undefined} onClick={() => set({ arrows: "forward" })} aria-pressed={arrows === "forward"}>
        <svg width="26" height="12" aria-hidden><line x1="2" y1="6" x2="20" y2="6" stroke="currentColor" strokeWidth="2" /><path d="M18,2 L24,6 L18,10 z" fill="currentColor" /></svg>
        <span className="visually-hidden">{t("singleArrow")}</span>
      </button>
      <button type="button" title={t("doubleArrow")} data-active={arrows === "both" || undefined} onClick={() => set({ arrows: "both" })} aria-pressed={arrows === "both"}>
        <svg width="26" height="12" aria-hidden><line x1="6" y1="6" x2="20" y2="6" stroke="currentColor" strokeWidth="2" /><path d="M8,2 L2,6 L8,10 z" fill="currentColor" /><path d="M18,2 L24,6 L18,10 z" fill="currentColor" /></svg>
        <span className="visually-hidden">{t("doubleArrow")}</span>
      </button>
    </div>
    <i className="edge-style-sep" />
    <div className="edge-style-group" role="group" aria-label={t("routingLabel")}>
      <button type="button" title={t("straightLine")} data-active={!curved || undefined} onClick={() => set({ routing: "straight" })} aria-pressed={!curved}>
        <svg width="24" height="12" aria-hidden><line x1="2" y1="10" x2="22" y2="2" stroke="currentColor" strokeWidth="2" /></svg>
        <span className="visually-hidden">{t("straightLine")}</span>
      </button>
      <button type="button" title={t("curvedLine")} data-active={curved || undefined} onClick={() => set({ routing: "bezier" })} aria-pressed={curved}>
        <svg width="24" height="12" aria-hidden><path d="M2,10 C10,10 14,2 22,2" stroke="currentColor" strokeWidth="2" fill="none" /></svg>
        <span className="visually-hidden">{t("curvedLine")}</span>
      </button>
    </div>
  </div>;
}
