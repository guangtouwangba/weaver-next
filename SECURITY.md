# Security Policy

## Supported versions

Weaver is in early development. Security fixes are applied to the latest release only.

## Reporting a vulnerability

Please do not open a public issue for a suspected vulnerability. Use GitHub's private vulnerability reporting for this repository. Include the affected version, reproduction steps, impact, and any suggested mitigation.

We aim to acknowledge a report within seven days. Timelines for a fix or disclosure depend on severity and reproducibility.

## Security boundaries

Weaver is local-first. Project state lives under each workspace's `.weaver/` directory. The MCP loopback server binds to `127.0.0.1`, requires an owner-secret-derived capability token, confines file access to the explicitly selected workspace, and keeps agent writes behind audited ChangeSets and revision checks.

Preview capability metadata is not written during MCP startup. After the user explicitly opens a workspace, Weaver publishes the launcher metadata under that workspace's `.weaver/` directory with directory mode `0700` and file mode `0600`. Cross-process preview state lives under `~/.weaver/runtime/`, never inside an installed plugin or release directory, and uses the same owner-only permissions. Startup removes the obsolete in-workspace `preview-target.json` used by earlier builds. Treat `preview.json` as a secret because its URL grants local preview access.

Persistent MCP logging and stderr logging are disabled by default. Runtime diagnostics use a bounded, redacted in-memory ring and never return the preview capability URL or an absolute log path. Legacy `mcp-*.jsonl` files are removed on startup while file logging remains disabled.

For temporary troubleshooting, operators may set `WEAVER_FILE_LOG=1`. Opt-in files are owner-only (`0600`), contain warning/error records by default, rotate at 1 MB, retain at most three files for seven days, and still redact paths, tokens, stacks, arbitrary text, and tool payloads. Environment overrides have hard ceilings of 10 MB per file, ten files, and 30 days.

For temporary stderr diagnostics, set `WEAVER_STDERR_LOG=1`; `WEAVER_LOG_LEVEL` controls the threshold and defaults to `error`. Host applications may persist stderr themselves, so disable this option after troubleshooting.

Never attach `.weaver/` databases, logs, environment files, access tokens, or private source material to a public issue without redacting them.
