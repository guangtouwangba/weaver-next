---
name: weaver-agent-loop
description: Drive the Weaver canvas as the bound agent from a terminal session (Codex or Claude Code) — read the live selection, develop or lay out nodes, and submit auditable ChangeSets that stream into the browser preview. Use after weaver-open-preview.
---

# Weaver Agent Loop (browser preview — Codex or Claude)

*You* are the agent. The browser preview window (opened by `weaver-open-preview`) holds the live canvas; its heartbeat keeps the canvas bound and online. You act by calling the `weaver_*` MCP tools — they resolve to a stable process-synthetic chat session key that both your stdio calls and the browser's loopback calls share, so writes you submit appear in the browser over SSE, and the selection the user makes in the browser is what you read. This works identically in Codex and Claude Code.

## Preconditions
- The preview browser is open and focused. If a canvas tool returns `BOUND_CANVAS_OFFLINE`, stop and ask the user to open or focus the preview window (its heartbeat must be live); do not sleep-and-retry.
- A project/view is bound. If `weaver_get_bound_canvas` returns `NO_CANVAS_BOUND_TO_CHAT`, run `weaver-open-preview` first. Never infer a project/view from recency.

## Develop or edit content
1. `weaver_get_bound_canvas` — confirm `online:true` and capture `projectId`, `viewId`, `canvasSessionId`, revisions. Stop on `NO_CANVAS_BOUND_TO_CHAT` / `BOUND_CANVAS_NOT_READY` / `BOUND_CANVAS_OFFLINE`.
2. `weaver_prepare_task_from_active_canvas` with the matching `actionKey` (`develop_selection`, `follow_up_ask`, `develop_then_layout`). This captures the exact live selection and **self-confirms the dispatch** — do not call `weaver_confirm_agent_dispatch` / `weaver_mark_task_dispatched`; those are legacy embedded-widget dispatch steps and are not needed on the browser-preview path (either host).
3. `weaver_start_agent_task` with the returned `taskId`; verify `status=running`, `activeStage=content`.
4. `weaver_get_project_manifest`, `weaver_get_canvas_context`, `weaver_resolve_context` — work only within the scene's permitted node/edge types and the bounded context. Read full node bodies with `weaver_get_node_content` only when needed.
5. Do the reasoning/research with your own permissions. Build GraphOperations from allowed semantic types only; reference only Weaver-returned asset IDs (never filesystem paths or invented IDs).
6. Immediately before writing, re-check `weaver_get_bound_canvas` and `weaver_get_agent_task`; stop without writing if the binding changed, went offline, or the task is not `running/content`. Then `weaver_submit_changeset`. The browser shows the ChangeSet preview over SSE.
7. The user applies or rejects from the browser (Apply/Reject), or you call `weaver_apply_changeset` / `weaver_reject_changeset` directly — both resolve to the same binding. For `develop_then_layout`, continue only when the task returns with `activeStage=layout`.

## Watch mode (canvas is the input)

When the user turns on "watch", they drive from the canvas composer instead of the terminal. Loop:
1. `weaver_await_canvas_prompt` (long-poll, ~25s). It returns `{ pending: true, task }` the instant the user submits a prompt on the canvas, or `{ pending: false }` on timeout.
2. On `pending: false`, immediately call `weaver_await_canvas_prompt` again (re-arm the poll).
3. On `pending: true`, the `task` already captured the exact selection + `userInstruction` and is `dispatched`. Run the develop flow from step 3 above: `weaver_start_agent_task` → `weaver_get_project_manifest` / `weaver_resolve_context` / `weaver_get_node_content` → do the work → `weaver_submit_changeset`. The ChangeSet streams to the canvas; the user applies it there (do not auto-apply unless they asked).
4. After the task reaches a terminal state, re-arm the poll (step 1).

Only one canvas task is active at a time (the composer disables while busy), so the loop is naturally serial. Stop the loop when the user interrupts (Esc) or says stop. If `await` reports the canvas went offline, tell the user to focus the preview window and keep re-arming.

## Layout-only requests
Use `weaver-layout-space` semantics: prepare with `layout_view`, generate candidates, and apply through `weaver_apply_layout` / validated layout operations. Layout, viewport, pin, and theme operations must never change `graphRevision`.

## Guardrails
- Never write `.weaver/weaver.sqlite` or `.weaver/preview.json` directly.
- Never bypass ChangeSet review, invent final coordinates, or expose local filesystem paths.
- A cancelled/terminal task must never produce a ChangeSet, even mid-conversation. On revision conflict, leave the task stale for regeneration rather than silently rebasing.
