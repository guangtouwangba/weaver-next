---
name: weaver-watch
description: Open the Weaver canvas and enter watch mode so you drive it from the on-canvas composer — type instructions on the whiteboard and this Claude session picks them up automatically and turns them into reviewed ChangeSets. Use when the user runs /weaver-watch or asks to watch / start watching / drive Weaver from the canvas.
---

# Weaver watch mode (canvas is the input)

One command: open the board, then long-poll for prompts typed in the on-canvas composer and
handle each one. The user drives entirely from the canvas; the terminal is dedicated to watching.

## 1. Open the board

Run the `weaver-open` flow first (unless a canvas is already bound and online):
1. `workspaceDir` = git top-level of the current dir (fall back to cwd).
2. `weaver_list_projects` → pick the project (named one; else the most recently updated, and say which).
3. `weaver_open_workspace_widget` — the MCP process pops the browser window automatically (tokenized `previewUrl`). Only if none appears, run `open "<previewUrl>"` yourself.
   - No `previewUrl` → the MCP isn't the Claude host; tell the user to (re)connect `weaver-preview`.
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
   - `weaver_get_project_manifest`, `weaver_get_canvas_context`, `weaver_resolve_context`; read full
     node bodies with `weaver_get_node_content` only when needed.
   - Do the requested reasoning/research, then `weaver_submit_changeset`. The ChangeSet streams to
     the canvas; the user Applies/Rejects it there. **Do not auto-apply** unless they asked.
   - For `develop_then_layout`, continue only when the task returns with `activeStage=layout`.
4. After the task reaches a terminal state, re-arm the poll (step 1).

Only one canvas task is active at a time (the composer disables while busy), so the loop is
serial. If `await`/a tool reports `BOUND_CANVAS_OFFLINE`, tell the user to focus the preview
window and keep re-arming.

## Guardrails
- Never write `.weaver/weaver.sqlite` directly, invent coordinates, or bypass ChangeSet review.
- A cancelled/terminal task must never produce a ChangeSet.
- Use the `mcp__weaver-preview__weaver_*` tools (Claude host), not the Codex `weaver_mcp` server.
- To stop watching, the user presses Esc or says "stop"; end the loop cleanly.
