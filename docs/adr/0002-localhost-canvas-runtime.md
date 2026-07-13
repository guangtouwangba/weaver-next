# ADR 0002: Make localhost the canonical Weaver Canvas runtime

- Status: Accepted
- Date: 2026-07-13
- Supersedes: the native-Canvas-host portion of ADR 0001
- Detail: `docs/localhost-canvas-runtime-prd.md`

## Context

The full Canvas currently depends on Codex Apps-SDK resource mounting, iframe and
display-mode lifecycle, and a host tool-call proxy. Those host-owned stages can fail
before Weaver business code runs and are difficult to cover with repository-native E2E.
The repository already has a real loopback Canvas path for Claude and Playwright, but
it is owned by a Chat-scoped MCP process, uses a process/cwd-derived identity, and loads
assets from a plugin/cache lifecycle that is not workspace-stable.

The product requires exact Chat/Canvas binding, local-first manual editing, auditable
writes, deterministic layout, revision recovery, and a test path that is the production
path. A browser page alone cannot restart a crashed native process, so independent
recovery also requires an on-demand workspace supervisor.

## Decision

1. The formal UI is one localhost Canvas application. Codex's in-app Browser is the
   preferred container; a system browser is the fallback and Claude container.
2. A workspace-scoped, on-demand supervisor owns the public loopback origin and worker
   lifecycle. It exits after every browser and bridge is idle.
3. The workspace worker owns WorkspaceStore, application RPC, SSE, Browser Sessions,
   Project writer leases, Canvas assets, and local diagnostics.
4. MCP becomes a Chat-scoped bridge. Raw thread metadata is hashed there and never
   accepted from the browser. Pairing uses a 30-second one-time launch nonce.
5. An unpaired Canvas may perform validated, audited manual writes. Agent writes require
   an online exact Chat binding. One Project has one browser writer with explicit
   takeover.
6. Production and Playwright use the same localhost page, RPC, SSE, and SQLite path.
7. Runtime builds are immutable under `~/.weaver/runtimes/<buildId>/`; mixed build or
   protocol versions fail closed and upgrade through the supervisor.
8. Supported SQLite versions migrate in place after backup. Only explicitly retired,
   incompatible schemas may use backup-and-fresh-store behavior.
9. The complete native Widget remains only for a time-boxed rollback window and is then
   deleted with host-mode UI branches.

## Consequences

- Opening and recovery become Weaver-owned state machines with measurable SLOs and
  actionable error codes.
- Browser, Codex, Claude, and E2E no longer require distinct Canvas business behavior.
- The MCP process becomes smaller, but a supervisor, worker, pairing/session contracts,
  runtime installer, and upgrade protocol must be implemented and tested.
- Manual browser edits need explicit idempotency, mutation audit, inverse operations,
  and writer-lease validation.
- Installation and release packaging must manage immutable runtimes independently from
  Codex's plugin cache.

## Rejected alternatives

- Merely returning the current preview URL from Codex: it preserves Chat-process,
  synthetic-identity, crash-recovery, and cache-lifecycle failures.
- A workspace worker without a supervisor: an open browser cannot restart a crashed
  native process by itself.
- A global launchd daemon: unnecessary installation and privilege complexity for the
  current local-first, on-demand product boundary.
