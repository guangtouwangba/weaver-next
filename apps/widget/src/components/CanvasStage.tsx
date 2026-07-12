import { Background, BackgroundVariant, MiniMap, PanOnScrollMode, ReactFlow, SelectionMode, type Edge, type EdgeChange, type Node, type NodeChange, type Viewport } from "@xyflow/react";
import { useState, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { edgeTypes, nodeTypes } from "../lib/graph-view";
import type { EdgeArrows, EdgeLineStyle, EdgeRouting } from "../lib/edge-style";
import { EdgeStyleBar } from "./EdgeStyleBar";
import { canvasPatternOpacity, MAX_CANVAS_ZOOM, MIN_CANVAS_ZOOM, type CanvasInteraction, type CanvasViewportState } from "../lib/canvas-viewport";
import { WeaverEdgeMarkers } from "./WeaverEdge";
import { CanvasNavigation } from "./CanvasNavigation";
import { ChangeSetPreviewPanel } from "./ChangeSetPreviewPanel";
import { LayoutCandidatePanel } from "./LayoutCandidatePanel";
import { StaleTaskBanner } from "./StaleTaskBanner";
import { ViewToast } from "./ViewToast";
import type { AgentTask, Candidate, ChangeSetPreview, ChatBindingBootstrap, Layout } from "../types";
import { useI18n } from "../lib/i18n";

export function CanvasStage(props: {
  standaloneDemo: boolean;
  displayedNodes: Node[];
  edges: Edge[];
  onNodesChange: (changes: NodeChange<Node>[]) => void;
  onEdgesChange: (changes: EdgeChange<Edge>[]) => void;
  layout: Layout | null;
  handleCanvasWheel: (event: React.WheelEvent<HTMLElement>) => void;
  viewportState: CanvasViewportState;
  miniMapOpen: boolean;
  setMiniMapOpen: Dispatch<SetStateAction<boolean>>;
  beginViewportInteraction: (interaction: Exclude<CanvasInteraction, "idle" | "programmatic">) => void;
  handleViewportMove: (viewport: Viewport) => void;
  handleViewportMoveEnd: (viewport: Viewport) => void;
  zoomBy: (factor: number, bounds?: DOMRect) => void;
  fitAll: () => void;
  focusSelection: () => void;
  toggleCanvasTheme: () => void | Promise<void>;
  onNodeClick: (nodeId: string) => void;
  handleNodeDrag: (event: MouseEvent | TouchEvent, node: Node) => void;
  handleSelectionChange: (params: { nodes: Node[] }) => void;
  archiveNodes: (nodeIds: string[]) => void | Promise<void>;
  draggingNodeId: MutableRefObject<string | null>;
  viewport: MutableRefObject<{ x: number; y: number; zoom: number }>;
  setStatus: Dispatch<SetStateAction<string>>;
  syncContext: () => Promise<boolean | undefined>;
  persistNodeFrame: (node: Node) => void | Promise<void>;
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
  const { displayedNodes, edges, onNodesChange, onEdgesChange, layout, handleCanvasWheel, viewportState, miniMapOpen, setMiniMapOpen, beginViewportInteraction, handleViewportMove, handleViewportMoveEnd, zoomBy, fitAll, focusSelection, toggleCanvasTheme, onNodeClick, handleNodeDrag, handleSelectionChange, archiveNodes, draggingNodeId, viewport, setStatus, syncContext, persistNodeFrame, persistEdgeRoute, groupSelection, openNodeViewer, selection, changePreview, rejectChangeSet, applyChangeSet, candidates, candidateIndex, setCandidateIndex, rejectLayout, applyCandidate, staleTask, viewToast, setViewToast, restoreProjectView } = props;
  const { t } = useI18n();
  // A single-edge selection surfaces the style override bar. Track the id and
  // resolve the live Edge from props so its data stays fresh after an override.
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const selectedEdge = selectedEdgeId ? edges.find((edge) => edge.id === selectedEdgeId) ?? null : null;
  const onSelectionChange = (params: { nodes: Node[]; edges: Edge[] }) => { handleSelectionChange({ nodes: params.nodes }); setSelectedEdgeId(params.nodes.length === 0 && params.edges.length === 1 ? params.edges[0].id : null); };
  const canvas = layout?.theme?.canvas;
  const patternOpacity = canvasPatternOpacity(viewportState.zoom, canvas?.patternOpacity ?? 0.5);
  // TapNow is dark-first: treat an unset mode as dark, only an explicit "light" theme stays light.
  const dark = canvas?.mode !== "light";
  return <section className="canvas-wrap" data-lod={viewportState.lod} data-theme={dark ? "dark" : "light"} onWheelCapture={handleCanvasWheel} style={{ "--canvas-background": canvas?.backgroundColor ?? "#0a0a0a", "--canvas-accent": layout?.theme?.nodeStyles.default?.accentColor ?? "#1fa2dc" } as React.CSSProperties}>
    <WeaverEdgeMarkers />
    <ReactFlow nodes={displayedNodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
      nodesDraggable elementsSelectable nodeDragThreshold={1} selectNodesOnDrag
      panOnDrag panOnScroll panOnScrollMode={PanOnScrollMode.Free} panOnScrollSpeed={0.72} panActivationKeyCode="Space"
      zoomOnScroll={false} zoomOnPinch zoomOnDoubleClick={false} selectionOnDrag={false} selectionMode={SelectionMode.Partial} selectionKeyCode="Shift"
      autoPanOnNodeDrag autoPanOnConnect autoPanOnSelection autoPanSpeed={18}
      onMoveStart={() => beginViewportInteraction("pan")} onMove={(_event, nextViewport) => { viewport.current = nextViewport; handleViewportMove(nextViewport); }} onMoveEnd={(_event, nextViewport) => { viewport.current = nextViewport; handleViewportMoveEnd(nextViewport); void syncContext(); }}
      onNodeClick={(_event, node) => onNodeClick(node.id)} onNodeDrag={handleNodeDrag} onNodeDragStart={(_event, node) => { draggingNodeId.current = node.id; setStatus("Moving node…"); }} onNodeDragStop={(_event, node) => { draggingNodeId.current = null; void persistNodeFrame(node); }} onNodeDoubleClick={(_event, node) => void openNodeViewer(node.id)} onSelectionChange={onSelectionChange} onNodesDelete={(deleted) => void archiveNodes(deleted.map((node) => node.id))}
      fitView fitViewOptions={{ padding: 0.18, maxZoom: 1.15 }} minZoom={MIN_CANVAS_ZOOM} maxZoom={MAX_CANVAS_ZOOM}>
      {canvas?.pattern !== "plain" ? <Background variant={canvas?.pattern === "grid" ? BackgroundVariant.Lines : BackgroundVariant.Dots} gap={viewportState.zoom < .25 ? (canvas?.patternGap ?? 20) * 2 : canvas?.patternGap ?? 20} size={canvas?.patternSize ?? 1} color={canvas?.patternColor ?? "#aeb5aa"} style={{ opacity: patternOpacity, transition: "opacity 120ms ease" }} /> : null}
      {miniMapOpen ? <MiniMap pannable zoomable nodeStrokeWidth={0} maskColor={dark ? "rgba(13,15,14,.72)" : "rgba(242,243,237,.72)"} nodeColor={(node) => node.type === "image" ? "#eb775f" : node.type === "link" ? dark ? "#d9ddd8" : "#282d28" : layout?.theme?.nodeStyles.default?.accentColor ?? "#315cf6"} /> : null}
    </ReactFlow>
    <CanvasNavigation state={viewportState} miniMapOpen={miniMapOpen} hasSelection={Boolean(selection.length)} dark={dark} onZoomOut={(bounds) => zoomBy(1 / 1.2, bounds)} onZoomIn={(bounds) => zoomBy(1.2, bounds)} onFit={fitAll} onFocus={focusSelection} onToggleMiniMap={() => setMiniMapOpen((open) => !open)} onToggleTheme={() => void toggleCanvasTheme()} onDeleteSelection={() => void archiveNodes(selection)} onGroupSelection={groupSelection} selectionCount={selection.length} />
    <div className="canvas-gesture-hint"><span>{t("dragCanvas")}</span><span>{t("scrollPan")}</span><span>{t("scrollZoom")}</span><span>{t("shiftSelect")}</span></div>
    <EdgeStyleBar edge={selectedEdge} persistEdgeRoute={persistEdgeRoute} />
    <ChangeSetPreviewPanel changePreview={changePreview} rejectChangeSet={rejectChangeSet} applyChangeSet={applyChangeSet} />
    <LayoutCandidatePanel candidates={candidates} candidateIndex={candidateIndex} setCandidateIndex={setCandidateIndex} rejectLayout={rejectLayout} applyCandidate={applyCandidate} />
    <StaleTaskBanner staleTask={staleTask} changePreview={changePreview} candidates={candidates} />
    <ViewToast viewToast={viewToast} setViewToast={setViewToast} restoreProjectView={restoreProjectView} />
  </section>;
}
