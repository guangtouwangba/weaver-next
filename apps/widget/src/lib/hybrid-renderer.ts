import type { GraphEdge, GraphNode, Layout } from "../types";
import RBush from "rbush";

export type Point = { x: number; y: number };
export type Size = { width: number; height: number };
export type Bounds = Point & Size;
export type Camera = Point & { zoom: number };
export type Lod = "rich" | "compact" | "overview";
export type Direction = "up" | "right" | "down" | "left";

export type RenderNode = {
  id: string;
  kind: GraphNode["contentKind"];
  title: string;
  semanticType: string;
  x: number;
  y: number;
  width: number;
  height: number;
  pinned: boolean;
  content: GraphNode["content"];
  imageSrc?: string;
  zIndex?: number;
};

export type RenderEdge = { id: string; sourceId: string; targetId: string; semanticType: string; waypoints: Point[]; color?: string; width?: number; dashed?: boolean; arrows?: "none" | "forward" | "both" };
export type RenderGroup = { id: string; x: number; y: number; width: number; height: number; label?: string; kind: string };
export type RenderScene = { revisionKey: string; projection: NonNullable<Layout["projection"]>["kind"]; projectionSpec?: Layout["projection"]; nodes: RenderNode[]; edges: RenderEdge[]; groups: RenderGroup[]; bounds: Bounds; theme?: Layout["theme"] };

const MIN_ZOOM = 0.08;
const MAX_ZOOM = 2.4;

export const screenToWorld = (point: Point, camera: Camera): Point => ({ x: (point.x - camera.x) / camera.zoom, y: (point.y - camera.y) / camera.zoom });
export const worldToScreen = (point: Point, camera: Camera): Point => ({ x: point.x * camera.zoom + camera.x, y: point.y * camera.zoom + camera.y });

export function zoomCameraAt(camera: Camera, point: Point, zoom: number): Camera {
  const nextZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));
  const world = screenToWorld(point, camera);
  return { x: point.x - world.x * nextZoom, y: point.y - world.y * nextZoom, zoom: nextZoom };
}

export function cameraForBounds(bounds: Bounds, viewport: Size, padding: number): Camera {
  const availableWidth = Math.max(1, viewport.width * (1 - padding * 2));
  const availableHeight = Math.max(1, viewport.height * (1 - padding * 2));
  const zoom = Math.max(MIN_ZOOM, Math.min(1.15, availableWidth / Math.max(1, bounds.width), availableHeight / Math.max(1, bounds.height)));
  return {
    x: viewport.width / 2 - (bounds.x + bounds.width / 2) * zoom,
    y: viewport.height / 2 - (bounds.y + bounds.height / 2) * zoom,
    zoom,
  };
}

export function resolveLod(zoom: number, interacting: boolean): Lod {
  if (zoom < 0.3) return "overview";
  if (interacting || zoom < 0.65) return "compact";
  return "rich";
}

function sceneBounds(nodes: RenderNode[]): Bounds {
  if (!nodes.length) return { x: 0, y: 0, width: 1, height: 1 };
  const minX = Math.min(...nodes.map((node) => node.x));
  const minY = Math.min(...nodes.map((node) => node.y));
  const maxX = Math.max(...nodes.map((node) => node.x + node.width));
  const maxY = Math.max(...nodes.map((node) => node.y + node.height));
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function compileRenderScene(nodes: GraphNode[], edges: GraphEdge[], layout: Layout, presentation: Map<string, { imageSrc?: string }> = new Map()): RenderScene {
  const renderNodes = nodes.map((node, index) => {
    const frame = layout.nodes[node.id] ?? { x: (index % 4) * 300, y: Math.floor(index / 4) * 190, width: 280, height: 160, pinned: false };
    return { id: node.id, kind: node.contentKind, title: node.title, semanticType: node.type, x: frame.x, y: frame.y, width: frame.width, height: frame.height, pinned: frame.pinned, content: node.content, imageSrc: presentation.get(node.id)?.imageSrc, zIndex: typeof frame.zIndex === "number" ? frame.zIndex : undefined } satisfies RenderNode;
  });
  const edgeTheme = layout.theme?.edgeStyles.default;
  const renderEdges: RenderEdge[] = edges.map((edge) => { const route = layout.edges?.[edge.id]; const stored = route?.arrows ?? edgeTheme?.arrows; const arrows: RenderEdge["arrows"] = stored === "none" || stored === "both" ? stored : "forward"; return { id: edge.id, sourceId: edge.sourceNodeId, targetId: edge.targetNodeId, semanticType: edge.type, waypoints: route?.waypoints ?? [], color: edgeTheme?.color, width: edgeTheme?.width, dashed: route?.lineStyle === "dashed" || edgeTheme?.dashed, arrows }; });
  return {
    revisionKey: `${layout.graphRevision}:${layout.layoutRevision}:${layout.viewId}`,
    projection: (layout.projection?.kind ?? layout.viewType) as RenderScene["projection"],
    projectionSpec: layout.projection,
    nodes: renderNodes,
    edges: renderEdges,
    groups: Object.values(layout.groups ?? {}).map((group) => ({ id: group.groupId, x: group.x, y: group.y, width: group.width, height: group.height, label: group.label, kind: group.kind ?? "interaction" })),
    bounds: sceneBounds(renderNodes),
    theme: layout.theme,
  };
}

export function navigationTarget(nodes: RenderNode[], currentId: string, direction: Direction): string | null {
  const current = nodes.find((node) => node.id === currentId);
  if (!current) return null;
  const cx = current.x + current.width / 2;
  const cy = current.y + current.height / 2;
  const candidates = nodes.flatMap((node) => {
    if (node.id === currentId) return [];
    const dx = node.x + node.width / 2 - cx;
    const dy = node.y + node.height / 2 - cy;
    const primary = direction === "right" ? dx : direction === "left" ? -dx : direction === "down" ? dy : -dy;
    if (primary <= 0) return [];
    const secondary = direction === "right" || direction === "left" ? Math.abs(dy) : Math.abs(dx);
    if (primary < secondary * 0.5) return [];
    return [{ id: node.id, score: primary + secondary * 0.35 }];
  });
  candidates.sort((a, b) => a.score - b.score || a.id.localeCompare(b.id));
  return candidates[0]?.id ?? null;
}

export function edgePoints(edge: RenderEdge, nodes: Map<string, RenderNode>): Point[] {
  const source = nodes.get(edge.sourceId);
  const target = nodes.get(edge.targetId);
  if (!source || !target) return [];
  return [
    { x: source.x + source.width / 2, y: source.y + source.height / 2 },
    ...edge.waypoints,
    { x: target.x + target.width / 2, y: target.y + target.height / 2 },
  ];
}

export function edgePointsForFrames(edge: RenderEdge, nodes: Map<string, RenderNode>, frames: Array<{ id: string; x: number; y: number; width: number; height: number }>): Point[] {
  if (!frames.length) return edgePoints(edge, nodes);
  const transient = new Map(nodes);
  for (const frame of frames) {
    const node = transient.get(frame.id);
    if (node) transient.set(frame.id, { ...node, ...frame });
  }
  return edgePoints(edge, transient);
}

function segmentDistance(point: Point, from: Point, to: Point): number {
  const dx = to.x - from.x, dy = to.y - from.y;
  const lengthSquared = dx * dx + dy * dy;
  if (!lengthSquared) return Math.hypot(point.x - from.x, point.y - from.y);
  const t = Math.max(0, Math.min(1, ((point.x - from.x) * dx + (point.y - from.y) * dy) / lengthSquared));
  return Math.hypot(point.x - (from.x + dx * t), point.y - (from.y + dy * t));
}

export function hitTestEdge(scene: RenderScene, point: Point, tolerance: number): RenderEdge | null {
  const nodes = new Map(scene.nodes.map((node) => [node.id, node]));
  let nearest: { edge: RenderEdge; distance: number } | null = null;
  for (const edge of scene.edges) {
    const points = edgePoints(edge, nodes);
    for (let index = 1; index < points.length; index += 1) {
      const distance = segmentDistance(point, points[index - 1], points[index]);
      if (distance <= tolerance && (!nearest || distance < nearest.distance)) nearest = { edge, distance };
    }
  }
  return nearest?.edge ?? null;
}

type IndexedNode = { minX: number; minY: number; maxX: number; maxY: number; node: RenderNode; order: number };

export class SceneIndex {
  private readonly tree = new RBush<IndexedNode>();
  constructor(nodes: RenderNode[]) {
    this.tree.load(nodes.map((node, order) => ({ minX: node.x, minY: node.y, maxX: node.x + node.width, maxY: node.y + node.height, node, order })));
  }
  search(bounds: Bounds): RenderNode[] {
    return this.tree.search({ minX: bounds.x, minY: bounds.y, maxX: bounds.x + bounds.width, maxY: bounds.y + bounds.height }).sort((a, b) => a.order - b.order).map((item) => item.node);
  }
  hit(point: Point): RenderNode | null {
    return this.tree.search({ minX: point.x, minY: point.y, maxX: point.x, maxY: point.y }).sort((a, b) => (b.node.zIndex ?? 0) - (a.node.zIndex ?? 0) || b.order - a.order)[0]?.node ?? null;
  }
}

export const visibleDomNodeIds = (index: SceneIndex, bounds: Bounds, limit = 100): string[] => index.search(bounds).slice(0, limit).map((node) => node.id);
