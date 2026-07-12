---
name: weaver-open
description: Open the Weaver semantic canvas (whiteboard) for this project in a browser window beside the terminal, bound to this Claude Code session. Use when the user runs /weaver-open or asks to open / show / bring up the Weaver board, canvas, or whiteboard.
---

# Open Weaver board (Claude Code)

A one-shot launcher: resolve the project, open its canvas in a real browser window, and bind it to this Claude session. The board updates live as you edit the graph, and you can type instructions directly in the canvas composer (see watch mode).

## Steps

1. **Resolve the workspace.** The `weaver-preview` MCP server is launched with the repo root as its Weaver workspace. Use the git top-level of the current directory as `workspaceDir` (`git rev-parse --show-toplevel`; fall back to cwd).

2. **Pick the board.** Call `weaver_read_catalog(resource:"project.list")` with that `workspaceDir`.
   - If the user named a project, use it.
   - No projects → offer to create one (`weaver-create-space`) and stop.
   - One project → use it.
   - Several → open the **most recently updated** one by default and tell the user which, offering to switch (don't block with a question unless they ask).

3. **Open the canvas.** Call `weaver_open_workspace_widget` with `workspaceDir` + the chosen `projectId`. The MCP process **opens the tokenized `previewUrl` in the browser automatically** and returns it plus `buildMismatch`.
   - If it returns **no** `previewUrl`, the MCP isn't running as the Claude host — tell the user to (re)connect `weaver-preview` (`/mcp` → weaver-preview → Reconnect; launcher `scripts/start-mcp-claude.mjs`).
   - If `buildMismatch` is true, tell them to run `npm run build:plugin`.

4. **Only if no window appeared,** launch it yourself with the OS opener (`open "<previewUrl>"` on macOS, `xdg-open "<previewUrl>"` on Linux). Do not print the token into long-lived logs.

5. **Confirm.** Tell the user the board is live beside the terminal, the status pill reads "Bound to this Claude session", and to keep the window visible — its heartbeat keeps the canvas online (needed for the agent to write). If it was closed, `<workspace>/.weaver/preview.json` holds the same URL.

6. **Enter watch mode by default** (don't ask first). Tell the user "I'm watching the canvas — type in the composer and I'll pick it up; press Esc to stop," then enter the watch loop (`weaver-watch`): repeatedly call `weaver_await_canvas_prompt`, and on pickup run the develop flow (`weaver_start_agent_task` → resolve context → `weaver_submit_changeset`) so what they type in the canvas composer becomes a reviewed ChangeSet. Only skip if the user said they just want to look at the board.

## Guardrails
- Never start a separate localhost server; the MCP already serves `/preview`, `/mcp-rpc`, and SSE.
- Never read or edit `.weaver/weaver.sqlite` directly.
- Use the `mcp__weaver-preview__weaver_*` tools (this session's Claude host), not the Codex `weaver_mcp` server.
