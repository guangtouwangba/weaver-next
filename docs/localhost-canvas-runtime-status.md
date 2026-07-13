# Localhost Canvas migration status

> Status date: 2026-07-13
>
> Implementation source: [localhost-canvas-runtime-prd.md](localhost-canvas-runtime-prd.md)
>
> Current phase: Phase 7 observation and release acceptance

## Completed implementation

The localhost Canvas is the default production surface. The workspace-scoped
supervisor/worker runtime, Browser Sessions, single-Project writer lease, MCP bridge,
immutable runtime cache, diagnostics, supported schema migrations, recovery behavior,
Codex/Claude launch paths, rollback switch, and CI/nightly/release validation are
implemented.

Manual Browser Graph/Layout/View/project/asset mutations now carry caller-generated
`mutationId` values, commit state and audit records transactionally, replay
idempotently, and are reachable through the Canvas Undo control. Runtime upgrades
quiesce and drain in-flight writes before swapping workers. Installed MCP processes
pin their verified Widget bundle in memory, so a running workspace can restart after
the original plugin cache has been removed.

The latest local acceptance run completed successfully:

- `npm run lint`: completed with no lint errors (pre-existing warnings remain).
- `npm test`: 54 test files and 304 tests passed.
- `npm run typecheck:widget`: passed.
- `npm run e2e:nightly`: 13 Playwright tests passed, including all View families,
  matrix/table projections, a 500-node/1000-edge fixture, repeated worker crashes,
  two concurrent workspaces, SSE recovery, disconnect/reconnect, writer takeover,
  cold-start collision plus deletion of the original plugin cache, real Canvas Undo,
  and formal Codex/Claude MCP -> supervisor -> Browser convergence.
- `npm run build:release && npm run check:release && npm run probe:release`: passed;
  the release snapshot contained 161 files and the packaged MCP exposed 16 tools.
- Packaged Codex and Claude host-bridge smoke tests each claimed a real headless
  Chromium Canvas, observed the bound host, applied an Agent write through MCP, and
  observed the same node in the Browser without console errors.

## Not completed yet

These items are intentionally incomplete because they require elapsed production time
or must occur only after the Phase 7 exit gate. They must not be marked complete based
on local automation alone.

### Phase 7 observation gate

- [ ] Keep the native Widget rollback surface available through at least 2026-07-27
  (14 days from the 2026-07-13 cutover baseline).
- [x] Complete one release-acceptance cycle using the packaged localhost runtime
  (2026-07-13: release build/check/probe plus automated Codex and Claude Browser smoke).
- [ ] Record seven consecutive dogfood days without invoking the legacy rollback.
- [ ] Confirm there are no unresolved P0/P1 localhost opening or data-loss defects at
  the end of the observation window.
- [ ] Review local `canvas.legacyFallbackUsed` diagnostics and record whether rollback
  was invoked, including its machine-readable reason code.

Phase 7 is complete only when every checkbox above is supported by dated evidence.
The date 2026-07-27 is the earliest possible completion date, not an automatic approval.

### Phase 8 cleanup

Do not begin these actions until Phase 7 is complete:

- [ ] Delete the native full-Canvas `ui://` Widget fallback and its surface switch.
- [ ] Remove legacy Apps-SDK display-mode/resource compatibility code and tests that
  exist only for rollback.
- [ ] Mechanically rename `apps/widget` to `apps/canvas` and update workspace/package,
  build, release, documentation, and test references.
- [ ] Rebuild the committed plugin snapshot without the legacy Widget payload.
- [ ] Run production, full nightly E2E, Codex in-app Browser smoke, and Claude
  system-browser smoke against the localhost-only release candidate.
- [ ] Verify that no full Canvas `ui://` resource remains in the release manifest.

## Evidence log

Append dated evidence here during the observation window. Do not rewrite prior entries.

| Date | Evidence | Result |
|---|---|---|
| 2026-07-13 | Local unit/integration, nightly E2E, release build/check/probe | Passed; Phase 7 observation started |
| 2026-07-13 | P0/P1 remediation: Browser/Agent boundary, writer audit, detached takeover, full inverse undo, build/protocol fencing, crash circuit, quiesced upgrade | 301 tests and 12 nightly E2E passed |
| 2026-07-13 | Packaged Codex and Claude MCP/supervisor/Chromium host bridge smoke | Passed; release-acceptance cycle complete |
| 2026-07-13 | Searched workspace and user runtime diagnostics for `canvas.legacyFallbackUsed` | No persisted fallback event found; this does not replace seven dated dogfood days |
| 2026-07-13 | Caller-owned mutation replay, project/asset audit and Undo, in-flight quiesce drain, immutable-cache deletion restart, and explicit Agent connection status | 304 tests and 13 nightly E2E passed; release check/probe and both packaged host smokes passed |
