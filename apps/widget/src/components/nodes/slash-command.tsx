import { Extension, type Editor, type Range } from "@tiptap/core";
import Suggestion, { type SuggestionProps } from "@tiptap/suggestion";
import { ReactRenderer } from "@tiptap/react";
import { forwardRef, useEffect, useImperativeHandle, useState } from "react";

// A Notion-style `/` command menu built on TipTap's Suggestion utility. Items and
// their labels are supplied by the caller (so they stay localised), each item
// deletes the typed `/query` range and applies its block transform.
export type SlashItem = { title: string; hint?: string; run: (editor: Editor, range: Range) => void };

type MenuHandle = { onKeyDown: (props: { event: KeyboardEvent }) => boolean };

const SlashMenu = forwardRef<MenuHandle, { items: SlashItem[]; command: (item: SlashItem) => void }>((props, ref) => {
  const [index, setIndex] = useState(0);
  useEffect(() => setIndex(0), [props.items]);
  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }) => {
      if (!props.items.length) return false;
      if (event.key === "ArrowUp") { setIndex((i) => (i + props.items.length - 1) % props.items.length); return true; }
      if (event.key === "ArrowDown") { setIndex((i) => (i + 1) % props.items.length); return true; }
      if (event.key === "Enter") { const item = props.items[index]; if (item) props.command(item); return true; }
      return false;
    },
  }));
  if (!props.items.length) return null;
  return <div className="slash-menu floating-panel">
    {props.items.map((item, i) => (
      <button key={item.title} type="button" data-active={i === index || undefined} onMouseDown={(event) => { event.preventDefault(); props.command(item); }} onMouseEnter={() => setIndex(i)}>
        <span>{item.title}</span>{item.hint ? <small>{item.hint}</small> : null}
      </button>
    ))}
  </div>;
});
SlashMenu.displayName = "SlashMenu";

export function createSlashCommand(items: SlashItem[]) {
  return Extension.create({
    name: "slashCommand",
    addProseMirrorPlugins() {
      return [
        Suggestion<SlashItem>({
          editor: this.editor,
          char: "/",
          startOfLine: false,
          items: ({ query }) => items.filter((item) => item.title.toLowerCase().includes(query.toLowerCase())).slice(0, 10),
          command: ({ editor, range, props }) => props.run(editor, range),
          render: () => {
            let renderer: ReactRenderer<MenuHandle> | null = null;
            let anchor: HTMLDivElement | null = null;
            const place = (rect?: (() => DOMRect | null) | null) => {
              if (!anchor || !rect) return;
              const box = rect(); if (!box) return;
              anchor.style.left = `${box.left}px`;
              anchor.style.top = `${box.bottom + 6}px`;
            };
            const mount = (props: SuggestionProps<SlashItem>) => ({ items: props.items, command: (item: SlashItem) => props.command(item) });
            return {
              onStart: (props) => {
                renderer = new ReactRenderer(SlashMenu, { props: mount(props), editor: props.editor });
                anchor = document.createElement("div");
                anchor.className = "slash-menu-anchor";
                anchor.appendChild(renderer.element as HTMLElement);
                document.body.appendChild(anchor);
                place(props.clientRect ?? undefined);
              },
              onUpdate: (props) => { renderer?.updateProps(mount(props)); place(props.clientRect ?? undefined); },
              onKeyDown: (props) => { if (props.event.key === "Escape") return true; return renderer?.ref?.onKeyDown(props) ?? false; },
              onExit: () => { anchor?.remove(); renderer?.destroy(); renderer = null; anchor = null; },
            };
          },
        }),
      ];
    },
  });
}
