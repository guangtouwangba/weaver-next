import { Background, BackgroundVariant, Controls, MiniMap, PanOnScrollMode, ReactFlow, SelectionMode, type Edge, type Node } from "@xyflow/react";
import { Sparkles } from "lucide-react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { isLocalDevelopment } from "../mcp-client";
import { nodeTypes } from "../lib/graph-view";
import { AgentTaskBanner } from "./AgentTaskBanner";
import { ChangeSetPreviewPanel } from "./ChangeSetPreviewPanel";
import { LayoutCandidatePanel } from "./LayoutCandidatePanel";
import { StaleTaskBanner } from "./StaleTaskBanner";
import { ViewToast } from "./ViewToast";
import type { AgentTask, Candidate, ChangeSetPreview, ChatBindingBootstrap, Layout } from "../types";

export function CanvasStage(props: {
  standaloneDemo: boolean;
  displayedNodes: Node[];
  edges: Edge[];
  onNodesChange: (changes: any) => void;
  onEdgesChange: (changes: any) => void;
  layout: Layout | null;
  handleCanvasWheel: (event: React.WheelEvent<HTMLElement>) => void;
  handleNodeDrag: (event: MouseEvent | TouchEvent, node: Node) => void;
  handleSelectionChange: (params: { nodes: Node[] }) => void;
  draggingNodeId: MutableRefObject<string | null>;
  viewport: MutableRefObject<{ x: number; y: number; zoom: number }>;
  setStatus: Dispatch<SetStateAction<string>>;
  syncContext: () => Promise<void>;
  persistNodeFrame: (node: Node) => void | Promise<void>;
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
  const { standaloneDemo, displayedNodes, edges, onNodesChange, onEdgesChange, layout, handleCanvasWheel, handleNodeDrag, handleSelectionChange, draggingNodeId, viewport, setStatus, syncContext, persistNodeFrame, openNodeViewer, bindingRef, selection, activeTask, cancelActiveTask, changePreview, rejectChangeSet, applyChangeSet, candidates, candidateIndex, setCandidateIndex, rejectLayout, applyCandidate, staleTask, viewToast, setViewToast, restoreProjectView } = props;
  return <section className="canvas-wrap" onWheelCapture={handleCanvasWheel} style={{ "--canvas-background": layout?.theme?.canvas.backgroundColor ?? "#f2f3ed", "--canvas-accent": layout?.theme?.nodeStyles.default?.accentColor ?? "#315cf6" } as React.CSSProperties}>
    <ReactFlow nodes={displayedNodes} edges={edges} nodeTypes={nodeTypes} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
      nodesDraggable elementsSelectable nodeDragThreshold={1} selectNodesOnDrag
      panOnDrag panOnScroll panOnScrollMode={PanOnScrollMode.Free} panOnScrollSpeed={0.72} panActivationKeyCode="Space"
      zoomOnScroll={false} zoomOnPinch zoomOnDoubleClick={false} selectionOnDrag={false} selectionMode={SelectionMode.Partial} selectionKeyCode="Shift"
      autoPanOnNodeDrag autoPanOnConnect autoPanOnSelection autoPanSpeed={18}
      onMove={(_event, nextViewport) => { viewport.current = nextViewport; }} onMoveEnd={(_event, nextViewport) => { viewport.current = nextViewport; void syncContext(); }}
      onNodeDrag={handleNodeDrag} onNodeDragStart={(_event, node) => { draggingNodeId.current = node.id; setStatus("Moving node…"); }} onNodeDragStop={(_event, node) => { draggingNodeId.current = null; void persistNodeFrame(node); }} onNodeDoubleClick={(_event, node) => void openNodeViewer(node.id)} onSelectionChange={handleSelectionChange}
      fitView fitViewOptions={{ padding: 0.18, maxZoom: 1.15 }} minZoom={0.05} maxZoom={4}>
      {layout?.theme?.canvas.pattern !== "plain" ? <Background variant={layout?.theme?.canvas.pattern === "grid" ? BackgroundVariant.Lines : BackgroundVariant.Dots} gap={20} size={1} color={layout?.theme?.canvas.patternColor ?? "#cdd1ca"} /> : null}<Controls showInteractive={false} /><MiniMap pannable zoomable nodeColor={(node) => node.type === "image" ? "#eb775f" : node.type === "link" ? "#282d28" : layout?.theme?.nodeStyles.default?.accentColor ?? "#315cf6"} />
    </ReactFlow>
    <div className="canvas-gesture-hint"><span>Drag canvas</span><span>Scroll to pan</span><span>⌘/Ctrl + scroll to zoom</span><span>Shift to select</span></div>
    <div className="codex-context-status"><Sparkles size={13} /><span>{isLocalDevelopment || standaloneDemo ? "Browser preview. Agent unavailable" : !bindingRef.current ? "Canvas is not bound to a Codex chat" : selection.length ? `${selection.length} selected · bound to this Codex chat` : "Bound to this Codex chat"}</span></div>
    <AgentTaskBanner activeTask={activeTask} cancelActiveTask={cancelActiveTask} />
    <ChangeSetPreviewPanel changePreview={changePreview} rejectChangeSet={rejectChangeSet} applyChangeSet={applyChangeSet} />
    <LayoutCandidatePanel candidates={candidates} candidateIndex={candidateIndex} setCandidateIndex={setCandidateIndex} rejectLayout={rejectLayout} applyCandidate={applyCandidate} />
    <StaleTaskBanner staleTask={staleTask} changePreview={changePreview} candidates={candidates} />
    <ViewToast viewToast={viewToast} setViewToast={setViewToast} restoreProjectView={restoreProjectView} />
  </section>;
}
