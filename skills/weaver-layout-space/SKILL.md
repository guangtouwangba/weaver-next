---
name: weaver-layout-space
description: Translate natural-language Weaver layout and structured-visual requests into VisualTemplate projections or deterministic LayoutPlan candidates. Use for mind maps, flows, timelines, boards, matrices, tables, arranging, grouping, reducing crossings, or re-laying out a Weaver view.
---

# Layout Weaver Space

1. Call `weaver_read_session(resource:"bound_canvas")`. Stop if this Chat has no exact, online Canvas binding; do not guess from Project, focus, or recency. A forked Chat starts unbound.
2. Read `Task ID` when present and call `weaver_read_session(resource:"task", taskId)`. If ordinary Codex chat has no Task ID, call `weaver_prepare_task_from_active_canvas` with `actionKey=layout_view`; the tool resolves only the exact Chat binding. Continue only when `status=dispatched` and `activeStage=layout`, then call `weaver_start_agent_task` and verify it returns `status=running`.
3. Read `weaver_read_graph(resource:"manifest")`, `weaver_read_session(resource:"canvas_context")`, and `weaver_read_graph(resource:"full")` for the task's view.
4. If the user requests a visual form such as a timeline, board, matrix, table, flow, tree, or relationship network, call `weaver_read_catalog(resource:"view.list")` and `weaver_recommend_visual_templates`, then `weaver_validate_visual_template`.
5. Before creating a template View, disclose matching existing instances and offer to open one. Duplicate templates are allowed, but creation must be an explicit “create another View” choice and should use a user-readable View name.
6. When the template is compatible and ready, call `weaver_preview_visual_template`; report that applying it creates a new independent View. Use `weaver_manage_view(action:"create_from_template")` only after confirmation or under automatic project permission.
7. If required fields are missing, propose a separate content ChangeSet and revalidate after it is applied. Never add fields silently while applying a template.
8. For ordinary spatial cleanup, translate the user's language into a LayoutPlan. Read [layout-plan.md](references/layout-plan.md) for the contract and mapping examples.
9. Preserve pinned nodes, manual groups, and relative order unless the user explicitly says otherwise.
10. Use selection scope for local requests and whole-view scope only for explicit whole-canvas requests.
11. Immediately before generation, call `weaver_read_session(resource:"guard", taskId)` again — it returns the bound canvas and the task in one call. Stop without writing if the binding changed, went offline, or the task is `cancelled`, `failed`, `stale`, or any state other than `running/layout`. Then call `weaver_generate_layout_candidates` with the semantic plan.
12. Report the best candidate's score, crossings, overlap count, and any hard violations. SSE delivers the preview to the widget; do not ask it to poll.
13. If the task is stale, stop and require regeneration from current revisions.

Never invent or submit final `x`/`y` coordinates. Never mutate graph content for a layout request. If every candidate has hard violations, explain the violated constraints and leave the current layout unchanged.
The visible Codex message is a dispatch hint, not proof that the persisted task remains valid.
Renaming, pinning, reordering, default selection, trash, restore, and permanent deletion are direct user View Library actions, not layout-agent operations.
