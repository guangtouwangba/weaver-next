# Using Weaver — Codex and Claude Code

Weaver is one project with **two front-end hosts**. Both drive the same semantic graph, the
same local SQLite (`<workspace>/.weaver/`), the same audited ChangeSet + deterministic layout
pipeline, and the same MCP tools. They differ only in *where the canvas renders* and *where you
type natural language*.

| | **Codex** | **Claude Code** |
|---|---|---|
| Canvas surface | Embedded widget in Codex's right panel (Apps-SDK iframe) | A real browser window beside the terminal (loopback `/preview`) |
| Natural language | Codex chat | Terminal **or** the on-canvas composer (Claude-host only) |
| MCP server | `weaver_mcp` (`scripts/start-mcp.mjs`) | `weaver-preview` (`scripts/start-mcp-claude.mjs`, `WEAVER_HOST_KIND=claude`) |
| Agent | Codex's model | Your Claude Code terminal session |
| Launch | Open widget tool / a Weaver skill | `/weaver-open` (open) · `/weaver-watch` (open + watch) |
| Live update after a widget rebuild | Refresh the plugin cache / new chat | **Auto-reloads** the browser (dev) |

Everything else — graph vs layout revisions, the online-heartbeat requirement for agent writes,
path-confined loopback with tokens, `graphRevision` never changing on layout — is identical.

---

## Prerequisites (shared)

```bash
npm install
npm run build:plugin      # builds packages + the widget bundle
npm run test              # optional: full TS + Python suite
```

Project data lives under `<workspace>/.weaver/` (SQLite is authoritative). Never edit it by hand.

---

## Using with Codex

Weaver is a native Codex plugin. The manifest `/.codex-plugin/plugin.json` wires two things:
the agent skills under `skills/` and the MCP server declared in `/.mcp.json`
(`weaver_mcp` → `node ./scripts/start-mcp.mjs`).

1. **Build** the plugin: `npm run build:plugin`.
2. **Register/enable** the Weaver plugin in Codex so it loads `.codex-plugin/plugin.json`
   (point Codex at this repo per your Codex plugin setup). Codex then has the `weaver_*`
   tools and the Weaver skills.
3. **Open the space** — in a Codex chat, run one of the default prompts:
   - *"Open the Weaver space for this project."*
   - *"Create a mind-map space from a visual template."*
   The canvas renders **embedded in Codex's right panel**.
4. **Work the canvas** in the widget: add/select/connect/pin nodes, edit documents in the side
   editor, switch views. Your selection, viewport, and pinned nodes sync to the agent.
5. **Ask in the Codex chat** ("develop the selected node", "lay this out as a timeline"). The
   agent submits a **ChangeSet**; the widget shows a preview you **Apply / Reject / Undo**.

Codex keeps all natural language in the chat by design — there is no on-canvas text input.

**After a rebuild:** the running plugin caches the widget bundle. If you rebuild
(`npm run build:plugin`), refresh the local plugin cache and start a new Codex chat so the new
build and any MCP/schema changes are loaded (see [AGENTS.md](../AGENTS.md) §5).

Dev shortcut: `npm run dev:codex-plugin` builds the plugin and starts the MCP dev process.

---

## Using with Claude Code

Claude Code has no embedded panel, so the canvas opens in a **browser window beside your
terminal**, and *you* are the agent. One-time setup:

```bash
npm run build:plugin
# Register the Weaver MCP as the Claude preview host:
claude mcp add weaver-preview -- node ./scripts/start-mcp-claude.mjs
# Install the Claude Code skills into .claude/skills (add --global for all projects):
npm run install:claude-skills
```

Then in Claude Code run `/reload-skills` (or restart it).

> Do **not** approve the project's `weaver_mcp` server (that one is Codex's). Use
> `weaver-preview`. If both run, they expose duplicate tool names.

### Open the board

Run **`/weaver-open`**. It resolves the project, opens its canvas via
`weaver_open_workspace_widget`, and runs `open <previewUrl>` to pop the browser window. The
status pill reads **"Bound to this Claude session"**. Keep the window visible — its heartbeat
keeps the canvas online (the agent can only write while it is online).

### Two ways to drive it

1. **From the terminal.** Select node(s) in the browser; ask Claude in the terminal
   ("develop 全球代表生态", "lay this out"). Claude reads the exact bound selection, submits a
   ChangeSet, and it streams into the browser for you to **Apply**.
2. **From the canvas (watch mode).** Run **`/weaver-watch`** — it opens the board (if needed) and
   puts Claude in a long-poll loop on `weaver_await_canvas_prompt`. Now type an instruction
   **directly in the on-canvas composer** and hit Enter — Claude picks it up in seconds, does the
   work, and the ChangeSet returns to the canvas for you to Apply. One prompt at a time (the
   composer disables while busy). Press Esc or say "stop" to leave watch mode.

### Live iteration

The Claude-host MCP re-reads the widget bundle on change and pushes a reload over SSE, so
**editing widget code → `npm run build:widget` → the browser auto-refreshes** — no MCP restart.
Only **server-side** changes (MCP / contracts / scene-packs) require reconnecting `weaver-preview`
(`/mcp` → weaver-preview → Reconnect).

### Sharing the skills

The Claude Code skills are version-controlled under `tools/claude-skills/` so teammates can
install them with `npm run install:claude-skills`. See
[tools/claude-skills/README.md](../tools/claude-skills/README.md).

---

## Shared concepts

- **Graph vs layout.** Content changes bump `graphRevision`; moving/pinning/theming/viewport
  changes bump only that view's `layoutRevision`. The two are versioned independently.
- **Audited writes.** The agent never writes SQLite directly or invents coordinates. It submits
  `GraphOperation` / `ChangeSet` / `LayoutPlan`; you preview, apply, reject, or undo.
- **Online to write.** Agent tasks require the canvas to be **online** (heartbeating). If a tool
  returns `BOUND_CANVAS_OFFLINE`, focus/reopen the canvas.
- **One writable canvas per session.** A Codex chat or a Claude session binds to exactly one
  canvas; duplicate/stale/offline sessions fail closed.
- **Local-first + recoverable.** Loopback endpoints are `127.0.0.1`-only, tokenized, read-only for
  assets/SSE; dropped SSE recovers via `Last-Event-ID` and revision checks.

## Troubleshooting

- **Blank "资源加载失败" / assets 404 after a rebuild (Claude Code):** the MCP process is stale —
  reconnect `weaver-preview` (`/mcp` → Reconnect). Fresh processes never hit this.
- **`buildMismatch: true` in development:** run `npm run build:plugin`. Installed Codex plugins
  only require the embedded Widget and MCP server builds to match; a newer workspace build is
  informational and must not block the canvas.
- **`/weaver-open` returns no `previewUrl`:** the server isn't the Claude host — (re)register/connect
  `weaver-preview` (`scripts/start-mcp-claude.mjs`).
- **`BOUND_CANVAS_OFFLINE`:** open/focus the preview window so its heartbeat resumes.

See also: [product.md](../product.md) (vision), [AGENTS.md](../AGENTS.md) (engineering rules),
[WORKFLOW.md](../WORKFLOW.md) (dev/acceptance).
