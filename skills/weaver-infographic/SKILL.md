---
name: weaver-infographic
description: Generate a titled infographic (信息图) image from the current Weaver canvas selection or a described topic, and place it on the canvas as an image node for review. Use when the user asks to "make an infographic", "把这些节点做成一张信息图", visualize a 赛道/产业链/市场结构, or turn selected research nodes into one shareable visual.
---

# Weaver Infographic

Turn selected semantic nodes (or a described topic) into ONE information-dense infographic image and place it on the Weaver canvas through a reviewable ChangeSet. Text is baked into the image in the content's language. Read `references/base-prompt.md` (design principles) and `references/styles.md` (style gallery) before generating.

## Preconditions

The native Weaver widget is open for the active project. Weaver state is read and written through Weaver MCP tools. Never write `.weaver/*` directly, never invent coordinates or asset paths, never bypass ChangeSet review.

## Workflow

1. Confirm the bound canvas: `weaver_read_session(resource:"bound_canvas")`. If none, tell the user to open the space (or run the open skill).

2. Gather the source content.
   - Read the selection: `weaver_read_session(resource:"canvas_context")` and `weaver_read_session(resource:"resolved_context")`.
   - Pull full bodies only for the nodes you will visualize: `weaver_read_graph(resource:"node")`.
   - If the user described a topic instead of selecting nodes, use that text as the brief.

3. Plan the infographic (do not skip). Decide, and keep these:
   - `title`: <= 14 chars, the single takeaway.
   - `archetype`: one of `vertical-sections` (default), `comparison`, `timeline`, `hub-and-spoke`, `funnel`.
   - `style`: pick from `references/styles.md` by topic (default `data-report`).
   - `aspect`: `3:4` portrait (default, best for reading) or `16:9`.
   - `sections`: 3–6, each `{ heading, one-line insight, optional data callout }`. Keep every number sourced.

4. Choose the generation path.
   - **Host image model (Codex, default):** compose a single prompt that embeds ALL text verbatim (title, each section heading + insight + data), names the chosen style's palette + elements + the archetype + aspect ratio, and instructs: "editorial infographic, flat vector, crisp legible <language> text exactly as written, no lorem ipsum, generous whitespace, clear visual hierarchy." Generate with the host's built-in image generation.
   - **SVG path (Claude, or when text is dense/precise):** author a self-contained SVG (viewBox = the aspect at ~1080px long edge) laying out the sections per the archetype using the style palette; then call `weaver_import_asset(source:"svg")` with that SVG. Prefer this whenever numeric precision matters.

5. Resolve the actual bytes carefully.
   - Host path: use the exact file/base64 the current generation call produced. Do NOT pick the newest file in a stale `generated_images` dir; match it to THIS request (timestamp). Read the file and base64-encode it.
   - SVG path: `weaver_import_asset(source:"svg")` already returns the `assetId`; skip step 6.

6. Ingest: `weaver_import_asset` with `{ source:"bytes", projectId, mimeType, base64 }` → `assetId`.

7. Place via ChangeSet (reviewable). Within the active task, `weaver_submit_changeset` with:
   - one `add-node` op: `{ type:"add-node", node: { id:<uuid>, projectId, type:"entity", title:<title>, body:"", contentKind:"image", content:{ kind:"image", assetId, alt:<title>, caption:<source + asOf> }, properties:{}, archived:false, createdAt, updatedAt } }`
   - `rationale` naming the source node ids; `riskLevel:"low"`; `baseGraphRevision` = current graph revision.
   - Optionally add a `set-node-frame` layout op placing it in a clear area at the image aspect.

8. Confirm: report the new node id, the source nodes, aspect, and that it is pending review for the user to Apply on the canvas.

## Notes

- Bake text INTO the image; do not leave a text-free background. When Chinese/precise numeric text must be pixel-crisp, prefer the SVG path (`weaver_import_asset(source:"svg")`).
- Every figure must be traceable to a source node; put the source in the caption.
- Never overwrite an existing asset; ingestion is content-addressed and safe.
