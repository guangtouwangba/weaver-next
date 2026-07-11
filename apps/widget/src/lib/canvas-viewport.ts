import type { Viewport } from "@xyflow/react";

export const MIN_CANVAS_ZOOM = 0.15;
export const MAX_CANVAS_ZOOM = 2.5;
export const PROGRAMMATIC_VIEWPORT_DURATION = 220;

export type CanvasLod = "full" | "compact" | "thumbnail" | "overview";
export type CanvasInteraction = "idle" | "pan" | "pinch" | "wheelZoom" | "programmatic";
export type CanvasViewportState = Viewport & { interaction: CanvasInteraction; lod: CanvasLod };

export function clampCanvasZoom(zoom: number) {
  return Math.min(MAX_CANVAS_ZOOM, Math.max(MIN_CANVAS_ZOOM, zoom));
}

export function canvasLod(zoom: number): CanvasLod {
  if (zoom >= 0.8) return "full";
  if (zoom >= 0.45) return "compact";
  if (zoom >= 0.25) return "thumbnail";
  return "overview";
}

export function zoomViewportAtPoint(current: Viewport, nextZoom: number, point: { x: number; y: number }): Viewport {
  const zoom = clampCanvasZoom(nextZoom);
  const world = { x: (point.x - current.x) / current.zoom, y: (point.y - current.y) / current.zoom };
  return { x: point.x - world.x * zoom, y: point.y - world.y * zoom, zoom };
}

export function canvasPatternOpacity(zoom: number, baseOpacity: number) {
  if (zoom < 0.25) return baseOpacity * 0.22;
  if (zoom < 0.45) return baseOpacity * 0.48;
  if (zoom > 1.6) return Math.min(0.7, baseOpacity * 1.08);
  return baseOpacity;
}
