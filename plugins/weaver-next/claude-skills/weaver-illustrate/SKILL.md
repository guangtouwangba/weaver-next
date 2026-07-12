---
name: weaver-illustrate
description: Generate an artistic/illustrative image for a selected Weaver node or a described subject and place it beside the node (or attach it as the node's cover). Use when the user asks to "配一张插画", "生成一张示意图/概念图", or illustrate a concept visually rather than with data.
---

# Weaver Illustrate

Generate ONE artistic illustration (no baked-in body text by default) for a node or topic and place it on the canvas through a reviewable ChangeSet.

## Preconditions

Native Weaver widget open. Weaver MCP tools only. Requires a host image model. Codex has a built-in one; on a host without image generation, tell the user this mode needs Codex or a configured image API, and offer weaver-infographic/weaver-cover-image (which have an SVG path) instead.

## Workflow

1. `weaver_get_bound_canvas`; read the target node (`weaver_get_node_content`) or take the described subject.
2. Compose a concise art-direction prompt (subject, mood, medium/style, palette, aspect). No embedded paragraphs of text unless the user asks.
3. Generate with the host image model. Resolve the exact bytes for THIS request (never a stale file); base64-encode.
4. `weaver_ingest_image` → `assetId`.
5. Place via ChangeSet: `add-node` image placed BESIDE the source node (a clear nearby area) — or, if the user wants it as the node's picture, `weaver_attach_asset` with `role:"cover"`.
6. Confirm node id / attachment and pending-review state.

## Notes
- Default to a text-free illustration; only bake text in if explicitly requested.
- Never move, hide, or overwrite the source node.
