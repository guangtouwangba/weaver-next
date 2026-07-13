import { describe, expect, it, vi } from "vitest";
import { CanvasRuntime, type RendererPort } from "../lib/canvas-runtime";
import type { RenderScene } from "../lib/hybrid-renderer";

const scene: RenderScene = {
  revisionKey: "1:1:v",
  projection: "canvas",
  bounds: { x: 0, y: 0, width: 500, height: 300 },
  nodes: [{ id: "a", kind: "document", title: "A", semanticType: "entity", x: 10, y: 20, width: 100, height: 60, pinned: false, content: { kind: "document", mode: "note", excerpt: "A", embeddedAssetIds: [] } }],
  edges: [],
  groups: [],
};

function renderer(): RendererPort & { cameras: unknown[]; scenes: unknown[]; selections: unknown[] } {
  const cameras: unknown[] = [];
  const scenes: unknown[] = [];
  const selections: unknown[] = [];
  return {
    cameras,
    scenes,
    selections,
    setScene: (value) => scenes.push(value),
    setCamera: (value) => cameras.push(value),
    setSelection: (value) => selections.push(value),
    setTransientFrames: vi.fn(),
    destroy: vi.fn(),
  };
}

describe("CanvasRuntime", () => {
  it("updates the renderer camera per frame without publishing React state", () => {
    const port = renderer();
    const publish = vi.fn();
    const runtime = new CanvasRuntime(port, { camera: { x: 0, y: 0, zoom: 1 }, onCameraCommit: publish });
    runtime.panBy(20, 30);
    runtime.panBy(5, -10);
    expect(port.cameras.at(-1)).toEqual({ x: 25, y: 20, zoom: 1 });
    expect(publish).not.toHaveBeenCalled();
    runtime.commitCamera();
    expect(publish).toHaveBeenCalledOnce();
    expect(publish).toHaveBeenCalledWith({ x: 25, y: 20, zoom: 1 });
  });

  it("does not rebuild a scene while the camera changes", () => {
    const port = renderer();
    const runtime = new CanvasRuntime(port, { camera: { x: 0, y: 0, zoom: 1 } });
    runtime.setScene(scene);
    runtime.panBy(10, 10);
    runtime.zoomAt({ x: 100, y: 100 }, 1.2);
    expect(port.scenes).toEqual([scene]);
  });

  it("keeps dragged frames transient and commits one batch on pointer up", () => {
    const port = renderer();
    const commit = vi.fn();
    const runtime = new CanvasRuntime(port, { camera: { x: 0, y: 0, zoom: 1 }, onFramesCommit: commit });
    runtime.setScene(scene);
    runtime.beginNodeDrag(["a"], { x: 20, y: 30 });
    runtime.moveNodeDrag({ x: 60, y: 80 });
    expect(commit).not.toHaveBeenCalled();
    expect(port.setTransientFrames).toHaveBeenLastCalledWith([{ id: "a", x: 50, y: 70, width: 100, height: 60 }]);
    runtime.endNodeDrag();
    expect(commit).toHaveBeenCalledOnce();
    expect(commit).toHaveBeenCalledWith([{ id: "a", x: 50, y: 70, width: 100, height: 60 }]);
  });

  it("preserves the active editing node in the rich DOM set", () => {
    const port = renderer();
    const runtime = new CanvasRuntime(port, { camera: { x: 0, y: 0, zoom: 1 } });
    const visible = Array.from({ length: 110 }, (_, index) => ({ ...scene.nodes[0], id: `visible-${index}`, x: index }));
    runtime.setScene({ ...scene, nodes: [...visible, { ...scene.nodes[0], id: "offscreen", x: 5000 }] });
    const mounted = runtime.visibleDomNodes({ width: 300, height: 200 }, "offscreen").map((node) => node.id);
    expect(mounted).toContain("offscreen");
    expect(mounted).toHaveLength(100);
  });

  it("hit tests GPU-only nodes in screen coordinates", () => {
    const port = renderer();
    const runtime = new CanvasRuntime(port, { camera: { x: 100, y: 50, zoom: 2 } });
    runtime.setScene(scene);
    expect(runtime.hitTest({ x: 140, y: 110 })?.id).toBe("a");
    expect(runtime.hitTest({ x: 10, y: 10 })).toBeNull();
  });
});
