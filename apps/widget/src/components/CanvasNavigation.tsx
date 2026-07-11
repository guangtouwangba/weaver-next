import { Crosshair, Focus, Map as MapIcon, Minus, Moon, Plus, Sun, Trash2 } from "lucide-react";
import type React from "react";
import type { CanvasViewportState } from "../lib/canvas-viewport";

export function CanvasNavigation(props: {
  state: CanvasViewportState;
  miniMapOpen: boolean;
  hasSelection: boolean;
  dark: boolean;
  onZoomOut: (bounds: DOMRect) => void;
  onZoomIn: (bounds: DOMRect) => void;
  onFit: () => void;
  onFocus: () => void;
  onToggleMiniMap: () => void;
  onToggleTheme: () => void;
  onDeleteSelection: () => void;
  selectionCount: number;
}) {
  const { state, miniMapOpen, hasSelection, dark, onZoomOut, onZoomIn, onFit, onFocus, onToggleMiniMap, onToggleTheme, onDeleteSelection, selectionCount } = props;
  const bounds = (event: React.MouseEvent<HTMLButtonElement>) => event.currentTarget.closest(".canvas-wrap")?.getBoundingClientRect() ?? document.body.getBoundingClientRect();
  return <div className="canvas-navigation" aria-label="Canvas navigation">
    <button aria-label="Zoom out" onClick={(event) => onZoomOut(bounds(event))}><Minus size={14} /></button>
    <output aria-label="Zoom level">{Math.round(state.zoom * 100)}%</output>
    <button aria-label="Zoom in" onClick={(event) => onZoomIn(bounds(event))}><Plus size={14} /></button>
    <span />
    <button aria-label="Fit whole view" title="Fit whole view" onClick={onFit}><Crosshair size={14} /></button>
    <button aria-label="Focus selection" title="Focus selection" disabled={!hasSelection} onClick={onFocus}><Focus size={14} /></button>
    <button className="nav-delete" aria-label={selectionCount > 1 ? `Delete ${selectionCount} nodes` : "Delete node"} title={selectionCount > 1 ? `删除 ${selectionCount} 个节点` : "删除节点"} disabled={!hasSelection} onClick={onDeleteSelection}><Trash2 size={14} /></button>
    <button aria-label="Toggle minimap" title="Toggle minimap" data-active={miniMapOpen} onClick={onToggleMiniMap}><MapIcon size={14} /></button>
    <button aria-label={`Use ${dark ? "light" : "dark"} canvas`} title="Canvas appearance" onClick={onToggleTheme}>{dark ? <Sun size={14} /> : <Moon size={14} />}</button>
  </div>;
}
