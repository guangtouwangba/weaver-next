import "pixi.js/unsafe-eval";
import { Application, Assets, Container, Graphics, Sprite, Text, type Texture } from "pixi.js";
import type { RendererPort, SelectionState, TransientFrame } from "./canvas-runtime";
import { edgePoints, edgePointsForFrames, resolveLod, type Camera, type Lod, type RenderNode, type RenderScene } from "./hybrid-renderer";

function colorNumber(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const hex = value.match(/^#([0-9a-f]{6})$/i)?.[1];
  if (hex) return Number.parseInt(hex, 16);
  const short = value.match(/^#([0-9a-f]{3})$/i)?.[1];
  if (short) return Number.parseInt(short.split("").map((part) => part + part).join(""), 16);
  return fallback;
}

function drawArrow(graphics: Graphics, from: { x: number; y: number }, to: { x: number; y: number }, color: number, width: number) {
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const size = 7 + width * 1.5;
  const left = { x: to.x - Math.cos(angle - 0.48) * size, y: to.y - Math.sin(angle - 0.48) * size };
  const right = { x: to.x - Math.cos(angle + 0.48) * size, y: to.y - Math.sin(angle + 0.48) * size };
  graphics.poly([to.x, to.y, left.x, left.y, right.x, right.y]).fill({ color, alpha: 0.8 });
}

export class PixiWeaverRenderer implements RendererPort {
  private app: Application | null = null;
  private readonly world = new Container();
  private readonly groupLayer = new Container();
  private readonly edgeLayer = new Container();
  private readonly nodeLayer = new Container();
  private readonly imageLayer = new Container();
  private readonly transientLayer = new Container();
  private scene: RenderScene | null = null;
  private camera: Camera = { x: 0, y: 0, zoom: 1 };
  private selection: SelectionState = { nodeIds: [], edgeIds: [], groupIds: [] };
  private transientFrames: TransientFrame[] = [];
  private interacting = false;
  private lod: Lod = "rich";
  private destroyed = false;
  private readonly textures = new Map<string, Texture>();
  private imageGeneration = 0;

  constructor(private readonly domWorld: HTMLElement, private readonly onError: (error: Error) => void) {
    this.world.addChild(this.groupLayer, this.edgeLayer, this.nodeLayer, this.imageLayer, this.transientLayer);
    this.world.eventMode = "none";
  }

  async mount(container: HTMLElement) {
    try {
      const app = new Application();
      await app.init({ preference: "webgl", resizeTo: container, backgroundAlpha: 0, antialias: true, autoDensity: true, resolution: Math.min(2, window.devicePixelRatio || 1), powerPreference: "high-performance" });
      if (this.destroyed) { app.destroy(true, { children: true, texture: true, textureSource: true }); return; }
      this.app = app;
      app.canvas.className = "weaver-gpu-canvas";
      app.stage.addChild(this.world);
      container.prepend(app.canvas);
      this.applyCamera();
      this.redraw();
      performance.mark("weaver:renderer-ready");
    } catch (cause) {
      this.onError(cause instanceof Error ? cause : new Error(String(cause)));
    }
  }

  setScene(scene: RenderScene) { const retained = new Set(scene.nodes.map((node) => node.imageSrc).filter((value): value is string => Boolean(value))); for (const source of this.textures.keys()) if (!retained.has(source)) { this.textures.delete(source); void Assets.unload(source); } this.scene = scene; this.updateInteractionVisibility(); this.redraw(); }
  setSelection(selection: SelectionState) { this.selection = selection; this.redrawNodes(); }
  setTransientFrames(frames: TransientFrame[]) { this.transientFrames = frames; this.redrawTransient(); }

  setCamera(camera: Camera) {
    this.camera = { ...camera };
    const nextLod = this.interactionLod(camera.zoom);
    const changed = nextLod !== this.lod;
    this.lod = nextLod;
    this.applyCamera();
    if (changed) this.redrawNodes();
  }

  setInteracting(interacting: boolean) {
    this.interacting = interacting;
    this.domWorld.parentElement?.setAttribute("data-interacting", interacting ? "true" : "false");
    this.updateInteractionVisibility();
    const nextLod = this.interactionLod(this.camera.zoom);
    if (nextLod !== this.lod) { this.lod = nextLod; this.redrawNodes(); }
  }

  private interactionLod(zoom: number): Lod {
    if (this.interacting && (this.scene?.nodes.length ?? 0) >= 500) return "overview";
    return resolveLod(zoom, this.interacting);
  }

  private updateInteractionVisibility() {
    // Software WebGL spends most of a large-scene gesture rasterizing unchanged
    // edge geometry. Keep nodes and transient drag edges live, then restore the
    // complete base edge layer as soon as the 120 ms interaction settle fires.
    this.edgeLayer.renderable = !(this.interacting && (this.scene?.edges.length ?? 0) >= 500);
  }

  private applyCamera() {
    this.world.position.set(this.camera.x, this.camera.y);
    this.world.scale.set(this.camera.zoom);
    this.domWorld.style.transform = `translate3d(${this.camera.x}px, ${this.camera.y}px, 0) scale(${this.camera.zoom})`;
    this.domWorld.style.setProperty("--camera-inverse-zoom", String(1 / this.camera.zoom));
  }

  private redraw() { this.redrawGroups(); this.redrawEdges(); this.redrawNodes(); this.redrawTransient(); }

  private redrawGroups() {
    this.groupLayer.removeChildren().forEach((child) => child.destroy());
    if (!this.scene) return;
    const graphics = new Graphics();
    const bounds = this.scene.bounds;
    if (this.scene.projection === "timeline") {
      const y = bounds.y + bounds.height / 2;
      graphics.moveTo(bounds.x - 80, y).lineTo(bounds.x + bounds.width + 80, y).stroke({ color: 0x69727d, alpha: 0.65, width: 2 });
      for (let tick = 0; tick <= 10; tick += 1) { const x = bounds.x + bounds.width * tick / 10; graphics.moveTo(x, y - 8).lineTo(x, y + 8).stroke({ color: 0x69727d, alpha: 0.45, width: 1 }); }
    }
    if (this.scene.projection === "matrix") {
      const centerX = bounds.x + bounds.width / 2, centerY = bounds.y + bounds.height / 2;
      graphics.rect(bounds.x - 48, bounds.y - 48, bounds.width + 96, bounds.height + 96).fill({ color: 0x20242a, alpha: 0.16 }).stroke({ color: 0x69727d, alpha: 0.45, width: 1 });
      graphics.moveTo(centerX, bounds.y - 48).lineTo(centerX, bounds.y + bounds.height + 48).moveTo(bounds.x - 48, centerY).lineTo(bounds.x + bounds.width + 48, centerY).stroke({ color: 0x69727d, alpha: 0.5, width: 1 });
    }
    if (this.scene.projection === "board" && this.scene.groups.length === 0) {
      const lanes = 4, gap = 18, laneWidth = Math.max(240, (bounds.width - gap * (lanes - 1)) / lanes);
      for (let lane = 0; lane < lanes; lane += 1) graphics.roundRect(bounds.x + lane * (laneWidth + gap), bounds.y - 48, laneWidth, bounds.height + 96, 10).fill({ color: 0x20242a, alpha: 0.18 }).stroke({ color: 0x69727d, alpha: 0.35, width: 1 });
    }
    for (const group of this.scene.groups) {
      graphics.roundRect(group.x, group.y, group.width, group.height, 12).fill({ color: 0x20242a, alpha: group.kind === "projection" ? 0.12 : 0.2 }).stroke({ color: 0x68717c, alpha: 0.5, width: 1 });
    }
    this.groupLayer.addChild(graphics);
    if (this.scene.projection === "matrix") {
      const labels = (this.scene.projectionSpec as { quadrantLabels?: string[] } | undefined)?.quadrantLabels ?? ["Q1", "Q2", "Q3", "Q4"];
      const points = [[bounds.x + 12, bounds.y + 8], [bounds.x + bounds.width / 2 + 12, bounds.y + 8], [bounds.x + 12, bounds.y + bounds.height / 2 + 8], [bounds.x + bounds.width / 2 + 12, bounds.y + bounds.height / 2 + 8]];
      labels.slice(0, 4).forEach((label, index) => { const text = new Text({ text: label, style: { fontFamily: "Inter, system-ui, sans-serif", fontSize: 12, fontWeight: "600", fill: 0x98a1ab } }); text.position.set(points[index][0], points[index][1]); this.groupLayer.addChild(text); });
    }
  }

  private redrawEdges() {
    this.edgeLayer.removeChildren().forEach((child) => child.destroy());
    if (!this.scene) return;
    const nodeMap = new Map(this.scene.nodes.map((node) => [node.id, node]));
    const buckets = new Map<string, { graphics: Graphics; color: number; width: number; arrows: Array<{ points: { x: number; y: number }[]; arrows: "none" | "forward" | "both" }> }>();
    for (const edge of this.scene.edges) {
      const color = colorNumber(edge.color, 0x77808a);
      const width = edge.width ?? 1.35;
      const key = `${color}:${width}:${Boolean(edge.dashed)}`;
      const bucket = buckets.get(key) ?? { graphics: new Graphics(), color, width, arrows: [] };
      buckets.set(key, bucket);
      const points = edgePoints(edge, nodeMap);
      if (points.length < 2) continue;
      if (edge.dashed) {
        for (let index = 1; index < points.length; index += 1) {
          const from = points[index - 1], to = points[index];
          const length = Math.hypot(to.x - from.x, to.y - from.y);
          const pieces = Math.max(1, Math.floor(length / 10));
          for (let piece = 0; piece < pieces; piece += 2) {
            const a = piece / pieces, b = Math.min(1, (piece + 1) / pieces);
            bucket.graphics.moveTo(from.x + (to.x - from.x) * a, from.y + (to.y - from.y) * a).lineTo(from.x + (to.x - from.x) * b, from.y + (to.y - from.y) * b);
          }
        }
      } else {
        bucket.graphics.moveTo(points[0].x, points[0].y);
        for (const point of points.slice(1)) bucket.graphics.lineTo(point.x, point.y);
      }
      bucket.arrows.push({ points, arrows: edge.arrows ?? "forward" });
    }
    for (const bucket of buckets.values()) {
      bucket.graphics.stroke({ color: bucket.color, alpha: 0.55, width: bucket.width, cap: "round", join: "round" });
      for (const item of bucket.arrows) {
        if (item.arrows === "forward" || item.arrows === "both") drawArrow(bucket.graphics, item.points.at(-2)!, item.points.at(-1)!, bucket.color, bucket.width);
        if (item.arrows === "both") drawArrow(bucket.graphics, item.points[1], item.points[0], bucket.color, bucket.width);
      }
      this.edgeLayer.addChild(bucket.graphics);
    }
  }

  private nodeFrame(node: RenderNode) {
    const transient = this.transientFrames.find((frame) => frame.id === node.id);
    return transient ?? node;
  }

  private redrawNodes() {
    this.nodeLayer.removeChildren().forEach((child) => child.destroy());
    if (!this.scene) return;
    const graphics = new Graphics();
    const selected = new Set(this.selection.nodeIds);
    const theme = this.scene.theme?.nodeStyles;
    for (const node of this.scene.nodes) {
      const frame = this.nodeFrame(node);
      const style = theme?.[node.semanticType] ?? theme?.default;
      const fill = colorNumber(style?.fill, 0x171a1f);
      const border = colorNumber(style?.borderColor, 0x525a64);
      const accent = colorNumber(style?.accentColor, 0x1fa2dc);
      if (this.lod === "overview") graphics.roundRect(frame.x, frame.y, Math.max(12, frame.width), Math.max(8, frame.height), 5).fill({ color: accent, alpha: 0.72 });
      else if (this.lod === "compact") graphics.roundRect(frame.x, frame.y, frame.width, frame.height, style?.borderRadius ?? 8).fill({ color: fill, alpha: 0.96 }).stroke({ color: selected.has(node.id) ? accent : border, width: selected.has(node.id) ? 2.5 : 1, alpha: 0.95 });
      else if (selected.has(node.id)) graphics.roundRect(frame.x - 2, frame.y - 2, frame.width + 4, frame.height + 4, (style?.borderRadius ?? 8) + 2).stroke({ color: accent, width: 2.5 });
    }
    this.nodeLayer.addChild(graphics);
    if (this.lod === "compact") {
      for (const node of this.scene.nodes) {
        const frame = this.nodeFrame(node);
        const text = new Text({ text: node.title, style: { fontFamily: "Inter, system-ui, sans-serif", fontSize: 13, fontWeight: "600", fill: 0xe8ebef, wordWrap: true, wordWrapWidth: Math.max(40, frame.width - 28) } });
        text.position.set(frame.x + 14, frame.y + 14);
        text.resolution = Math.min(2, window.devicePixelRatio || 1);
        this.nodeLayer.addChild(text);
      }
    }
    this.redrawImages();
  }

  private redrawImages() {
    this.imageLayer.removeChildren().forEach((child) => child.destroy());
    const generation = ++this.imageGeneration;
    if (!this.scene || this.lod !== "compact") return;
    for (const node of this.scene.nodes) {
      const source = node.imageSrc; if (!source) continue;
      const add = (texture: Texture) => { if (this.destroyed || generation !== this.imageGeneration || this.lod !== "compact") return; const frame = this.nodeFrame(node); const sprite = new Sprite(texture); sprite.position.set(frame.x + 1, frame.y + 1); sprite.width = Math.max(1, frame.width - 2); sprite.height = Math.max(1, frame.height - 2); sprite.alpha = node.kind === "image" ? 0.72 : 0.28; this.imageLayer.addChild(sprite); };
      const cached = this.textures.get(source); if (cached) { add(cached); continue; }
      void Assets.load<Texture>(source).then((texture) => { this.textures.set(source, texture); add(texture); }).catch(() => {});
    }
  }

  private redrawTransient() {
    this.transientLayer.removeChildren().forEach((child) => child.destroy());
    if (!this.transientFrames.length || !this.scene) return;
    const graphics = new Graphics();
    const moved = new Set(this.transientFrames.map((frame) => frame.id));
    const nodes = new Map(this.scene.nodes.map((node) => [node.id, node]));
    for (const edge of this.scene.edges) {
      if (!moved.has(edge.sourceId) && !moved.has(edge.targetId)) continue;
      const points = edgePointsForFrames(edge, nodes, this.transientFrames);
      if (points.length < 2) continue;
      graphics.moveTo(points[0].x, points[0].y);
      for (const point of points.slice(1)) graphics.lineTo(point.x, point.y);
      graphics.stroke({ color: colorNumber(edge.color, 0x77808a), alpha: 0.9, width: Math.max(1.5, edge.width ?? 1.35), cap: "round", join: "round" });
    }
    for (const frame of this.transientFrames) graphics.roundRect(frame.x, frame.y, frame.width, frame.height, 8).fill({ color: 0x171a1f, alpha: 0.9 }).stroke({ color: 0x1fa2dc, width: 2 });
    this.transientLayer.addChild(graphics);
  }

  destroy() {
    this.destroyed = true;
    for (const source of this.textures.keys()) void Assets.unload(source);
    this.textures.clear();
    this.app?.destroy(true, { children: true, texture: true, textureSource: true });
    this.app = null;
  }
}
