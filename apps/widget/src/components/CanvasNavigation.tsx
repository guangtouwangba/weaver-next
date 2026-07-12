import { Crosshair, Focus, Map as MapIcon, Minus, Moon, Plus, Sun, Trash2 } from "lucide-react";
import type React from "react";
import type { CanvasViewportState } from "../lib/canvas-viewport";
import { useI18n } from "../lib/i18n";

export function CanvasNavigation(props: {
  state: CanvasViewportState; miniMapOpen: boolean; hasSelection: boolean; dark: boolean;
  onZoomOut: (bounds: DOMRect) => void; onZoomIn: (bounds: DOMRect) => void; onFit: () => void; onFocus: () => void;
  onToggleMiniMap: () => void; onToggleTheme: () => void; onDeleteSelection: () => void; selectionCount: number;
}) {
  const { state, miniMapOpen, hasSelection, dark, onZoomOut, onZoomIn, onFit, onFocus, onToggleMiniMap, onToggleTheme, onDeleteSelection, selectionCount } = props;
  const { t } = useI18n();
  const bounds = (event: React.MouseEvent<HTMLButtonElement>) => event.currentTarget.closest(".canvas-wrap")?.getBoundingClientRect() ?? document.body.getBoundingClientRect();
  return <div className="canvas-navigation" aria-label={t("canvasNavigation")}>
    <button aria-label={t("zoomOut")} onClick={(event) => onZoomOut(bounds(event))}><Minus size={14} /></button>
    <output aria-label={t("zoomLevel")}>{Math.round(state.zoom * 100)}%</output>
    <button aria-label={t("zoomIn")} onClick={(event) => onZoomIn(bounds(event))}><Plus size={14} /></button>
    <span />
    <button aria-label={t("fitView")} title={t("fitView")} onClick={onFit}><Crosshair size={14} /></button>
    <button aria-label={t("focusSelection")} title={t("focusSelection")} disabled={!hasSelection} onClick={onFocus}><Focus size={14} /></button>
    <button className="nav-delete" aria-label={`${selectionCount > 1 ? t("deleteNodes") : t("deleteNode")} ${selectionCount > 1 ? selectionCount : ""}`.trim()} title={selectionCount > 1 ? `${t("deleteNodes")} ${selectionCount}` : t("deleteNode")} disabled={!hasSelection} onClick={onDeleteSelection}><Trash2 size={14} /></button>
    <button aria-label={t("toggleMinimap")} title={t("toggleMinimap")} data-active={miniMapOpen} onClick={onToggleMiniMap}><MapIcon size={14} /></button>
    <button aria-label={dark ? t("useLightCanvas") : t("useDarkCanvas")} title={t("canvasAppearance")} onClick={onToggleTheme}>{dark ? <Sun size={14} /> : <Moon size={14} />}</button>
  </div>;
}
