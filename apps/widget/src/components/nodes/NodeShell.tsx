import React from "react";
import { Handle, NodeResizer, Position } from "@xyflow/react";
import { Maximize2 } from "lucide-react";
import type { CardData } from "../../types";

export function NodeShell({ children, data, className, id, selected }: { children: React.ReactNode; data: CardData; className: string; id: string; selected: boolean }) {
  const minimum = data.contentKind === "image" ? { width: 160, height: 140 } : data.contentKind === "link" ? { width: 220, height: 120 } : { width: 180, height: 100 };
  return <>
    <NodeResizer isVisible={selected} minWidth={minimum.width} minHeight={minimum.height} maxWidth={900} maxHeight={700} color="#315cf6" onResizeStart={() => data.onResizeStart?.(id)} onResizeEnd={(_event, frame) => data.onResizeEnd?.(id, frame)} />
    <article className={`content-card ${className}`} data-pinned={data.pinned} data-selected={selected}>
      <Handle id="target-left" type="target" position={Position.Left} /><Handle id="source-left" type="source" position={Position.Left} />
      <Handle id="target-top" type="target" position={Position.Top} /><Handle id="source-top" type="source" position={Position.Top} />
      {children}<div className="card-open-hint"><Maximize2 size={10} /> double-click</div>
      <Handle id="target-right" type="target" position={Position.Right} /><Handle id="source-right" type="source" position={Position.Right} />
      <Handle id="target-bottom" type="target" position={Position.Bottom} /><Handle id="source-bottom" type="source" position={Position.Bottom} />
    </article>
  </>;
}
