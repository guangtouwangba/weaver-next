import { useEffect, useMemo, useRef } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import type { Editor, Range } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { DragHandle } from "@tiptap/extension-drag-handle-react";
import { Markdown } from "tiptap-markdown";
import { GripVertical } from "lucide-react";
import { createSlashCommand, type SlashItem } from "./slash-command";
import { useI18n } from "../../lib/i18n";

// tiptap-markdown augments editor.storage at runtime but its type augmentation
// does not always resolve through the monorepo, so read it through a narrow cast.
const toMarkdown = (editor: Editor): string => (editor.storage as unknown as { markdown: { getMarkdown: () => string } }).markdown.getMarkdown();

// In-card block editor (DESIGN.md § Point: Heptabase/Notion-style document).
// Markdown is the canonical storage format — the editor parses it into blocks
// and serialises it back on save, so the Graph data model is never bound to the
// block structure. `nodrag`/`nowheel` keep typing and selection from being
// stolen by React Flow's pan/zoom/drag gestures.
export function NodeBlockEditor(props: { markdown: string; editable: boolean; placeholder: string; onSave?: (markdown: string) => void }) {
  const { markdown, editable, placeholder, onSave } = props;
  const { t } = useI18n();
  const slashItems = useMemo<SlashItem[]>(() => {
    type Chain = ReturnType<Editor["chain"]>;
    const apply = (run: (chain: Chain) => Chain) => (editor: Editor, range: Range) => run(editor.chain().focus().deleteRange(range)).run();
    return [
      { title: t("blockH1"), run: apply((chain) => chain.toggleHeading({ level: 1 })) },
      { title: t("blockH2"), run: apply((chain) => chain.toggleHeading({ level: 2 })) },
      { title: t("blockH3"), run: apply((chain) => chain.toggleHeading({ level: 3 })) },
      { title: t("blockBullet"), run: apply((chain) => chain.toggleBulletList()) },
      { title: t("blockOrdered"), run: apply((chain) => chain.toggleOrderedList()) },
      { title: t("blockQuote"), run: apply((chain) => chain.toggleBlockquote()) },
      { title: t("blockCode"), run: apply((chain) => chain.toggleCodeBlock()) },
      { title: t("blockDivider"), run: apply((chain) => chain.setHorizontalRule()) },
    ];
  }, [t]);

  const editor = useEditor({
    editable,
    extensions: [StarterKit, Markdown.configure({ html: false, transformPastedText: true, transformCopiedText: true }), Placeholder.configure({ placeholder }), createSlashCommand(slashItems)],
    content: markdown,
    editorProps: { attributes: { class: "node-doc-editor nodrag nowheel" } },
  });

  // Only re-seed content when the Markdown arrives from outside (lazy load or a
  // remote change), never on our own keystrokes — comparing against the last
  // applied value stops a reactive setContent from wiping what the user typed.
  const applied = useRef(markdown);
  useEffect(() => {
    if (!editor) return;
    if (markdown !== applied.current) { editor.commands.setContent(markdown); applied.current = markdown; }
  }, [markdown, editor]);

  useEffect(() => { editor?.setEditable(editable); }, [editable, editor]);

  useEffect(() => {
    if (!editor || !onSave) return;
    const handler = () => { const next = toMarkdown(editor); applied.current = next; onSave(next); };
    editor.on("blur", handler);
    return () => { editor.off("blur", handler); };
  }, [editor, onSave]);

  return <div className="node-doc-shell">
    {editable && editor ? <DragHandle editor={editor}><span className="node-drag-handle nodrag" aria-hidden><GripVertical size={13} /></span></DragHandle> : null}
    <EditorContent editor={editor} />
  </div>;
}
