import type { Node, NodeProps } from "@xyflow/react";
import { ExternalLink, FileImage, FileText, Lock } from "lucide-react";
import type { CardData } from "../../types";
import { NodeShell } from "./NodeShell";

export function DocumentCard({ data, id, selected }: NodeProps<Node<CardData>>) {
  return <NodeShell data={data} className="document-card" id={id} selected={selected}>
    {data.imageSrc ? <img className="document-cover" src={data.imageSrc} alt="" /> : null}
    <div className="card-kicker"><FileText size={11} /> {data.semanticType}</div>
    <strong>{data.title || "Untitled article"}</strong>
    <p>{data.excerpt || "Open to begin writing."}</p>
    <div className="card-foot">{data.pinned ? <><Lock size={11} /> fixed</> : "document"}</div>
  </NodeShell>;
}

export function ImageCard({ data, id, selected }: NodeProps<Node<CardData>>) {
  return <NodeShell data={data} className="image-card" id={id} selected={selected}>
    <div className="image-stage">{data.imageSrc ? <img src={data.imageSrc} alt={data.caption || data.title} /> : <FileImage size={30} />}</div>
    <div className="image-caption"><span>{data.semanticType}</span><strong>{data.caption || data.title || "Untitled image"}</strong></div>
  </NodeShell>;
}

export function LinkCard({ data, id, selected }: NodeProps<Node<CardData>>) {
  return <NodeShell data={data} className="link-card" id={id} selected={selected}>
    {data.imageSrc ? <img className="link-cover" src={data.imageSrc} alt="" /> : <div className="link-mark"><ExternalLink size={22} /></div>}
    <div className="link-copy"><span>{data.domain || data.status || "LINK"}</span><strong>{data.title || "Untitled link"}</strong><p>{data.description || "Preview details will appear here."}</p></div>
  </NodeShell>;
}

export function VisualGroupCard({ data }: NodeProps<Node<{ label: string; kind: string }>>) { return <section className="visual-group-card" data-kind={data.kind}><strong>{data.label}</strong></section>; }
