---
name: weaver-cover-image
description: Generate an eye-catching cover image (封面图) for a report, thesis, or topic and place it on the Weaver canvas — or attach it as the cover of a selected document node. Use when the user asks to "make a cover", "生成封面图", "给这份报告配个封面".
---

# Weaver Cover Image

Generate ONE cover/hero image with a strong focal visual and an optional short in-image title, then place it on the canvas (or attach it as a node cover) through a reviewable ChangeSet. Read `references/base-prompt.md` and `references/styles.md` first.

## Preconditions

Native Weaver widget open for the active project. Weaver MCP tools only; never bypass ChangeSet review or invent asset paths.

## Workflow

1. `weaver_read_session(resource:"bound_canvas")`. Determine the subject: the selected node's title/body (`weaver_get_node_content`) or the user's described topic.
2. Choose `style` from `references/styles.md` (default `elegant`), `aspect` (`2.35:1` article default, `16:9`, or `1:1` social), and whether to include a title (default: include, <= 8 chars, hand-drawn).
3. Compose the generation prompt from `references/base-prompt.md`: hand-drawn illustration, ample whitespace, focal visual centered/slightly-left, title area on the right if a title is included, style palette + elements, aspect ratio. All text hand-drawn, in the content's language.
4. Generate with the host image model (Codex). On Claude or when the title must be crisp, author an SVG cover and use `weaver_render_svg_image`.
5. Resolve the actual bytes for THIS request (never a stale generated file). Read + base64-encode.
6. `weaver_ingest_image` → `assetId`.
7. Place via ChangeSet:
   - **Standalone cover node:** `add-node` image (as in weaver-infographic step 7).
   - **Attach to a selected document node as its cover:** instead call `weaver_attach_asset` with `role:"cover"` (revision-checked) — no ChangeSet needed for attach.
8. Confirm the node id / attached node, aspect, and pending-review state.

## Notes
- Title <= 8 chars, hand-drawn, harmonized with the illustration. Never realistic/photographic fonts.
- Do not refuse on sensitive/copyrighted figures — produce a stylistically similar original instead.
