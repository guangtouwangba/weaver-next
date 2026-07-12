import { useCallback, useEffect, useMemo, useState } from "react";
import type { Node, NodeProps } from "@xyflow/react";
import { ExternalLink, FileImage, FileText, Lock, X } from "lucide-react";
import type { CardData } from "../../types";
import { NodeShell } from "./NodeShell";
import { NodeBlockEditor } from "./NodeBlockEditor";
import { useI18n } from "../../lib/i18n";

export function DocumentCard({ data, id, selected }: NodeProps<Node<CardData>>) {
  const { t } = useI18n();
  // Lazily pull the node's full Markdown the first time it is selected, then keep
  // it so the card renders as a live document (read-only until selected).
  const [markdown, setMarkdown] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!selected || markdown !== null || loading || !data.fetchMarkdown) return;
    setLoading(true);
    void data.fetchMarkdown(id).then(setMarkdown).finally(() => setLoading(false));
  }, [selected, markdown, loading, id, data]);
  const onSave = useCallback((next: string) => { setMarkdown(next); void data.saveMarkdown?.(id, next); }, [data, id]);
  const onLink = useCallback((targetNodeId: string) => { void data.linkReference?.(id, targetNodeId); }, [data, id]);
  const references = useMemo(() => (data.references ?? []).filter((node) => node.id !== id), [data.references, id]);
  const hasDoc = markdown !== null && markdown.trim().length > 0;
  return <NodeShell data={data} className="document-card" id={id} selected={selected}>
    {data.imageSrc ? <img className="document-cover" src={data.imageSrc} alt="" /> : null}
    <div className="card-kicker"><FileText size={11} /> {data.semanticType}</div>
    <strong>{data.title || t("untitledArticle")}</strong>
    {markdown !== null
      ? <div className="node-doc" onDoubleClick={(event) => selected && event.stopPropagation()}><NodeBlockEditor markdown={markdown} editable={selected} placeholder={t("blockPlaceholder")} references={references} onLink={onLink} onSave={onSave} /></div>
      : <p className="node-doc-rest">{data.excerpt || t("openToWrite")}</p>}
    <div className="card-foot">{data.pinned ? <><Lock size={11} /> {t("fixedLabel")}</> : hasDoc || loading ? t("document") : t("openToWrite")}</div>
  </NodeShell>;
}

export function ImageCard({ data, id, selected }: NodeProps<Node<CardData>>) {
  const { t } = useI18n();
  return <NodeShell data={data} className="image-card" id={id} selected={selected}>
    <div className="image-stage">{data.imageSrc ? <img src={data.imageSrc} alt={data.caption || data.title} /> : <FileImage size={30} />}</div>
    <div className="image-caption"><span>{data.semanticType}</span><strong>{data.caption || data.title || t("untitledImage")}</strong></div>
  </NodeShell>;
}

export function LinkCard({ data, id, selected }: NodeProps<Node<CardData>>) {
  const { t } = useI18n();
  return <NodeShell data={data} className="link-card" id={id} selected={selected}>
    {data.imageSrc ? <img className="link-cover" src={data.imageSrc} alt="" /> : <div className="link-mark"><ExternalLink size={22} /></div>}
    <div className="link-copy"><span>{data.domain || data.status || "LINK"}</span><strong>{data.title || t("untitledLink")}</strong><p>{data.description || t("previewPending")}</p></div>
  </NodeShell>;
}

type GroupData = { groupId: string; label: string; kind: string; onRename?: (groupId: string, label: string) => void; onDissolve?: (groupId: string) => void };
export function VisualGroupCard({ data }: NodeProps<Node<GroupData>>) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(data.label);
  const commit = () => { setEditing(false); if (draft.trim() && draft !== data.label) data.onRename?.(data.groupId, draft.trim()); else setDraft(data.label); };
  // Projection regions are derived by a View projection — read-only, not operable.
  const operable = data.kind !== "projection" && Boolean(data.onRename);
  // Only the title bar takes pointer events; the region body stays click-through
  // so nodes and edges above it remain fully interactive.
  return <section className="visual-group-card" data-kind={data.kind}>
    <div className="visual-group-title nodrag nowheel" data-operable={operable || undefined}>
      {editing
        ? <input autoFocus value={draft} onChange={(event) => setDraft(event.target.value)} onBlur={commit} onKeyDown={(event) => { if (event.key === "Enter") commit(); if (event.key === "Escape") { setDraft(data.label); setEditing(false); } }} />
        : <strong onDoubleClick={operable ? () => { setDraft(data.label); setEditing(true); } : undefined}>{data.label}</strong>}
      {operable && data.onDissolve ? <button type="button" className="visual-group-dissolve" title={data.kind} onClick={() => data.onDissolve?.(data.groupId)}><X size={11} /></button> : null}
    </div>
  </section>;
}
