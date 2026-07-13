import type { CanvasViewport } from "./canvas-model";

export const MIN_CANVAS_ZOOM = 0.15;
export const MAX_CANVAS_ZOOM = 2.5;
export const PROGRAMMATIC_VIEWPORT_DURATION = 220;

export type CanvasLod = "full" | "compact" | "thumbnail" | "overview";
export type CanvasInteraction = "idle" | "pan" | "pinch" | "wheelZoom" | "programmatic";
export type CanvasViewportState = CanvasViewport & { interaction: CanvasInteraction; lod: CanvasLod };

export function clampCanvasZoom(zoom: number) {
  return Math.min(MAX_CANVAS_ZOOM, Math.max(MIN_CANVAS_ZOOM, zoom));
}

export function canvasLod(zoom: number): CanvasLod {
  if (zoom >= 0.8) return "full";
  if (zoom >= 0.45) return "compact";
  if (zoom >= 0.25) return "thumbnail";
  return "overview";
}

export function zoomViewportAtPoint(current: CanvasViewport, nextZoom: number, point: { x: number; y: number }): CanvasViewport {
  const zoom = clampCanvasZoom(nextZoom);
  const world = { x: (point.x - current.x) / current.zoom, y: (point.y - current.y) / current.zoom };
  return { x: point.x - world.x * zoom, y: point.y - world.y * zoom, zoom };
}

export function wheelZoomMultiplier(event: Pick<WheelEvent, "deltaY" | "deltaMode" | "ctrlKey" | "metaKey">): number {
  const unit = event.deltaMode === 1 ? 0.05 : event.deltaMode === 2 ? 1 : 0.002;
  // Chrome reports a macOS two-finger pinch as a pixel-mode wheel event with
  // ctrlKey set. Match the de-facto d3/trackpad amplification while keeping a
  // regular Command+wheel precise and cap coarse mouse-wheel bursts.
  const gestureAmplifier = event.ctrlKey ? 10 : 1;
  const exponent = Math.max(-0.35, Math.min(0.35, -event.deltaY * unit * gestureAmplifier));
  return Math.exp(exponent);
}

export function canvasPatternOpacity(zoom: number, baseOpacity: number) {
  if (zoom < 0.25) return baseOpacity * 0.22;
  if (zoom < 0.45) return baseOpacity * 0.48;
  if (zoom > 1.6) return Math.min(0.7, baseOpacity * 1.08);
  return baseOpacity;
}
