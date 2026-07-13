import { useCallback, useEffect, useRef, useState } from "react";
import type React from "react";
import type { MutableRefObject } from "react";
import type { CanvasNode as Node, CanvasViewport as Viewport } from "../lib/canvas-model";
import { canvasLod, clampCanvasZoom, MAX_CANVAS_ZOOM, MIN_CANVAS_ZOOM, PROGRAMMATIC_VIEWPORT_DURATION, zoomViewportAtPoint, type CanvasInteraction, type CanvasViewportState } from "../lib/canvas-viewport";

export function useCanvasViewport(params: {
  nodes: Node[];
  selection: string[];
  viewId?: string;
  viewport: MutableRefObject<Viewport>;
  pendingInitialFitView: MutableRefObject<string | null>;
  pendingViewportRestore: MutableRefObject<{ viewId: string; viewport: Viewport } | null>;
  getViewport: () => Viewport;
  setViewport: (viewport: Viewport, options?: { duration?: number }) => Promise<boolean>;
  fitView: (options?: Record<string, unknown>) => Promise<boolean>;
  onViewportReady?: () => void;
}) {
  const { nodes, selection, viewId, viewport, pendingInitialFitView, pendingViewportRestore, getViewport, setViewport, fitView, onViewportReady } = params;
  const initial = viewport.current;
  const [state, setState] = useState<CanvasViewportState>({ ...initial, interaction: "idle", lod: canvasLod(initial.zoom) });
  const [miniMapOpen, setMiniMapOpen] = useState(false);
  const wheelFrame = useRef<number | null>(null);
  const pendingWheel = useRef<{ deltaY: number; point: { x: number; y: number } } | null>(null);
  const onViewportReadyRef = useRef(onViewportReady);
  useEffect(() => { onViewportReadyRef.current = onViewportReady; }, [onViewportReady]);

  const commit = useCallback((next: Viewport, interaction: CanvasInteraction) => {
    const safe = { ...next, zoom: clampCanvasZoom(next.zoom) };
    viewport.current = safe;
    setState({ ...safe, interaction, lod: canvasLod(safe.zoom) });
    return safe;
  }, [viewport]);

  const cancelProgrammatic = useCallback(() => {
    const current = getViewport();
    commit(current, "idle");
    void setViewport(current, { duration: 0 });
  }, [commit, getViewport, setViewport]);

  const beginInteraction = useCallback((interaction: Exclude<CanvasInteraction, "idle" | "programmatic">) => {
    if (state.interaction === "programmatic") cancelProgrammatic();
    setState((current) => ({ ...current, interaction }));
  }, [cancelProgrammatic, state.interaction]);

  const handleMove = useCallback((next: Viewport) => commit(next, state.interaction === "programmatic" ? "programmatic" : state.interaction), [commit, state.interaction]);
  const handleMoveEnd = useCallback((next: Viewport) => commit(next, "idle"), [commit]);

  const handleCanvasWheel = useCallback((event: React.WheelEvent<HTMLElement>) => {
    if (!event.metaKey && !event.ctrlKey) return;
    event.preventDefault();
    event.stopPropagation();
    const bounds = event.currentTarget.getBoundingClientRect();
    const point = { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
    const pending = pendingWheel.current;
    pendingWheel.current = { deltaY: (pending?.deltaY ?? 0) + event.deltaY, point };
    if (wheelFrame.current !== null) return;
    beginInteraction("wheelZoom");
    wheelFrame.current = requestAnimationFrame(() => {
      wheelFrame.current = null;
      const input = pendingWheel.current;
      pendingWheel.current = null;
      if (!input) return;
      const current = getViewport();
      const next = zoomViewportAtPoint(current, current.zoom * Math.exp(-input.deltaY * 0.0016), input.point);
      commit(next, "wheelZoom");
      void setViewport(next, { duration: 0 });
    });
  }, [beginInteraction, commit, getViewport, setViewport]);

  const zoomBy = useCallback((factor: number, bounds?: DOMRect) => {
    const current = getViewport();
    const point = { x: (bounds?.width ?? window.innerWidth) / 2, y: (bounds?.height ?? window.innerHeight) / 2 };
    const next = zoomViewportAtPoint(current, current.zoom * factor, point);
    commit(next, "programmatic");
    void setViewport(next, { duration: PROGRAMMATIC_VIEWPORT_DURATION });
  }, [commit, getViewport, setViewport]);

  const fitAll = useCallback(() => {
    setState((current) => ({ ...current, interaction: "programmatic" }));
    void fitView({ padding: 0.18, minZoom: MIN_CANVAS_ZOOM, maxZoom: 1.15, duration: PROGRAMMATIC_VIEWPORT_DURATION });
  }, [fitView]);

  const focusSelection = useCallback(() => {
    if (!selection.length) return fitAll();
    const selected = new Set(selection);
    setState((current) => ({ ...current, interaction: "programmatic" }));
    void fitView({ nodes: nodes.filter((node) => selected.has(node.id)), padding: 0.42, minZoom: MIN_CANVAS_ZOOM, maxZoom: MAX_CANVAS_ZOOM, duration: PROGRAMMATIC_VIEWPORT_DURATION });
  }, [fitAll, fitView, nodes, selection]);

  useEffect(() => {
    if (!viewId || !nodes.some((node) => !node.id.startsWith("visual-group:"))) return;
    const restore = pendingViewportRestore.current;
    let innerFrame = 0;
    const outerFrame = requestAnimationFrame(() => {
      innerFrame = requestAnimationFrame(() => {
        if (restore?.viewId === viewId && pendingViewportRestore.current === restore) {
          pendingViewportRestore.current = null;
          const next = commit(restore.viewport, "programmatic");
          void setViewport(next, { duration: PROGRAMMATIC_VIEWPORT_DURATION }).finally(() => onViewportReadyRef.current?.());
          return;
        }
        if (pendingInitialFitView.current !== viewId) return;
        pendingInitialFitView.current = null;
        fitAll();
        window.setTimeout(() => onViewportReadyRef.current?.(), PROGRAMMATIC_VIEWPORT_DURATION);
      });
    });
    return () => { cancelAnimationFrame(outerFrame); if (innerFrame) cancelAnimationFrame(innerFrame); };
  }, [commit, fitAll, nodes, pendingInitialFitView, pendingViewportRestore, setViewport, viewId]);

  useEffect(() => () => {
    if (wheelFrame.current !== null) cancelAnimationFrame(wheelFrame.current);
  }, []);

  return { state, miniMapOpen, setMiniMapOpen, handleCanvasWheel, handleMove, handleMoveEnd, beginInteraction, cancelProgrammatic, zoomBy, fitAll, focusSelection };
}
