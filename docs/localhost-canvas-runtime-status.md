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

The latest local acceptance run completed successfully:

- `npm test`: 53 test files and 291 tests passed.
- `npm run typecheck:widget`: passed.
- `npm run e2e:nightly`: 10 Playwright tests passed, including all View families,
  matrix/table projections, a 500-node/1000-edge fixture, repeated worker crashes,
  two concurrent workspaces, SSE recovery, disconnect/reconnect, and writer takeover.
- `npm run build:release && npm run check:release && npm run probe:release`: passed;
  the release snapshot contained 161 files and the packaged MCP exposed 16 tools.

## Not completed yet

These items are intentionally incomplete because they require elapsed production time
or must occur only after the Phase 7 exit gate. They must not be marked complete based
on local automation alone.

### Phase 7 observation gate

- [ ] Keep the native Widget rollback surface available through at least 2026-07-27
  (14 days from the 2026-07-13 cutover baseline).
- [ ] Complete one release-acceptance cycle using the packaged localhost runtime.
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
