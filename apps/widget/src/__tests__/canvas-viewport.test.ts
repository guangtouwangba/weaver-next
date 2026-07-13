import { describe, expect, it } from "vitest";
import { canvasLod, canvasPatternOpacity, clampCanvasZoom, MAX_CANVAS_ZOOM, MIN_CANVAS_ZOOM, wheelZoomMultiplier, zoomViewportAtPoint } from "../lib/canvas-viewport";

describe("canvas viewport", () => {
  it("keeps the world point under the pointer stable while zooming", () => {
    const current = { x: 120, y: -40, zoom: 0.8 };
    const pointer = { x: 640, y: 360 };
    const worldBefore = { x: (pointer.x - current.x) / current.zoom, y: (pointer.y - current.y) / current.zoom };
    const next = zoomViewportAtPoint(current, 1.7, pointer);
    expect((pointer.x - next.x) / next.zoom).toBeCloseTo(worldBefore.x, 10);
    expect((pointer.y - next.y) / next.zoom).toBeCloseTo(worldBefore.y, 10);
  });

  it("uses the same zoom clamps for every input", () => {
    expect(clampCanvasZoom(0.01)).toBe(MIN_CANVAS_ZOOM);
    expect(clampCanvasZoom(9)).toBe(MAX_CANVAS_ZOOM);
    expect(zoomViewportAtPoint({ x: 0, y: 0, zoom: 1 }, 0.01, { x: 0, y: 0 }).zoom).toBe(MIN_CANVAS_ZOOM);
  });

  it("selects semantic detail levels at the specified thresholds", () => {
    expect(canvasLod(0.8)).toBe("full");
    expect(canvasLod(0.79)).toBe("compact");
    expect(canvasLod(0.44)).toBe("thumbnail");
    expect(canvasLod(0.24)).toBe("overview");
  });

  it("fades the dot field at overview scale", () => {
    expect(canvasPatternOpacity(0.2, 0.4)).toBeCloseTo(0.088);
    expect(canvasPatternOpacity(1, 0.4)).toBe(0.4);
  });

  it("amplifies macOS trackpad pinch without making command-wheel jump", () => {
    const pinch = wheelZoomMultiplier({ deltaY: -2, deltaMode: 0, ctrlKey: true, metaKey: false });
    const commandWheel = wheelZoomMultiplier({ deltaY: -2, deltaMode: 0, ctrlKey: false, metaKey: true });
    expect(pinch).toBeGreaterThan(1.03);
    expect(pinch).toBeLessThan(1.08);
    expect(commandWheel).toBeGreaterThan(1);
    expect(commandWheel).toBeLessThan(pinch);
  });

  it("caps a coarse wheel event so one event cannot lose the canvas", () => {
    expect(wheelZoomMultiplier({ deltaY: -100, deltaMode: 0, ctrlKey: true, metaKey: false })).toBeLessThanOrEqual(Math.exp(0.35));
    expect(wheelZoomMultiplier({ deltaY: 100, deltaMode: 0, ctrlKey: true, metaKey: false })).toBeGreaterThanOrEqual(Math.exp(-0.35));
  });
});
