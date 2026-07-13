import { useEffect, useLayoutEffect, useMemo, useRef, useState, type Dispatch, type MutableRefObject, type PointerEvent as ReactPointerEvent, type SetStateAction } from "react";
import type { EdgeArrows, EdgeLineStyle, EdgeRouting } from "../lib/edge-style";
import { normalizeCanvasTheme } from "../lib/canvas-theme";
import { EdgeStyleBar } from "./EdgeStyleBar";
import { MAX_CANVAS_ZOOM, MIN_CANVAS_ZOOM, wheelZoomMultiplier, type CanvasInteraction, type CanvasViewportState } from "../lib/canvas-viewport";
import { CanvasNavigation } from "./CanvasNavigation";
import { ChangeSetPreviewPanel } from "./ChangeSetPreviewPanel";
import { LayoutCandidatePanel } from "./LayoutCandidatePanel";
import { StaleTaskBanner } from "./StaleTaskBanner";
import { ViewToast } from "./ViewToast";
import type { AgentTask, Candidate, CardData, ChangeSetPreview, ChatBindingBootstrap, GraphEdge, GraphNode, Layout } from "../types";
import { useI18n } from "../lib/i18n";
import { CanvasToolbar } from "./CanvasToolbar";
import type { CanvasTool } from "../lib/canvas-tools";
import type { CanvasEdge, CanvasNode, CanvasViewport } from "../lib/canvas-model";
import { CanvasRuntime, type TransientFrame } from "../lib/canvas-runtime";
import { cameraForBounds, compileRenderScene, hitTestEdge, navigationTarget, resolveLod, screenToWorld, type Camera, type Direction, type Point, type RenderScene } from "../lib/hybrid-renderer";
import { PixiWeaverRenderer } from "../lib/pixi-weaver-renderer";
import { ChartCard } from "./nodes/ChartCard";
import { DocumentCard, ImageCard, LinkCard, VisualGroupCard } from "./nodes/ContentCards";

export type CanvasApi = {
  getViewport(): CanvasViewport;
  setViewport(viewport: CanvasViewport, options?: { duration?: number }): Promise<boolean>;
  fitView(options?: { nodes?: CanvasNode[]; padding?: number; minZoom?: number; maxZoom?: number; duration?: number }): Promise<boolean>;
  screenToWorld(point: Point): Point;
};

type GroupData = { groupId: string; label: string; kind: string; onRename?: (groupId: string, label: string) => void; onDissolve?: (groupId: string) => void };

function ContentNode({ node, selected }: { node: CanvasNode<CardData>; selected: boolean }) {
  const props = { id: node.id, data: node.data, selected };
  if (node.type === "image") return <ImageCard {...props} />;
  if (node.type === "link") return <LinkCard {...props} />;
  if (node.type === "chart") return <ChartCard {...props} />;
  return <DocumentCard {...props} />;
}

function MiniMapOverlay({ scene }: { scene: RenderScene }) {
  const width = 154, height = 102;
  const scale = Math.min(width / Math.max(1, scene.bounds.width), height / Math.max(1, scene.bounds.height));
  return <svg className="hybrid-minimap" width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-label="Minimap">
    {scene.nodes.map((node) => <rect key={node.id} x={(node.x - scene.bounds.x) * scale} y={(node.y - scene.bounds.y) * scale} width={Math.max(2, node.width * scale)} height={Math.max(2, node.height * scale)} rx={1.5} />)}
  </svg>;
}

function TableProjection(props: { graphNodes: GraphNode[]; layout: Layout; selection: string[]; onSelect: (ids: string[]) => void; onOpen: (id: string) => void }) {
  const { graphNodes, layout, selection, onSelect, onOpen } = props;
  const ref = useRef<HTMLDivElement>(null);
  const [range, setRange] = useState({ start: 0, count: 30 });
  type TableColumn = { key: string; label: string; source: "title" | "type" | "property"; propertyKey?: string };
  const projection = layout.projection?.kind === "table" ? layout.projection as { kind: "table"; columns?: TableColumn[] } : null;
  const columns: TableColumn[] = projection?.columns ?? [{ key: "title", label: "Title", source: "title" }];
  const rowHeight = 44;
  const updateRange = () => { const element = ref.current; if (!element) return; setRange({ start: Math.max(0, Math.floor(element.scrollTop / rowHeight) - 5), count: Math.ceil(element.clientHeight / rowHeight) + 10 }); };
  const rows = graphNodes.slice(range.start, range.start + range.count);
  const value = (node: GraphNode, column: (typeof columns)[number]) => column.source === "title" ? node.title : column.source === "type" ? node.type : String(node.properties?.[column.propertyKey ?? column.key] ?? "");
  return <div className="weaver-table-projection" ref={ref} onScroll={updateRange}>
    <div className="weaver-table-head" style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(160px, 1fr))` }}>{columns.map((column) => <strong key={column.key}>{column.label}</strong>)}</div>
    <div className="weaver-table-spacer" style={{ height: graphNodes.length * rowHeight }}>
      <div style={{ transform: `translateY(${range.start * rowHeight}px)` }}>{rows.map((node) => <button type="button" key={node.id} className="weaver-table-row" data-selected={selection.includes(node.id) || undefined} style={{ height: rowHeight, gridTemplateColumns: `repeat(${columns.length}, minmax(160px, 1fr))` }} onClick={(event) => onSelect(event.shiftKey ? [...new Set([...selection, node.id])] : [node.id])} onDoubleClick={() => onOpen(node.id)}>{columns.map((column) => <span key={column.key}>{value(node, column)}</span>)}</button>)}</div>
    </div>
  </div>;
}

export function CanvasStage(props: {
  standaloneDemo: boolean;
  projectId?: string;
  canvasSessionId?: string;
  buildId?: string;
  graphNodes: GraphNode[];
  graphEdges: GraphEdge[];
  displayedNodes: CanvasNode[];
  edges: CanvasEdge[];
  setNodes: Dispatch<SetStateAction<CanvasNode[]>>;
  layout: Layout | null;
  canvasApiRef: MutableRefObject<CanvasApi | null>;
  viewportState: CanvasViewportState;
  miniMapOpen: boolean;
  setMiniMapOpen: Dispatch<SetStateAction<boolean>>;
  beginViewportInteraction: (interaction: Exclude<CanvasInteraction, "idle" | "programmatic">) => void;
  handleViewportMoveEnd: (viewport: CanvasViewport) => void;
  zoomBy: (factor: number, bounds?: DOMRect) => void;
  fitAll: () => void;
  focusSelection: () => void;
  toggleCanvasTheme: () => void | Promise<void>;
  onNodeClick: (nodeId: string) => void;
  handleSelectionChange: (params: { nodes: CanvasNode[] }) => void;
  archiveNodes: (nodeIds: string[]) => void | Promise<void>;
  draggingNodeId: MutableRefObject<string | null>;
  viewport: MutableRefObject<CanvasViewport>;
  setStatus: Dispatch<SetStateAction<string>>;
  syncContext: () => Promise<boolean | undefined>;
  persistNodeFrame: (node: CanvasNode) => void | Promise<void>;
  persistSelectionFrames: (nodes: CanvasNode[]) => void | Promise<void>;
  linkNodes: (source: string, target: string, edgeType: string) => void | Promise<void>;
  availableEdgeTypes: Array<{ key: string; label: string }>;
  createNoteAtScreen: (point: Point) => void | Promise<void>;
  createArticle: () => void | Promise<void>; chooseImage: () => void; openLinkComposer: () => void;
  duplicateSelection: () => void | Promise<void>;
  alignSelection: (axis: "horizontal" | "vertical") => void; distributeSelection: (axis: "horizontal" | "vertical") => void;
  revertLayout: () => void | Promise<void>;
  persistEdgeRoute: (edgeId: string, patch: { lineStyle?: EdgeLineStyle; arrows?: EdgeArrows; routing?: EdgeRouting }) => void | Promise<void>;
  groupSelection: () => void;
  openNodeViewer: (nodeId: string) => void | Promise<void>;
  bindingRef: MutableRefObject<ChatBindingBootstrap | undefined>;
  selection: string[];
  activeTask: AgentTask | null;
  cancelActiveTask: () => void | Promise<void>;
  changePreview: ChangeSetPreview | null;
  rejectChangeSet: () => void | Promise<void>;
  applyChangeSet: () => void | Promise<void>;
  candidates: Candidate[];
  candidateIndex: number;
  setCandidateIndex: Dispatch<SetStateAction<number>>;
  rejectLayout: () => void | Promise<void>;
  applyCandidate: () => void | Promise<void>;
  staleTask: AgentTask | null;
  viewToast: { message: string; undoViewId?: string } | null;
  setViewToast: Dispatch<SetStateAction<{ message: string; undoViewId?: string } | null>>;
  restoreProjectView: (viewId: string) => void | Promise<void>;
}) {
  const { t } = useI18n();
  const rootRef = useRef<HTMLElement>(null);
  const gpuRef = useRef<HTMLDivElement>(null);
  const domWorldRef = useRef<HTMLDivElement>(null);
  const runtimeRef = useRef<CanvasRuntime | null>(null);
  const rendererRef = useRef<PixiWeaverRenderer | null>(null);
  const sceneRef = useRef<RenderScene | null>(null);
  const renderCountRef = useRef(0);
  renderCountRef.current += 1;
  const propsRef = useRef(props);
  propsRef.current = props;
  const isTable = props.layout?.projection?.kind === "table";
  const [tool, setTool] = useState<CanvasTool>("select");
  const [edgeType, setEdgeType] = useState(props.availableEdgeTypes[0]?.key ?? "");
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [renderTick, setRenderTick] = useState(0);
  const [webglError, setWebglError] = useState<Error | null>(null);
  const spaceDown = useRef(false);
  const settleTimer = useRef<number | null>(null);
  const pointers = useRef(new Map<number, Point>());
  const gesture = useRef<null | { kind: "pan"; last: Point } | { kind: "drag" } | { kind: "select"; start: Point } | { kind: "resize"; node: CanvasNode<CardData>; start: Point; frame: TransientFrame; minWidth: number; minHeight: number } | { kind: "pinch"; distance: number; center: Point; camera: Camera }>(null);
  const selectionBoxRef = useRef<HTMLDivElement>(null);
  const connectSource = useRef<string | null>(null);

  useEffect(() => { if (!props.availableEdgeTypes.some((item) => item.key === edgeType)) setEdgeType(props.availableEdgeTypes[0]?.key ?? ""); }, [props.availableEdgeTypes, edgeType]);

  const toLocal = (client: Point): Point => { const bounds = rootRef.current?.getBoundingClientRect(); return { x: client.x - (bounds?.left ?? 0), y: client.y - (bounds?.top ?? 0) }; };
  const settle = () => {
    if (settleTimer.current !== null) window.clearTimeout(settleTimer.current);
    settleTimer.current = window.setTimeout(() => { const runtime = runtimeRef.current; rendererRef.current?.setInteracting(false); if (runtime) { runtime.commitCamera(); const camera = runtime.getCamera(); propsRef.current.handleViewportMoveEnd(camera); void propsRef.current.syncContext(); } setRenderTick((value) => value + 1); settleTimer.current = null; }, 120);
  };

  const commitFrames = (frames: TransientFrame[]) => {
    const current = propsRef.current;
    const byId = new Map(frames.map((frame) => [frame.id, frame]));
    const moved = current.displayedNodes.filter((node) => byId.has(node.id)).map((node) => ({ ...node, position: { x: byId.get(node.id)!.x, y: byId.get(node.id)!.y } }));
    current.setNodes((nodes) => nodes.map((node) => { const frame = byId.get(node.id); return frame ? { ...node, position: { x: frame.x, y: frame.y } } : node; }));
    current.draggingNodeId.current = null;
    if (moved.length > 1) void current.persistSelectionFrames(moved); else if (moved[0]) void current.persistNodeFrame(moved[0]);
  };

  useLayoutEffect(() => {
    const gpu = gpuRef.current, dom = domWorldRef.current;
    if (!gpu || !dom) return;
    const renderer = new PixiWeaverRenderer(dom, setWebglError);
    const runtime = new CanvasRuntime(renderer, { camera: props.viewport.current, onCameraCommit: (camera) => { propsRef.current.viewport.current = camera; }, onFramesCommit: commitFrames });
    rendererRef.current = renderer; runtimeRef.current = runtime;
    void renderer.mount(gpu);
    return () => { if (settleTimer.current !== null) window.clearTimeout(settleTimer.current); runtime.destroy(); runtimeRef.current = null; rendererRef.current = null; };
  }, [isTable]);

  const scene = useMemo(() => { if (!props.layout) return null; const presentation = new Map(props.displayedNodes.filter((node) => node.type !== "visualGroup").map((node) => [node.id, { imageSrc: (node.data as CardData).imageSrc }])); return compileRenderScene(props.graphNodes, props.graphEdges, props.layout, presentation); }, [props.displayedNodes, props.graphEdges, props.graphNodes, props.layout]);
  useEffect(() => { if (!scene) return; sceneRef.current = scene; runtimeRef.current?.setScene(scene); setRenderTick((value) => value + 1); }, [scene]);
  useEffect(() => { runtimeRef.current?.setSelection(props.selection, selectedEdgeId ? [selectedEdgeId] : []); }, [props.selection, selectedEdgeId]);

  useLayoutEffect(() => {
    props.canvasApiRef.current = {
      getViewport: () => runtimeRef.current?.getCamera() ?? props.viewport.current,
      setViewport: async (next) => { runtimeRef.current?.setCamera(next); props.viewport.current = next; setRenderTick((value) => value + 1); return true; },
      fitView: async (options) => {
        const runtime = runtimeRef.current, root = rootRef.current, activeScene = sceneRef.current;
        if (!runtime || !root || !activeScene) return false;
        const requested = options?.nodes?.filter((node) => !node.id.startsWith("visual-group:"));
        const source = requested?.length ? requested.map((node) => ({ x: node.position.x, y: node.position.y, width: Number(node.style?.width ?? node.width ?? 280), height: Number(node.style?.height ?? node.height ?? 160) })) : activeScene.nodes;
        if (!source.length) return false;
        const minX = Math.min(...source.map((item) => item.x)), minY = Math.min(...source.map((item) => item.y));
        const maxX = Math.max(...source.map((item) => item.x + item.width)), maxY = Math.max(...source.map((item) => item.y + item.height));
        const camera = cameraForBounds({ x: minX, y: minY, width: maxX - minX, height: maxY - minY }, { width: root.clientWidth, height: root.clientHeight }, options?.padding ?? 0.18);
        camera.zoom = Math.max(options?.minZoom ?? MIN_CANVAS_ZOOM, Math.min(options?.maxZoom ?? 1.15, camera.zoom));
        runtime.setCamera(camera); props.viewport.current = camera; setRenderTick((value) => value + 1); return true;
      },
      screenToWorld: (point) => screenToWorld(toLocal(point), runtimeRef.current?.getCamera() ?? props.viewport.current),
    };
    return () => { props.canvasApiRef.current = null; };
  }, [props.canvasApiRef, props.viewport, scene]);

  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null; if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
      if (event.code === "Space") spaceDown.current = true;
      if (event.key === "Escape") { setTool("select"); connectSource.current = null; }
      if ((event.key === "Delete" || event.key === "Backspace") && props.selection.length) { event.preventDefault(); void props.archiveNodes(props.selection); }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "d" && props.selection.length) { event.preventDefault(); void props.duplicateSelection(); }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z" && !event.shiftKey) { event.preventDefault(); void props.revertLayout(); }
      const direction = ({ ArrowUp: "up", ArrowRight: "right", ArrowDown: "down", ArrowLeft: "left" } as Partial<Record<string, Direction>>)[event.key];
      if (direction && props.selection[0] && sceneRef.current) {
        const targetId = navigationTarget(sceneRef.current.nodes, props.selection[0], direction);
        if (targetId) {
          event.preventDefault();
          const selected = props.displayedNodes.find((node) => node.id === targetId);
          if (selected) props.handleSelectionChange({ nodes: [selected] });
          requestAnimationFrame(() => rootRef.current?.querySelector<HTMLElement>(`[data-aria-node-id="${CSS.escape(targetId)}"]`)?.focus());
        }
      }
    };
    const up = (event: KeyboardEvent) => { if (event.code === "Space") spaceDown.current = false; };
    window.addEventListener("keydown", down); window.addEventListener("keyup", up);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); };
  }, [props.archiveNodes, props.displayedNodes, props.duplicateSelection, props.handleSelectionChange, props.revertLayout, props.selection]);

  const selectIds = (ids: string[]) => { const selected = new Set(ids); props.handleSelectionChange({ nodes: props.displayedNodes.filter((node) => selected.has(node.id)) }); };

  const beginInteraction = (kind: "pan" | "drag" | "pinch") => { rendererRef.current?.setInteracting(true); props.beginViewportInteraction(kind === "pinch" ? "pinch" : "pan"); };

  const onPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    const local = toLocal({ x: event.clientX, y: event.clientY });
    const target = event.target as HTMLElement;
    if (target.closest("button, input, textarea, select, [contenteditable='true']") && !target.closest("[data-resize-handle]")) return;
    pointers.current.set(event.pointerId, local); event.currentTarget.setPointerCapture(event.pointerId);
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()]; const center = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      gesture.current = { kind: "pinch", distance: Math.hypot(b.x - a.x, b.y - a.y), center, camera: runtimeRef.current?.getCamera() ?? props.viewport.current }; beginInteraction("pinch"); return;
    }
    const wrapper = target.closest<HTMLElement>("[data-node-wrapper]");
    const hit = wrapper ? sceneRef.current?.nodes.find((node) => node.id === wrapper.dataset.nodeId) : runtimeRef.current?.hitTest(local);
    if (hit) {
      const canvasNode = props.displayedNodes.find((node) => node.id === hit.id) as CanvasNode<CardData> | undefined;
      if (!canvasNode) return;
      if (tool === "connect") {
        if (connectSource.current && connectSource.current !== hit.id && edgeType) { void props.linkNodes(connectSource.current, hit.id, edgeType); connectSource.current = null; setTool("select"); }
        else { connectSource.current = hit.id; props.setStatus("Choose a target node"); }
        return;
      }
      const ids = event.shiftKey ? [...new Set([...props.selection, hit.id])] : props.selection.includes(hit.id) ? props.selection : [hit.id];
      selectIds(ids); props.onNodeClick(hit.id); setSelectedEdgeId(null);
      const resizeHandle = target.closest<HTMLElement>("[data-resize-handle]");
      if (resizeHandle) {
        canvasNode.data.onResizeStart?.(hit.id);
        gesture.current = { kind: "resize", node: canvasNode, start: local, frame: { id: hit.id, x: hit.x, y: hit.y, width: hit.width, height: hit.height }, minWidth: Number(resizeHandle.dataset.minWidth ?? 160), minHeight: Number(resizeHandle.dataset.minHeight ?? 100) };
        rendererRef.current?.setInteracting(true); return;
      }
      if (tool === "select") { props.draggingNodeId.current = hit.id; runtimeRef.current?.beginNodeDrag(ids, local); gesture.current = { kind: "drag" }; beginInteraction("drag"); }
      return;
    }
    const camera = runtimeRef.current?.getCamera() ?? props.viewport.current;
    const world = screenToWorld(local, camera);
    const edge = sceneRef.current ? hitTestEdge(sceneRef.current, world, 8 / camera.zoom) : null;
    if (edge && tool === "select") { setSelectedEdgeId(edge.id); selectIds([]); return; }
    setSelectedEdgeId(null);
    if (tool === "note") { void props.createNoteAtScreen({ x: event.clientX, y: event.clientY }); setTool("select"); return; }
    if (tool === "pan" || spaceDown.current || event.button === 1) { gesture.current = { kind: "pan", last: local }; beginInteraction("pan"); return; }
    if (tool === "select") { selectIds([]); gesture.current = { kind: "select", start: local }; if (selectionBoxRef.current) { selectionBoxRef.current.hidden = false; selectionBoxRef.current.style.cssText = `left:${local.x}px;top:${local.y}px;width:0;height:0`; } }
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    const local = toLocal({ x: event.clientX, y: event.clientY }); if (pointers.current.has(event.pointerId)) pointers.current.set(event.pointerId, local);
    const current = gesture.current; if (!current) return;
    if (current.kind === "pinch" && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()]; const distance = Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)); const center = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const anchor = screenToWorld(current.center, current.camera); const zoom = Math.max(MIN_CANVAS_ZOOM, Math.min(MAX_CANVAS_ZOOM, current.camera.zoom * distance / Math.max(1, current.distance)));
      runtimeRef.current?.setCamera({ x: center.x - anchor.x * zoom, y: center.y - anchor.y * zoom, zoom }); return;
    }
    if (current.kind === "pan") { runtimeRef.current?.panBy(local.x - current.last.x, local.y - current.last.y); current.last = local; return; }
    if (current.kind === "drag") { runtimeRef.current?.moveNodeDrag(local); return; }
    if (current.kind === "resize") {
      const camera = runtimeRef.current?.getCamera() ?? props.viewport.current; const dx = (local.x - current.start.x) / camera.zoom, dy = (local.y - current.start.y) / camera.zoom;
      const frame = { ...current.frame, width: Math.max(current.minWidth, current.frame.width + dx), height: Math.max(current.minHeight, current.frame.height + dy) };
      rendererRef.current?.setTransientFrames([frame]); const element = domWorldRef.current?.querySelector<HTMLElement>(`[data-node-wrapper="${CSS.escape(frame.id)}"]`); if (element) { element.style.width = `${frame.width}px`; element.style.height = `${frame.height}px`; } return;
    }
    if (current.kind === "select" && selectionBoxRef.current) { const x = Math.min(current.start.x, local.x), y = Math.min(current.start.y, local.y); selectionBoxRef.current.style.cssText = `left:${x}px;top:${y}px;width:${Math.abs(local.x - current.start.x)}px;height:${Math.abs(local.y - current.start.y)}px`; }
  };

  const finishPointer = (event: ReactPointerEvent<HTMLElement>) => {
    const local = toLocal({ x: event.clientX, y: event.clientY }); pointers.current.delete(event.pointerId);
    if (gesture.current?.kind === "pinch" && pointers.current.size > 0) return;
    const current = gesture.current; gesture.current = null;
    if (current?.kind === "drag") runtimeRef.current?.endNodeDrag();
    if (current?.kind === "resize") { rendererRef.current?.setTransientFrames([]); const camera = runtimeRef.current?.getCamera() ?? props.viewport.current; const frame = { ...current.frame, width: Math.max(current.minWidth, current.frame.width + (local.x - current.start.x) / camera.zoom), height: Math.max(current.minHeight, current.frame.height + (local.y - current.start.y) / camera.zoom) }; current.node.data.onResizeEnd?.(current.node.id, frame); }
    if (current?.kind === "select") {
      const start = screenToWorld(current.start, runtimeRef.current?.getCamera() ?? props.viewport.current), end = screenToWorld(local, runtimeRef.current?.getCamera() ?? props.viewport.current);
      const x = Math.min(start.x, end.x), y = Math.min(start.y, end.y), width = Math.abs(end.x - start.x), height = Math.abs(end.y - start.y);
      const ids = sceneRef.current?.nodes.filter((node) => node.x < x + width && node.x + node.width > x && node.y < y + height && node.y + node.height > y).map((node) => node.id) ?? []; selectIds(ids);
      if (selectionBoxRef.current) selectionBoxRef.current.hidden = true;
    }
    rendererRef.current?.setInteracting(false); settle();
  };

  useEffect(() => {
    const root = rootRef.current;
    if (!root || isTable) return;
    const onWheel = (event: WheelEvent) => {
    event.preventDefault(); const local = toLocal({ x: event.clientX, y: event.clientY }); const runtime = runtimeRef.current; if (!runtime) return;
    rendererRef.current?.setInteracting(true);
    if (event.ctrlKey || event.metaKey) runtime.zoomAt(local, runtime.getCamera().zoom * wheelZoomMultiplier(event)); else runtime.panBy(-event.deltaX, -event.deltaY);
      runtime.commitCamera(); propsRef.current.viewport.current = runtime.getCamera(); settle();
    };
    root.addEventListener("wheel", onWheel, { passive: false });
    return () => root.removeEventListener("wheel", onWheel);
  }, [isTable]);

  const theme = normalizeCanvasTheme(props.layout?.theme); const canvas = theme?.canvas; const dark = canvas?.mode !== "light"; const accent = theme?.nodeStyles.default?.accentColor ?? "#1fa2dc";
  const lod = resolveLod(runtimeRef.current?.getCamera().zoom ?? props.viewport.current.zoom, false);
  const visible = runtimeRef.current && rootRef.current && lod === "rich" ? runtimeRef.current.visibleDomNodes({ width: rootRef.current.clientWidth, height: rootRef.current.clientHeight }, props.selection[0]) : [];
  const ariaNodes = runtimeRef.current && rootRef.current ? runtimeRef.current.visibleDomNodes({ width: rootRef.current.clientWidth, height: rootRef.current.clientHeight }, props.selection[0]) : [];
  const visibleIds = new Set(visible.map((node) => node.id));
  const groupNodes = props.displayedNodes.filter((node) => node.type === "visualGroup") as CanvasNode<GroupData>[];
  const contentNodes = props.displayedNodes.filter((node) => visibleIds.has(node.id) && node.type !== "visualGroup") as CanvasNode<CardData>[];
  const selectedEdge = selectedEdgeId ? props.edges.find((edge) => edge.id === selectedEdgeId) ?? null : null;

  if (props.layout?.projection?.kind === "table") return <section ref={rootRef} className="canvas-wrap table-view-wrap" data-view-type={props.layout.viewType} data-projection={props.layout.projection.kind} data-theme={dark ? "dark" : "light"} style={{ "--canvas-background": canvas?.backgroundColor ?? "#0a0a0a", "--canvas-accent": accent } as React.CSSProperties}>
    <div ref={gpuRef} className="weaver-gpu-layer table-renderer-reserve" aria-hidden /><div ref={domWorldRef} className="weaver-dom-world table-renderer-reserve" />
    <TableProjection graphNodes={props.graphNodes} layout={props.layout} selection={props.selection} onSelect={selectIds} onOpen={(id) => void props.openNodeViewer(id)} />
    <CanvasToolbar tool={tool} setTool={setTool} disabled={props.standaloneDemo} edgeTypes={props.availableEdgeTypes} edgeType={edgeType} setEdgeType={setEdgeType} selectionCount={props.selection.length} onCreateArticle={() => void props.createArticle()} onImage={props.chooseImage} onLink={props.openLinkComposer} onCopy={() => void navigator.clipboard?.writeText(JSON.stringify({ type: "weaver-selection", nodeIds: props.selection }))} onDuplicate={() => void props.duplicateSelection()} onAlign={props.alignSelection} onDistribute={props.distributeSelection} onGroup={props.groupSelection} onUndo={() => void props.revertLayout()} onRedo={() => {}} />
  </section>;

  return <section ref={rootRef} className="canvas-wrap hybrid-canvas" data-view-type={props.layout?.viewType} data-projection={props.layout?.projection?.kind} data-lod={lod} data-theme={dark ? "dark" : "light"} data-render-tick={renderTick} data-render-count={renderCountRef.current} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={finishPointer} onPointerCancel={finishPointer} style={{ "--canvas-background": canvas?.backgroundColor ?? "#0a0a0a", "--canvas-accent": accent, "--canvas-pattern-color": canvas?.patternColor ?? "#aeb5aa", "--canvas-pattern-gap": `${canvas?.patternGap ?? 20}px` } as React.CSSProperties}>
    <div ref={gpuRef} className="weaver-gpu-layer" aria-hidden />
    <div ref={domWorldRef} className="weaver-dom-world">{groupNodes.map((node) => <div key={node.id} className="weaver-dom-group" style={{ left: node.position.x, top: node.position.y, width: Number(node.style?.width ?? 300), height: Number(node.style?.height ?? 200) }}><VisualGroupCard id={node.id} data={node.data} selected={false} /></div>)}{contentNodes.map((node) => <div key={node.id} className="weaver-dom-node" data-node-wrapper data-node-id={node.id} style={{ left: node.position.x, top: node.position.y, width: Number(node.style?.width ?? node.width ?? 280), height: Number(node.style?.height ?? node.height ?? 160), ...node.style }} onDoubleClick={() => void props.openNodeViewer(node.id)}><ContentNode node={node} selected={props.selection.includes(node.id)} /></div>)}</div>
    <div className="weaver-aria-focus-layer" aria-label="Canvas elements">{ariaNodes.map((node, index) => <button key={node.id} type="button" data-aria-node-id={node.id} tabIndex={props.selection.includes(node.id) || (!props.selection.length && index === 0) ? 0 : -1} aria-label={`${node.semanticType}: ${node.title}`} aria-pressed={props.selection.includes(node.id)} onFocus={() => { const selected = props.displayedNodes.find((item) => item.id === node.id); if (selected) props.handleSelectionChange({ nodes: [selected] }); }} />)}</div>
    <div ref={selectionBoxRef} className="hybrid-selection-box" hidden />
    {props.miniMapOpen && scene ? <MiniMapOverlay scene={scene} /> : null}
    {webglError ? <div className="webgl-error" role="alert"><strong>WEBGL_RENDERER_UNAVAILABLE</strong><span>{webglError.message}</span><small>Project {props.projectId ?? "unknown"} · View {props.layout?.viewId ?? "unknown"} · Session {props.canvasSessionId ?? "unknown"} · Build {props.buildId ?? "unknown"} · graph r{props.layout?.graphRevision ?? 0} · layout r{props.layout?.layoutRevision ?? 0} · binding r{props.bindingRef.current?.bindingRevision ?? 0}</small></div> : null}
    <CanvasToolbar tool={tool} setTool={setTool} disabled={props.standaloneDemo} edgeTypes={props.availableEdgeTypes} edgeType={edgeType} setEdgeType={setEdgeType} selectionCount={props.selection.length} onCreateArticle={() => void props.createArticle()} onImage={props.chooseImage} onLink={props.openLinkComposer} onCopy={() => void navigator.clipboard?.writeText(JSON.stringify({ type: "weaver-selection", nodeIds: props.selection }))} onDuplicate={() => void props.duplicateSelection()} onAlign={props.alignSelection} onDistribute={props.distributeSelection} onGroup={props.groupSelection} onUndo={() => void props.revertLayout()} onRedo={() => {}} />
    <CanvasNavigation state={{ ...(runtimeRef.current?.getCamera() ?? props.viewport.current), interaction: props.viewportState.interaction, lod: props.viewportState.lod }} miniMapOpen={props.miniMapOpen} hasSelection={Boolean(props.selection.length)} dark={dark} onZoomOut={(bounds) => props.zoomBy(1 / 1.2, bounds)} onZoomIn={(bounds) => props.zoomBy(1.2, bounds)} onFit={props.fitAll} onFocus={props.focusSelection} onToggleMiniMap={() => props.setMiniMapOpen((open) => !open)} onToggleTheme={() => void props.toggleCanvasTheme()} onDeleteSelection={() => void props.archiveNodes(props.selection)} onGroupSelection={props.groupSelection} selectionCount={props.selection.length} />
    <div className="canvas-gesture-hint"><span>{t("dragCanvas")}</span><span>{t("scrollPan")}</span><span>{t("scrollZoom")}</span><span>{t("shiftSelect")}</span></div>
    <EdgeStyleBar edge={selectedEdge} persistEdgeRoute={props.persistEdgeRoute} />
    <ChangeSetPreviewPanel changePreview={props.changePreview} rejectChangeSet={props.rejectChangeSet} applyChangeSet={props.applyChangeSet} />
    <LayoutCandidatePanel candidates={props.candidates} candidateIndex={props.candidateIndex} setCandidateIndex={props.setCandidateIndex} rejectLayout={props.rejectLayout} applyCandidate={props.applyCandidate} />
    <StaleTaskBanner staleTask={props.staleTask} changePreview={props.changePreview} candidates={props.candidates} />
    <ViewToast viewToast={props.viewToast} setViewToast={props.setViewToast} restoreProjectView={props.restoreProjectView} />
  </section>;
}
