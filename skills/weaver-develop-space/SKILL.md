---
name: weaver-develop-space
description: Expand, research, connect, edit, or enrich selected Weaver nodes through scene-aware MCP context and auditable ChangeSets. Use when a Weaver canvas task asks the coding agent to develop content or relationships rather than only rearrange layout.
---

# Develop Weaver Space

1. Extract `Task ID`, workspace, project, and revision from the widget follow-up message. If ordinary Codex chat has no Task ID, call `weaver_prepare_task_from_active_canvas`; do not guess between ambiguous canvases.
2. Call `weaver_get_agent_task`, then `weaver_start_agent_task`. Respect `intent`, `activeStage`, and the captured revisions.
3. Call `weaver_get_project_manifest`; treat its scene node types, edge types, and protected fields as binding.
4. Call `weaver_get_canvas_context` and `weaver_resolve_context`. Do not read the whole project unless the scene policy and user task require it.
5. Treat graph results as summaries. Call `weaver_get_node_content` only for nodes whose complete Markdown or media references are necessary, and use `weaver_get_asset_metadata` before requesting original image resources.
6. Perform the requested reasoning or external work using the host's own permissions.
7. Build GraphOperations only from semantic types and content kinds permitted by the pinned scene pack. Use `set-node-content`, `attach-asset`, `detach-asset`, and `set-node-cover` for content edits.
8. Reference only asset IDs returned by Weaver. Never submit filesystem paths, base64 binaries, or invented asset IDs in a ChangeSet.
9. Call `weaver_submit_changeset`. This places the task in `pending_review` and lets SSE notify the canvas. Never write `.weaver` files or SQLite directly.
10. For `develop_then_layout`, stop after submitting content. Continue only when the same task returns with `activeStage=layout` after review.
11. Leave review/apply decisions to Weaver. On revision conflict, do not silently rebase; leave the task stale for regeneration.

Keep content operations separate from LayoutOperations. For layout-only requests, use `weaver-layout-space`.
