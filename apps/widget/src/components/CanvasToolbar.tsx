import { AlignCenterHorizontal, AlignCenterVertical, BringToFront, Copy, FileText, Frame, Hand, ImagePlus, Link2, MousePointer2, Network, NotebookPen, Redo2, Rows3, Undo2 } from "lucide-react";
import type { CanvasTool } from "../lib/canvas-tools";
import { useI18n } from "../lib/i18n";

export function CanvasToolbar(props: {
  tool: CanvasTool; setTool: (tool: CanvasTool) => void; disabled: boolean;
  edgeTypes: Array<{ key: string; label: string }>; edgeType: string; setEdgeType: (type: string) => void;
  selectionCount: number; onCreateArticle: () => void; onImage: () => void; onLink: () => void;
  onCopy: () => void; onDuplicate: () => void; onAlign: (axis: "horizontal" | "vertical") => void;
  onDistribute: (axis: "horizontal" | "vertical") => void; onGroup: () => void; onUndo: () => void; onRedo: () => void;
}) {
  const { tool, setTool, disabled, edgeTypes, edgeType, setEdgeType, selectionCount } = props;
  const { t } = useI18n();
  const toolButton = (value: CanvasTool, label: string, icon: React.ReactNode, unavailable = false) => <button type="button" aria-label={label} title={label} data-tool={value} data-active={tool === value} disabled={disabled || unavailable} onClick={() => setTool(value)}>{icon}</button>;
  return <aside className="canvas-toolbar" role="toolbar" aria-label="Canvas tools" data-active-tool={tool}>
    <div className="canvas-tool-group">
      {toolButton("select", "Select", <MousePointer2 size={17} />)}
      {toolButton("pan", "Pan", <Hand size={17} />)}
      {toolButton("note", "Note", <NotebookPen size={17} />)}
      {toolButton("connect", "Connect", <Network size={17} />, edgeTypes.length === 0)}
      {toolButton("frame", "Frame", <Frame size={17} />)}
    </div>
    {tool === "connect" && edgeTypes.length ? <label className="edge-type-picker"><span>{t("relationLabel")}</span><select aria-label="Relation type" value={edgeType} onChange={(event) => setEdgeType(event.target.value)}>{edgeTypes.map((type) => <option value={type.key} key={type.key}>{type.label}</option>)}</select></label> : null}
    <div className="canvas-tool-group">
      <button type="button" aria-label="Article" title="Article" disabled={disabled} onClick={props.onCreateArticle}><FileText size={17} /></button>
      <button type="button" aria-label="Image" title="Image" disabled={disabled} onClick={props.onImage}><ImagePlus size={17} /></button>
      <button type="button" aria-label="Link" title="Link" disabled={disabled} onClick={props.onLink}><Link2 size={17} /></button>
    </div>
    <div className="canvas-tool-group canvas-selection-tools" data-visible={selectionCount > 0}>
      <button aria-label="Copy selection" disabled={!selectionCount} onClick={props.onCopy}><Copy size={16} /></button>
      <button aria-label="Duplicate selection" disabled={!selectionCount} onClick={props.onDuplicate}><BringToFront size={16} /></button>
      <button aria-label="Align horizontally" disabled={selectionCount < 2} onClick={() => props.onAlign("horizontal")}><AlignCenterVertical size={16} /></button>
      <button aria-label="Align vertically" disabled={selectionCount < 2} onClick={() => props.onAlign("vertical")}><AlignCenterHorizontal size={16} /></button>
      <button aria-label="Distribute horizontally" disabled={selectionCount < 3} onClick={() => props.onDistribute("horizontal")}><Rows3 size={16} /></button>
      <button aria-label="Create frame" disabled={!selectionCount} onClick={props.onGroup}><Frame size={16} /></button>
    </div>
    <div className="canvas-tool-group canvas-history-tools">
      <button aria-label="Undo" disabled={disabled} onClick={props.onUndo}><Undo2 size={16} /></button>
      <button aria-label="Redo" disabled title="Redo history is unavailable until a new edit is made"><Redo2 size={16} /></button>
    </div>
  </aside>;
}
