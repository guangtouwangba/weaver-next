import { ExternalLink, FileImage, Pencil, X } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";
import ReactMarkdown from "react-markdown";
import type { GraphNode } from "../types";
import { useI18n } from "../lib/i18n";

export function NodeViewerModal({ activeViewer, setActiveViewer, openDocument, assetPreviews }: { activeViewer: GraphNode | null; setActiveViewer: Dispatch<SetStateAction<GraphNode | null>>; openDocument: (nodeId: string, knownNode?: GraphNode) => void | Promise<void>; assetPreviews: Record<string, string> }) {
  const { t } = useI18n();
  if (!activeViewer) return null;
  const viewerAssetId = activeViewer.content.kind === "image" ? activeViewer.content.assetId : activeViewer.content.kind === "document" ? activeViewer.content.coverAssetId : activeViewer.content.kind === "link" ? activeViewer.content.imageAssetId : undefined;
  const viewerImage = viewerAssetId ? assetPreviews[viewerAssetId] : undefined;
  return <div className="node-viewer-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setActiveViewer(null); }}><article className="node-viewer" role="dialog" aria-modal="true" aria-label={`View ${activeViewer.title}`}>
    <header><div><span>{activeViewer.type} · {activeViewer.contentKind}</span><h2>{activeViewer.title}</h2></div><div className="node-viewer-actions">{activeViewer.contentKind === "document" ? <button onClick={() => { const node = activeViewer; setActiveViewer(null); void openDocument(node.id, node); }}><Pencil size={15} /> {t("edit")}</button> : null}<button aria-label={t("close")} onClick={() => setActiveViewer(null)}><X size={18} /></button></div></header>
    <div className="node-viewer-body">
      {activeViewer.content.kind === "document" ? <article className="node-viewer-markdown"><ReactMarkdown>{activeViewer.content.markdown || activeViewer.content.excerpt || "_Empty document_"}</ReactMarkdown></article> : null}
      {activeViewer.content.kind === "image" ? <figure>{viewerImage ? <img src={viewerImage} alt={activeViewer.content.alt || activeViewer.title} /> : <FileImage size={54} />}<figcaption>{activeViewer.content.caption || activeViewer.content.alt}</figcaption></figure> : null}
      {activeViewer.content.kind === "link" ? <div className="node-viewer-link">{viewerImage ? <img src={viewerImage} alt="" /> : <ExternalLink size={42} />}<p>{activeViewer.content.description}</p><a href={activeViewer.content.url} target="_blank" rel="noreferrer">{activeViewer.content.url}</a></div> : null}
    </div>
  </article></div>;
}
