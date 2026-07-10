import { Bold, FileImage, Heading2, ImagePlus, List, PanelRightClose } from "lucide-react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import ReactMarkdown from "react-markdown";
import { excerpt } from "../lib/graph-view";
import type { EditorDraft, GraphNode, Manifest } from "../types";

export function DocumentEditorPanel({ activeDocument, draft, saveState, setActiveDocument, load, openDocument, manifest, editDraft, editorMode, setEditorMode, chooseImage, formatMarkdown, editorTextArea, saveDocument }: {
  activeDocument: GraphNode | null;
  draft: EditorDraft | null;
  saveState: "saved" | "dirty" | "saving" | "conflict";
  setActiveDocument: Dispatch<SetStateAction<GraphNode | null>>;
  load: () => Promise<void>;
  openDocument: (nodeId: string, knownNode?: GraphNode) => void | Promise<void>;
  manifest: Manifest | null;
  editDraft: (patch: Partial<EditorDraft>) => void;
  editorMode: "write" | "preview";
  setEditorMode: Dispatch<SetStateAction<"write" | "preview">>;
  chooseImage: (action: "node" | "cover" | "embedded") => void;
  formatMarkdown: (prefix: string, suffix?: string) => void;
  editorTextArea: MutableRefObject<HTMLTextAreaElement | null>;
  saveDocument: () => void | Promise<boolean>;
}) {
  if (!activeDocument || !draft) return null;
  return <aside className="editor-panel" aria-label="Article editor">
    <header><div><span>ARTICLE</span><strong>{saveState === "saving" ? "Saving draft…" : saveState === "dirty" ? "Unsaved changes" : saveState === "conflict" ? "Newer version exists" : "All changes saved"}</strong></div><button aria-label="Close article editor" onClick={() => setActiveDocument(null)}><PanelRightClose size={19} /></button></header>
    {saveState === "conflict" ? <div className="conflict-banner"><strong>Your draft was not overwritten.</strong><p>Another edit changed this project. Copy your draft or reload the latest version.</p><button onClick={async () => { await load(); await openDocument(activeDocument.id); }}>Reload latest</button></div> : null}
    <div className="editor-fields"><label>Title<input value={draft.title} onChange={(event) => editDraft({ title: event.target.value })} /></label><label>Semantic type<select value={draft.semanticType} onChange={(event) => editDraft({ semanticType: event.target.value })}>{manifest?.scenePack.nodeTypes.map((type) => <option key={type.key} value={type.key}>{type.label}</option>)}</select></label></div>
    <div className="editor-tabs" role="tablist"><button role="tab" aria-selected={editorMode === "write"} onClick={() => setEditorMode("write")}>Write</button><button role="tab" aria-selected={editorMode === "preview"} onClick={() => setEditorMode("preview")}>Preview</button><div className="editor-media"><button onClick={() => chooseImage("cover")}><FileImage size={14} /> Cover</button><button onClick={() => chooseImage("embedded")}><ImagePlus size={14} /> Attach</button></div></div>
    {editorMode === "write" ? <><div className="markdown-toolbar" aria-label="Markdown formatting"><button aria-label="Heading" onClick={() => formatMarkdown("## ")}><Heading2 size={16} /></button><button aria-label="Bold" onClick={() => formatMarkdown("**", "**")}><Bold size={16} /></button><button aria-label="Bulleted list" onClick={() => formatMarkdown("- ")}><List size={16} /></button></div><textarea ref={editorTextArea} className="markdown-editor" value={draft.markdown} onChange={(event) => editDraft({ markdown: event.target.value, excerpt: excerpt(event.target.value) })} placeholder="Start with a thought. Markdown is stored as the source of truth." /></> : <article className="markdown-preview"><ReactMarkdown>{draft.markdown || "_Nothing written yet._"}</ReactMarkdown></article>}
    <footer><span>{draft.markdown.length} characters</span><button onClick={() => void saveDocument()} disabled={saveState === "saving" || saveState === "saved"}>Save now</button></footer>
  </aside>;
}
