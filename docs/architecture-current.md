# Weaver Current Architecture

## Status

This is the current engineering architecture for Weaver. Product decisions remain
authoritative in `docs/PRD-Weaver-Redesign-2026.md`; repository constraints remain
authoritative in `AGENTS.md` and execution rules in `WORKFLOW.md`.

The approved migration target is defined in `docs/localhost-canvas-runtime-prd.md`:
one workspace-scoped localhost Canvas, a workspace supervisor/worker, and a Chat-scoped
MCP bridge. During the time-boxed migration the working tree may still contain the
legacy Apps-SDK Widget fallback; new architecture work must move toward the localhost
target and must not add new product behavior only to the fallback.

## Product surface

Weaver is a Codex-driven localhost application. Its formal UI is one Canvas served by
a workspace-scoped local runtime and shown preferentially in Codex's right-side in-app
Browser. The system browser is a fallback. Natural-language intent stays in Codex Chat;
the Canvas owns visual selection, manual editing, preview, apply/reject, undo, and live
status. Without a paired online Chat, manual editing remains available while Agent writes
fail closed.

During migration only, the legacy Codex resource remains as a rollback surface. Its
resource-specific HTML escaping and display-mode behavior are not part of the target
architecture and are deleted after the localhost cutover gate.

The Weaver maintainers own that rollback surface. The earliest removal date is
2026-07-27, subject to one completed release-acceptance cycle and every Phase 7 exit
condition; this date is a lower bound, not an automatic deletion trigger.

The Canvas owns a persistent direct-manipulation tool state. Its left toolbar
coordinates select, pan, note, connect and frame modes through Pointer Events. Manual
node moves are Layout operations and pin the affected nodes; typed connections are
Graph operations constrained by the active Scene Pack.

`apps/web` and `apps/api` are retired. There is no standalone product frontend or
Python domain core.

## Runtime modules

- `packages/contracts`: TS/Zod authority for every persisted and cross-runtime shape.
- `packages/core`: pure Semantic Graph, context policy, and validated operations.
- `packages/scene-packs` and `packages/visual-templates`: compiled immutable catalog.
- `packages/layout-engine`: deterministic candidate generation, routing, and scoring.
- `packages/storage`: project-local SQLite authority under `<workspace>/.weaver/`.
- `packages/mcp`: Chat-scoped stdio tools, trusted Chat identity, and workspace-service bridge adapters.
- `packages/workspace-service`: localhost worker authority for Browser Sessions, application RPC/SSE, WorkspaceStore, and Canvas assets.
- `packages/workspace-supervisor`: workspace-scoped stable loopback origin, owner-only control socket, worker recovery, and idle exit.
- `apps/widget`: migration-time Canvas source; renamed mechanically to `apps/canvas` after cutover.

## Canvas rendering

The production Canvas uses a renderer-neutral scene model and a hybrid renderer; React
Flow is not a runtime dependency and there is no production fallback to it.

- PixiJS v8 uses the mature WebGL renderer for edges, routed arrows, groups, axes,
  low-detail nodes, selection feedback, and projection decoration. The strict-CSP
  shader compiler adapter is loaded explicitly; the CSP itself is not weakened.
- `CanvasRuntime` owns the camera and transient node transforms. Pointer, wheel, pinch,
  pan, zoom, and drag updates are applied imperatively in one animation-frame loop and
  do not commit the React root. Viewport persistence and validated Layout operations
  are committed only when interaction settles.
- RBush indexes scene bounds for culling, hit testing, box selection, and directional
  navigation. Rich DOM cards are limited to the viewport plus overscan and at most 100
  complex nodes. An active editor remains mounted while other cards virtualize.
- LOD is fixed: rich DOM at zoom `>= 0.65`, GPU cards at `0.30..0.65`, and simplified
  marks below `0.30`. Active interaction immediately uses the dynamic GPU-only tier and
  restores the zoom-derived tier after 120 ms of idle time.
- `canvas`, `tree`, `graph`, `flow`, `timeline`, `board`, and matrix projections compile
  into the shared spatial scene. Table projections use a virtualized DOM table and the
  same Graph, selection, editing, and revision contracts.

Graph and LayoutDocument remain authoritative. Camera movement does not compile the
scene or increment a revision; a completed node move increments only `layoutRevision`,
while content editing continues through ChangeSet and increments only `graphRevision`.
WebGL initialization failure produces an actionable state with Project, View, Session,
build, and revisions rather than silently switching renderers.

## State authority

Graph content increments only `graphRevision`. Geometry, projection, theme, routing,
and Pin increment the current View's `layoutRevision`. View catalog metadata increments
`viewCatalogRevision`. Chat/Canvas Project or View switching increments
`bindingRevision`. No module may substitute one revision for another.

One Codex Chat has at most one paired writable Canvas Session, and one Project has at
most one browser writer lease. Raw thread identifiers are never persisted or exposed.
Agent writes require a current online binding and pass through an auditable ChangeSet
or validated LayoutPlan. Manual browser writes require the current writer lease and a
transactional mutation audit record. SQLite transactions persist state, audit, and
ProjectEvent together; Canvas recovery compares authoritative revisions.

The localhost application rejects unexpected `Host` values and requires exact same-origin
plus a Browser-Session-bound CSRF token for every POST. Session credentials remain in an
HttpOnly, SameSite=Strict cookie; static responses use strict CSP, `nosniff`, and no-referrer.
Release builds install the manifest-verified supervisor, Canvas assets, and native runtime
dependencies atomically under `~/.weaver/runtimes/<buildId>/`, so a running Canvas does not
depend on the lifetime of its originating plugin cache directory.

## Data compatibility

Supported schema versions migrate sequentially in place after a complete timestamped
backup. A failed supported migration rolls back and leaves the original database
authoritative. Only explicitly identified retired/incompatible schemas use the legacy
backup-and-fresh-store path; a newer-than-runtime schema is rejected without mutation.
The current schema is v8. Fixtures cover current v8 reopening, v7 -> v8, and the oldest
supported v6 -> v7 -> v8 path; schemas v1-v5 are explicitly retired and use the preserved
backup plus fresh-store recovery path.

## Verification

All behavior changes follow TDD. UI completion requires the real localhost Canvas path,
including refresh/recovery, worker restart, duplicate-tab takeover, Chat disconnect,
and console/network checks. Codex in-app Browser and Claude receive release smoke tests
as containers of the same application, not separate UI implementations.

Repository-native Playwright tests launch the real workspace supervisor/worker against a
unique temporary workspace and drive its paired loopback page. They do not intercept
application RPC, SSE, SQLite, or manual write operations.

The repeatable renderer benchmark is `e2e/canvas-performance.spec.ts`. It distinguishes
hardware WebGL from SwiftShader: only hardware results may satisfy the product FPS gate;
software rendering verifies the fixture, interaction paths, DOM cap, lifecycle, trace
collection, and absence of browser errors.
