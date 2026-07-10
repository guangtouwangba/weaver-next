---
name: weaver-layout-space
description: Translate natural-language Weaver layout requests into semantic LayoutPlan constraints and deterministic engine-generated candidates. Use for arranging, tidying, grouping, aligning, ranking, spacing, reducing crossings, preserving pinned nodes, or re-laying out a Weaver canvas.
---

# Layout Weaver Space

1. Read `Task ID` from the widget message and call `weaver_get_agent_task`, then `weaver_start_agent_task`. If ordinary Codex chat has no Task ID, call `weaver_prepare_task_from_active_canvas` with `actionKey=layout_view`.
2. Read `weaver_get_project_manifest`, `weaver_get_canvas_context`, and `weaver_get_project_graph` for the task's view.
3. Translate the user's language into a LayoutPlan. Read [layout-plan.md](references/layout-plan.md) for the contract and mapping examples.
4. Preserve pinned nodes, manual groups, and relative order unless the user explicitly says otherwise.
5. Use selection scope for local requests and whole-view scope only for explicit whole-canvas requests.
6. Call `weaver_generate_layout_candidates` with the semantic plan.
7. Report the best candidate's score, crossings, overlap count, and any hard violations. SSE delivers the preview to the widget; do not ask it to poll.
8. If the task is stale, stop and require regeneration from current revisions.

Never invent or submit final `x`/`y` coordinates. Never mutate graph content for a layout request. If every candidate has hard violations, explain the violated constraints and leave the current layout unchanged.
