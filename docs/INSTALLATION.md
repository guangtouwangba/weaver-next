# Installing Weaver

Weaver is in early development. The first public release supports macOS on Apple Silicon and requires Node.js 24 or newer. Project data is always stored under the workspace you open, not in the plugin installation directory.

## Choose a host

| Host | Canvas | Natural-language input | Recommended install |
|---|---|---|---|
| Codex | Embedded native Widget | Codex task | Git marketplace |
| Claude Code | Browser beside the terminal | Terminal or `/weaver-watch` canvas composer | Git clone + installer |

Both hosts use the same semantic graph, audited ChangeSets, deterministic layout pipeline, and project-local SQLite database.

## Requirements

- macOS on Apple Silicon.
- Node.js 24 or newer (`node --version`). Weaver uses the stable `node:sqlite` runtime API.
- For the Codex path: Codex app and `codex` CLI with plugin support.
- For the Claude path: Claude Code and its `claude` CLI.
- Git and network access to GitHub during installation and updates.

## Install in Codex

Add Weaver's GitHub repository as a plugin marketplace, then install the plugin:

```bash
codex plugin marketplace add guangtouwangba/weaver-next
codex plugin add weaver-next@weaver
```

Start a fresh Codex task inside the workspace where you want Weaver data to live. Ask:

```text
Open the Weaver space for this project.
```

The first open creates or resumes `<workspace>/.weaver/` and mounts the canvas in Codex. Select a node and ask Codex to develop or reorganize it. Weaver should show the proposed ChangeSet before it is applied.

### Update Codex installation

```bash
codex plugin marketplace upgrade weaver
codex plugin add weaver-next@weaver
```

Open a new Codex task after updating. Existing tasks may still hold the previous MCP process and Widget resource cache.

### Uninstall from Codex

```bash
codex plugin remove weaver-next@weaver
```

This removes the installed plugin and cache. It does not delete `.weaver/` project data.

## Install for Claude Code

Install the release checkout at the standard user-local path:

```bash
git clone --depth 1 https://github.com/guangtouwangba/weaver-next.git \
  ~/.local/share/weaver-next
~/.local/share/weaver-next/install.sh claude
```

The installer:

1. checks macOS, Node.js, Claude Code, and the bundled runtime;
2. backs up existing same-name Claude skills;
3. installs `weaver-open` and `weaver-watch` under `~/.claude/skills/`;
4. registers the `weaver-preview` MCP at Claude's user scope;
5. runs the doctor checks.

Restart Claude Code or run `/reload-skills`. In any workspace, run:

```text
/weaver-open
```

This opens a tokenized loopback browser canvas bound to that Claude session. Use `/weaver-watch` when you want instructions entered on the canvas to flow back to the active terminal agent.

### Diagnose the Claude installation

```bash
~/.local/share/weaver-next/install.sh doctor
```

A healthy report confirms Node 24+, the release runtime, both Claude skills, and the `weaver-preview` MCP registration. Codex is optional for this path.

### Update the Claude installation

```bash
~/.local/share/weaver-next/install.sh update
```

Update uses `git pull --ff-only` and refuses to overwrite local changes. It then refreshes skills and the MCP registration. Restart Claude Code or reconnect the MCP afterward.

### Uninstall from Claude Code

```bash
~/.local/share/weaver-next/install.sh uninstall
```

The command removes only Weaver's Claude MCP registration and installed skills. It intentionally leaves the checkout and every project `.weaver/` directory intact. Remove the checkout separately only when you no longer need the installer:

```bash
rm -rf ~/.local/share/weaver-next
```

## Data, network, and permissions

- Authoritative project state: `<workspace>/.weaver/weaver.db`.
- Assets and authoritative data: `<workspace>/.weaver/`.
- Claude runtime checkout: `~/.local/share/weaver-next`.
- Claude skills: `~/.claude/skills/weaver-open` and `~/.claude/skills/weaver-watch`.
- Codex plugin cache: managed by Codex; do not edit it manually.
- Browser preview and SSE endpoints bind only to `127.0.0.1` and require an owner-secret-derived capability token.
- Preview metadata is created only after you explicitly open a workspace. `<workspace>/.weaver/preview.json` and `~/.weaver/runtime/` are owner-only (`0600` files inside `0700` directories); do not share their contents.
- Link enrichment makes outbound HTTP/HTTPS requests only when you explicitly add a public link. Private-network targets are blocked.

## Troubleshooting

### `Node.js 24 or newer is required`

Install a current Node.js release, confirm `node --version`, then rerun the installer. Opening the MCP with an older Node version fails because Weaver uses `node:sqlite`.

### `release runtime is missing`

Public checkouts include `plugins/weaver-next/runtime/server.mjs`. In a development checkout, run `npm install && npm run build:release`.

### `BOUND_CANVAS_OFFLINE`

Open or focus the Weaver canvas. Agent writes require an online canvas heartbeat; Weaver deliberately refuses to write from a stale snapshot.

### Blank or outdated Codex Widget

Upgrade the marketplace, reinstall the plugin, and open a fresh Codex task. An already running task can retain the previous process and cached Widget URI.

### Claude reports duplicate Weaver tools

Keep only the user-scoped `weaver-preview` registration for Claude. The repository's `weaver_mcp` definition is intended for Codex.

### Inspect diagnostics

Ask the active agent to call `weaver_get_diagnostics`. It returns bounded, redacted in-memory events and server health without returning the preview capability URL or local log paths.

Persistent logs are disabled by default. For a short troubleshooting session only, start the MCP with `WEAVER_FILE_LOG=1`. Files use `0600`, record `warn` and `error` by default, rotate at 1 MB, keep three files, and expire after seven days. Disable the variable and restart Weaver when diagnosis is complete; startup removes legacy `mcp-*.jsonl` files.

Stderr logging is also disabled by default because Codex or Claude may persist it. Use `WEAVER_STDERR_LOG=1` only for a short live diagnosis; optionally set `WEAVER_LOG_LEVEL=warn|error`. Disable both variables and restart Weaver afterward.

## Build from source

Contributors can build the same release package locally:

```bash
npm install
npm run build:release
npm run check:release
```

The generated marketplace plugin is written to `plugins/weaver-next/`. See [RELEASING.md](RELEASING.md) for the release checklist.
