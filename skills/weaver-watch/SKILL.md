---
name: weaver-watch
description: Drive Weaver entirely from the on-canvas composer (Codex or Claude Code) — open the browser board, then long-poll for prompts the user types on the canvas and handle each one as a reviewed ChangeSet. Use when the user wants to work from the canvas instead of the terminal.
---

# Weaver watch mode (canvas is the input)

The user types instructions in the **on-canvas composer** and you (the terminal agent) pick them up.
The canvas prompt only moves when this loop is running — without it, a submitted prompt sits at
"等待接单… / waiting for pickup" forever. This works the same in **both** hosts.

## 1. Open the board

Run the `weaver-open-preview` flow first (unless a canvas is already bound and online):
1. `workspaceDir` = git top-level of the current dir (fall back to cwd).
2. `weaver_list_projects` → pick the project (the named one; else the most recently updated, and say which).
3. `weaver_open_workspace_widget` with that `workspaceDir` + `projectId`. The MCP process opens the
   browser preview automatically and returns a tokenized `previewUrl`.
   - No `previewUrl` → the MCP isn't a preview host; tell the user to (re)connect it (Claude Code:
     `weaver-preview`; Codex: reinstall `weaver-local`).
4. Tell the user the board is live, to keep the window visible (its heartbeat keeps the canvas
   online), and that they can now **type in the on-canvas composer** — no need to return to the terminal.

## 2. Watch loop

Loop until the user interrupts (Esc) or says stop:

1. `weaver_await_canvas_prompt` (long-poll, ~25s). It returns `{ pending: true, task }` the instant
   the user submits a prompt on the canvas, or `{ pending: false }` on timeout.
2. On `pending: false` → immediately call `weaver_await_canvas_prompt` again (re-arm).
3. On `pending: true` → the `task` already captured the exact selection + `userInstruction` and is
   `dispatched`. Handle it with the develop flow:
   - `weaver_start_agent_task` (verify `status=running`, `activeStage=content`).
   - `weaver_read_graph(resource:"manifest")`, `weaver_read_session(resource:"canvas_context")`, `weaver_read_session(resource:"resolved_context")`; read full
     node bodies with `weaver_read_graph(resource:"node")` only when needed.
   - Do the requested reasoning/research, then `weaver_submit_changeset`. The ChangeSet streams to
     the canvas; the user Applies/Rejects it there. **Do not auto-apply** unless they asked.
   - For `develop_then_layout`, continue only when the task returns with `activeStage=layout`.
4. After the task reaches a terminal state, re-arm the poll (step 1).

Only one canvas task is active at a time (the composer disables while busy), so the loop is
serial. If `await`/a tool reports `BOUND_CANVAS_OFFLINE`, tell the user to focus the preview
window and keep re-arming — do not sleep-and-retry to mask it.

## Guardrails
- Never write `.weaver/weaver.sqlite` directly, invent coordinates, or bypass ChangeSet review.
- A cancelled/terminal task must never produce a ChangeSet.
- Pass the same `workspaceDir` (the user's repo git top-level) to every tool — never the plugin's
  install/cache directory — so the browser and your polling resolve to one canvas.
- To stop watching, the user presses Esc or says "stop"; end the loop cleanly.
