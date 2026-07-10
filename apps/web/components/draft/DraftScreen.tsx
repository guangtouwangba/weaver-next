import { Check, FileText } from "lucide-react";
import { useDraftScreen } from "../../hooks/useDraftScreen";
import { Voice } from "../../lib/types";
import { ProjectTopbar } from "../ProjectTopbar";
import { OutlinePoint } from "./OutlinePoint";

export function DraftScreen({ voice, setVoice, draftFormat, setDraftFormat }: { voice: Voice; setVoice: (voice: Voice) => void; draftFormat: string; setDraftFormat: (format: string) => void }) {
  const formats = ["Article", "Deck", "X Thread", "Video", "Newsletter"];
  const { draft, draftStatus, exportPreview, regenerateDraft, exportMarkdown } = useDraftScreen(voice, draftFormat);

  return (
    <section className="draft-page">
      <ProjectTopbar active="draft" setScreen={() => undefined} voice={voice} onRegenerate={regenerateDraft} onExport={exportMarkdown} />
      <div className="draft-tabs">
        <span className="eyebrow">OUTPUT</span>
        {formats.map((format) => (
          <button key={format} className={draftFormat === format ? "active" : ""} disabled={format === "Newsletter"} onClick={() => setDraftFormat(format)}>
            {format === "Article" ? <FileText size={14} /> : null}
            {format}
            {draftFormat === format ? <Check size={14} /> : null}
          </button>
        ))}
        <span className="source-promise">
          {draftStatus === "generating" ? "Generating from branch context" : draftStatus === "exported" ? "Markdown export ready" : draftStatus === "live" ? "API draft live" : "Same source - same Voice - citations carried"}
        </span>
      </div>
      <div className="draft-layout">
        <aside className="outline-panel">
          <div className="side-title"><strong>Argument outline</strong><span className="mono-pill">OPTIONAL</span></div>
          <p>The shared spine. Every format renders from these points - change them once and all outputs follow.</p>
          <OutlinePoint number="01" tag="DEMAND-SIDE" text="Attention is zero-sum: a subscription competes with sleep, not money." target="P 2" />
          <OutlinePoint number="02" tag="SUPPLY-SIDE" text="Bundling could pool audiences instead of splitting them." target="P 3" />
          <div className="outline-empty">Reorder to shape the narrative. AI can propose a skeleton.</div>
        </aside>
        <article className="article-view">
          <p className="eyebrow">{draft.format.toUpperCase()} - WOVEN FROM YOUR BRANCHES</p>
          <h1>{draft.title}</h1>
          {draft.paragraphs.map((paragraph, index) => (
            <p key={`${draft.id}-${index}`} className={index === 0 ? "lead" : ""}>
              {paragraph}
              {index > 0 && index <= draft.citations.length ? <sup>{index}</sup> : null}
            </p>
          ))}
          <hr />
          <p className="eyebrow">FOOTNOTES</p>
          <ol className="footnotes">
            {draft.citations.map((citation) => (
              <li key={citation.id}>{citation.source_label} - {citation.quote}</li>
            ))}
          </ol>
          {exportPreview ? (
            <pre className="export-preview">{exportPreview.slice(0, 1400)}</pre>
          ) : null}
        </article>
        <div className="voice-dock">
          {(["Academic", "Casual", "Professional"] as Voice[]).map((item) => (
            <button key={item} className={voice === item ? "active" : ""} onClick={() => setVoice(item)}>{item}</button>
          ))}
        </div>
      </div>
    </section>
  );
}
