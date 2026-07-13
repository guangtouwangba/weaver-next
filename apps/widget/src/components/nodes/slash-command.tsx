import { Extension, type Editor, type Range } from "@tiptap/core";
import Suggestion, { type SuggestionProps } from "@tiptap/suggestion";
import { ReactRenderer } from "@tiptap/react";
import { PluginKey } from "@tiptap/pm/state";
import { forwardRef, useEffect, useImperativeHandle, useState } from "react";

// Shared machinery for the editor's `/` command menu and `@` reference menu.
// Both are TipTap Suggestion popups: an item lists a title, and running it
// deletes the typed `char + query` range and applies its effect.
export type SuggestionItem = { title: string; hint?: string; run: (editor: Editor, range: Range) => void };

type MenuHandle = { onKeyDown: (props: { event: KeyboardEvent }) => boolean };

const SuggestionMenu = forwardRef<MenuHandle, { items: SuggestionItem[]; command: (item: SuggestionItem) => void }>((props, ref) => {
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
      <button key={`${item.title}-${i}`} type="button" data-active={i === index || undefined} onMouseDown={(event) => { event.preventDefault(); props.command(item); }} onMouseEnter={() => setIndex(i)}>
        <span>{item.title}</span>{item.hint ? <small>{item.hint}</small> : null}
      </button>
    ))}
  </div>;
});
SuggestionMenu.displayName = "SuggestionMenu";

export const suggestionPluginKey = (name: string) => new PluginKey(`suggestion:${name}`);

export function createSuggestionExtension(config: { name: string; char: string; items: (query: string) => SuggestionItem[] }) {
  return Extension.create({
    name: config.name,
    addProseMirrorPlugins() {
      return [
        Suggestion<SuggestionItem>({
          editor: this.editor,
          pluginKey: suggestionPluginKey(config.name),
          char: config.char,
          startOfLine: false,
          items: ({ query }) => config.items(query).slice(0, 10),
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
            const mount = (props: SuggestionProps<SuggestionItem>) => ({ items: props.items, command: (item: SuggestionItem) => props.command(item) });
            return {
              onStart: (props) => {
                renderer = new ReactRenderer(SuggestionMenu, { props: mount(props), editor: props.editor });
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
