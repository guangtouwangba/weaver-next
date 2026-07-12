import { Bold, FileImage, Heading2, ImagePlus, List, PanelRightClose } from "lucide-react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import ReactMarkdown from "react-markdown";
import { excerpt } from "../lib/graph-view";
import type { EditorDraft, GraphNode, Manifest } from "../types";
import { useI18n } from "../lib/i18n";

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
  const { t } = useI18n();
  if (!activeDocument || !draft) return null;
  return <aside className="editor-panel" aria-label={t("article")}>
    <header><div><span>{t("article")}</span><strong>{saveState === "saving" ? t("savingDraft") : saveState === "dirty" ? t("unsavedChanges") : saveState === "conflict" ? t("newerVersion") : t("allSaved")}</strong></div><button aria-label={t("close")} onClick={() => setActiveDocument(null)}><PanelRightClose size={19} /></button></header>
    {saveState === "conflict" ? <div className="conflict-banner"><strong>{t("draftProtected")}</strong><p>{t("conflictHelp")}</p><button onClick={async () => { await load(); await openDocument(activeDocument.id); }}>{t("reloadLatest")}</button></div> : null}
    <div className="editor-fields"><label>{t("title")}<input value={draft.title} onChange={(event) => editDraft({ title: event.target.value })} /></label><label>{t("semanticType")}<select value={draft.semanticType} onChange={(event) => editDraft({ semanticType: event.target.value })}>{manifest?.scenePack.nodeTypes.map((type) => <option key={type.key} value={type.key}>{type.label}</option>)}</select></label></div>
    <div className="editor-tabs" role="tablist"><button role="tab" aria-selected={editorMode === "write"} onClick={() => setEditorMode("write")}>{t("write")}</button><button role="tab" aria-selected={editorMode === "preview"} onClick={() => setEditorMode("preview")}>{t("preview")}</button><div className="editor-media"><button onClick={() => chooseImage("cover")}><FileImage size={14} /> {t("cover")}</button><button onClick={() => chooseImage("embedded")}><ImagePlus size={14} /> {t("attach")}</button></div></div>
    {editorMode === "write" ? <><div className="markdown-toolbar" aria-label={t("markdownFormatting")}><button aria-label={t("heading")} onClick={() => formatMarkdown("## ")}><Heading2 size={16} /></button><button aria-label={t("bold")} onClick={() => formatMarkdown("**", "**")}><Bold size={16} /></button><button aria-label={t("bulletList")} onClick={() => formatMarkdown("- ")}><List size={16} /></button></div><textarea ref={editorTextArea} className="markdown-editor" value={draft.markdown} onChange={(event) => editDraft({ markdown: event.target.value, excerpt: excerpt(event.target.value) })} placeholder={t("writingPlaceholder")} /></> : <article className="markdown-preview"><ReactMarkdown>{draft.markdown || `_${t("nothingWritten")}_`}</ReactMarkdown></article>}
    <footer><span>{draft.markdown.length} {t("characters")}</span><button onClick={() => void saveDocument()} disabled={saveState === "saving" || saveState === "saved"}>{t("saveNow")}</button></footer>
  </aside>;
}
