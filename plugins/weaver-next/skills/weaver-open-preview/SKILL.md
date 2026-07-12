---
name: weaver-open-preview
description: Open the Weaver semantic canvas as a live browser preview window beside the terminal. Use under either host (Codex or Claude Code) when the user asks to open, show, or view the canvas / space. The browser updates in real time as the agent edits the graph.
---

# Open Weaver Preview (browser — Codex or Claude)

Weaver's canvas opens in a real browser window next to the terminal — the same way in **both** hosts (there is no embedded widget panel). The MCP process serves the widget over a tokenized loopback URL, streams live updates via SSE, and binds the browser and the agent to one canvas via a process-synthetic key.

## Prerequisites
- The Weaver MCP is registered as a browser-preview host (it sets `WEAVER_HOST_KIND`, so `weaver_open_workspace_widget` returns a `previewUrl`):
  - **Claude Code:** `claude mcp add weaver-preview -- node ./scripts/start-mcp-claude.mjs`
  - **Codex:** install the `weaver-local` plugin (its launcher `scripts/start-mcp.mjs` defaults to preview mode).
- The widget bundle is built and matches the server: run `npm run build:plugin` if `buildMismatch` is ever reported.

## Steps
1. Resolve the user's active workspace directory (the repo root the MCP was launched in).
2. Call `weaver_read_catalog(resource:"project.list")`. Pick the matching project; if none exists use `weaver-create-space`; if ambiguous, ask the user.
3. Call `weaver_open_workspace_widget` with the explicit `workspaceDir` and `projectId`. The MCP process **opens the tokenized `previewUrl` (loopback) in the default browser automatically** and returns it plus the `chatBinding`. There is no embedded widget panel in either host.
4. Only if the browser window did not appear, open it yourself via the OS opener (`open "<previewUrl>"` on macOS, `xdg-open "<previewUrl>"` on Linux). Do not print the token in long-lived logs.
5. Tell the user the canvas is live and to keep the window visible (its heartbeat keeps the canvas bound and online for agent tasks). If they closed it, `<workspace>/.weaver/preview.json` holds the same URL to reopen.
6. **Immediately enter watch mode by default** (don't ask first): the canvas is now the input. Tell the user "I'm watching the canvas — type in the composer and I'll pick it up; press Esc to stop," then start the `weaver-watch` loop (long-poll `weaver_await_canvas_prompt`, handle each prompt as a reviewed ChangeSet). Only skip this if the user said they just want to look. To act on a specific selection from the terminal instead, follow `weaver-agent-loop`.

## Guardrails
- Never start a separate localhost dev server; the MCP process already serves `/preview`, `/mcp-rpc`, and SSE.
- Never read or edit `.weaver/weaver.sqlite` directly.
- If `weaver_open_workspace_widget` returns no `previewUrl`, the MCP isn't running as a preview host — reconnect it (Claude Code: `weaver-preview`; Codex: reinstall `weaver-local`).
