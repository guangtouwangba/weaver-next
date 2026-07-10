---
name: weaver-develop-space
description: Expand, research, connect, edit, or enrich selected Weaver nodes through scene-aware MCP context and auditable ChangeSets. Use when a Weaver canvas task asks the coding agent to develop content or relationships rather than only rearrange layout.
---

# Develop Weaver Space

1. Call `weaver_get_bound_canvas` for the current Codex chat. Stop on `NO_CANVAS_BOUND_TO_CHAT`, `BOUND_CANVAS_NOT_READY`, or `BOUND_CANVAS_OFFLINE`; never infer a Project, View, or Canvas from focus or recency. A forked chat must explicitly open or create its own Canvas binding.
2. Extract `Task ID` from the request when present. If ordinary Codex chat has no Task ID, call `weaver_prepare_task_from_active_canvas`; despite the compatibility name, this tool now uses only the exact current Chat binding and accepts no Project or Canvas override.
3. Call `weaver_get_agent_task`. Continue only when `status=dispatched` and `activeStage=content`; otherwise stop. Then call `weaver_start_agent_task` and verify it returns `status=running`. Respect `intent` and the captured revisions.
4. Call `weaver_get_project_manifest`; treat its scene node types, edge types, and protected fields as binding.
5. Call `weaver_get_canvas_context` and `weaver_resolve_context`. Do not read the whole project unless the scene policy and user task require it.
6. Treat graph results as summaries. Call `weaver_get_node_content` only for nodes whose complete Markdown or media references are necessary, and use `weaver_get_asset_metadata` before requesting original image resources.
7. Perform the requested reasoning or external work using the host's own permissions.
8. Build GraphOperations only from semantic types and content kinds permitted by the pinned scene pack. Use `set-node-content`, `attach-asset`, `detach-asset`, and `set-node-cover` for content edits.
9. Reference only asset IDs returned by Weaver. Never submit filesystem paths, base64 binaries, or invented asset IDs in a ChangeSet.
10. Immediately before submitting, call `weaver_get_bound_canvas` and `weaver_get_agent_task` again. Stop without writing if the binding changed, went offline, or the task is `cancelled`, `failed`, `stale`, or any state other than `running/content`. Then call `weaver_submit_changeset`. This places the task in `pending_review` and lets SSE notify the canvas. Never write `.weaver` files or SQLite directly.
11. For `develop_then_layout`, stop after submitting content. Continue only when the same task returns with `activeStage=layout` after review.
12. Leave review/apply decisions to Weaver. On revision conflict, do not silently rebase; leave the task stale for regeneration.

The visible Codex message is a dispatch hint, not proof that the task is still valid. A cancelled or terminal task must never produce a ChangeSet, even if the conversation is still running.

Keep content operations separate from LayoutOperations. For layout-only requests, use `weaver-layout-space`.
