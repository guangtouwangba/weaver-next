import { SceneIndex, screenToWorld, visibleDomNodeIds, zoomCameraAt, type Bounds, type Camera, type Point, type RenderNode, type RenderScene, type Size } from "./hybrid-renderer";

export type SelectionState = { nodeIds: string[]; edgeIds: string[]; groupIds: string[] };
export type TransientFrame = { id: string; x: number; y: number; width: number; height: number };

export interface RendererPort {
  setScene(scene: RenderScene): void;
  setCamera(camera: Camera): void;
  setSelection(selection: SelectionState): void;
  setTransientFrames(frames: TransientFrame[]): void;
  destroy(): void;
}

type RuntimeOptions = {
  camera: Camera;
  onCameraCommit?: (camera: Camera) => void;
  onFramesCommit?: (frames: TransientFrame[]) => void;
};

export class CanvasRuntime {
  private camera: Camera;
  private scene: RenderScene | null = null;
  private index = new SceneIndex([]);
  private drag: { start: Point; frames: TransientFrame[]; current: TransientFrame[] } | null = null;

  constructor(private readonly renderer: RendererPort, private readonly options: RuntimeOptions) {
    this.camera = { ...options.camera };
    renderer.setCamera(this.camera);
  }

  getCamera(): Camera { return { ...this.camera }; }

  setScene(scene: RenderScene) {
    this.scene = scene;
    this.index = new SceneIndex(scene.nodes);
    this.renderer.setScene(scene);
  }

  setSelection(nodeIds: string[], edgeIds: string[] = [], groupIds: string[] = []) {
    this.renderer.setSelection({ nodeIds, edgeIds, groupIds });
  }

  setCamera(camera: Camera) {
    this.camera = { ...camera };
    this.renderer.setCamera(this.camera);
  }

  panBy(dx: number, dy: number) {
    this.setCamera({ ...this.camera, x: this.camera.x + dx, y: this.camera.y + dy });
  }

  zoomAt(point: Point, zoom: number) { this.setCamera(zoomCameraAt(this.camera, point, zoom)); }

  commitCamera() { this.options.onCameraCommit?.(this.getCamera()); }

  hitTest(screenPoint: Point): RenderNode | null { return this.index.hit(screenToWorld(screenPoint, this.camera)); }

  beginNodeDrag(nodeIds: string[], screenPoint: Point) {
    if (!this.scene) return;
    const selected = new Set(nodeIds);
    const frames = this.scene.nodes.filter((node) => selected.has(node.id)).map(({ id, x, y, width, height }) => ({ id, x, y, width, height }));
    if (!frames.length) return;
    this.drag = { start: screenToWorld(screenPoint, this.camera), frames, current: frames };
  }

  moveNodeDrag(screenPoint: Point) {
    if (!this.drag) return;
    const point = screenToWorld(screenPoint, this.camera);
    const dx = point.x - this.drag.start.x;
    const dy = point.y - this.drag.start.y;
    this.drag.current = this.drag.frames.map((frame) => ({ ...frame, x: frame.x + dx, y: frame.y + dy }));
    this.renderer.setTransientFrames(this.drag.current);
  }

  endNodeDrag() {
    if (!this.drag) return;
    const frames = this.drag.current;
    this.drag = null;
    this.renderer.setTransientFrames([]);
    this.options.onFramesCommit?.(frames);
  }

  visibleDomNodes(viewport: Size, activeEditingNodeId?: string): RenderNode[] {
    if (!this.scene) return [];
    const topLeft = screenToWorld({ x: -viewport.width, y: -viewport.height }, this.camera);
    const bottomRight = screenToWorld({ x: viewport.width * 2, y: viewport.height * 2 }, this.camera);
    const bounds: Bounds = { x: topLeft.x, y: topLeft.y, width: bottomRight.x - topLeft.x, height: bottomRight.y - topLeft.y };
    const ids = visibleDomNodeIds(this.index, bounds, 100);
    if (activeEditingNodeId && !ids.includes(activeEditingNodeId) && this.scene.nodes.some((node) => node.id === activeEditingNodeId)) { ids.length = Math.min(ids.length, 99); ids.push(activeEditingNodeId); }
    const visible = new Set(ids);
    return this.scene.nodes.filter((node) => visible.has(node.id));
  }

  destroy() { this.renderer.destroy(); }
}
