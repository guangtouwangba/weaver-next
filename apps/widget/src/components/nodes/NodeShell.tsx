import React from "react";
import { Maximize2 } from "lucide-react";
import type { CardData } from "../../types";
import { useI18n } from "../../lib/i18n";

export function NodeShell({ children, data, className, id, selected }: { children: React.ReactNode; data: CardData; className: string; id: string; selected: boolean }) {
  const { t } = useI18n();
  const minimum = data.contentKind === "image" ? { width: 160, height: 140 } : data.contentKind === "link" ? { width: 220, height: 120 } : data.contentKind === "chart" ? (data.chart?.chartType === "metric" ? { width: 150, height: 96 } : { width: 220, height: 170 }) : { width: 180, height: 100 };
  return <>
    {selected ? <button type="button" className="canvas-resize-handle" data-resize-handle data-min-width={minimum.width} data-min-height={minimum.height} aria-label="Resize node" /> : null}
    <article className={`content-card ${className}`} data-node-card data-node-id={id} data-pinned={data.pinned} data-selected={selected}>
      <i className="canvas-connect-handle left" data-connect-handle="left" />
      <i className="canvas-connect-handle top" data-connect-handle="top" />
      {children}<div className="card-open-hint"><Maximize2 size={10} /> {t("doubleClick")}</div>
      <i className="canvas-connect-handle right" data-connect-handle="right" />
      <i className="canvas-connect-handle bottom" data-connect-handle="bottom" />
    </article>
  </>;
}
