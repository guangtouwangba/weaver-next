# Releasing Weaver

> Localhost runtime migration: releases must converge on a thin MCP bridge plus an
> immutable `~/.weaver/runtimes/<buildId>/` payload containing the supervisor, worker,
> and single Canvas bundle. During the time-boxed rollback window the generated plugin
> may still include the legacy Widget, but it must not be the only acceptance path or
> receive product behavior absent from localhost.

Successful runtime startup performs bounded cache cleanup: all builds referenced by
workspace descriptors and the two newest unreferenced builds survive, with a 1 GiB soft
cap. `npm run runtime:cleanup -- <temporary-runtime-root>` exercises the same policy explicitly.

The rollback surface is owned by the Weaver maintainers. Its earliest removal date is
2026-07-27, and removal also requires one completed release-acceptance cycle plus the
Phase 7 exit gate in `docs/localhost-canvas-runtime-prd.md`. Until then it receives only
P0/P1 rollback fixes; all product work targets localhost.

The dated completion checklist and observation evidence live in
[`docs/localhost-canvas-runtime-status.md`](localhost-canvas-runtime-status.md). Phase 8
cleanup must not start until every Phase 7 checkbox in that file is backed by evidence.

The default surface is always localhost. During the rollback window, a Codex operator may
restart the MCP bridge with `WEAVER_CANVAS_SURFACE=legacy-widget` and a machine-readable
reason such as `WEAVER_CANVAS_FALLBACK_REASON=P0_OPEN_FAILURE`. The legacy surface is not
available to Claude. Every activation appends a redacted `canvas.legacyFallbackUsed` entry
with the reason code to local Weaver diagnostics; no Project content is logged. Remove the
environment variables and restart the bridge to return to localhost.

Weaver releases one version through two GitHub-native channels: the Codex Git marketplace snapshot in `plugins/weaver-next/` and a GitHub Release archive for inspection and distribution. npm is not part of the release process.

## Prerequisites

- A clean, reviewed release commit on `master`.
- Node.js 24 and a current npm installation.
- GitHub CLI authenticated with release and repository administration permission.
- The version synchronized in the root package and `.codex-plugin/plugin.json`.
- All secrets removed from the current tree and Git history.

## Build and validate

For the Codex in-app Browser or Claude system-browser release smoke, run
`npm run smoke:host-bridge`, open the emitted one-time URL in the target host, and wait
for `WEAVER_HOST_SMOKE_RESULT={"ok":true,...}`. The script proves the Browser claim and
an Agent write converge through the packaged MCP bridge and workspace runtime.

```bash
npm ci
npm run build:release
npm run check:release
npm test
npm run typecheck:widget
npm run probe:release
npm run e2e:nightly
```

`build:release` regenerates `plugins/weaver-next/`. Review the generated manifest and ensure the snapshot contains only the MCP bridge, immutable runtime payload, Canvas, Skills, native image dependency, metadata, license, and—only during the rollback window—the legacy Widget fallback.
The release probe verifies the installed bridge/Canvas Agent loop. Package tests also move
the source plugin cache out of the way after launch and verify that `/app/` remains available
from the immutable runtime cache.

Pull requests run `npm run e2e:core` after building the production packages and Canvas.
The scheduled macOS workflow and tagged releases run `npm run e2e:nightly`, which adds the
large-graph performance fixture and host compatibility checks to the same real localhost suite.

Test both installation paths with a temporary HOME before tagging. A release is not ready merely because compilation succeeds; open the real canvas and complete one preview/apply/undo cycle.

## Tag and GitHub Release

1. Update `CHANGELOG.md` and remove the target changes from Unreleased.
2. Commit the source and generated marketplace snapshot together.
3. Tag the commit as `v<version>` and push the tag.
4. The release workflow rebuilds and validates the snapshot, creates `weaver-next-<version>-macos-arm64.tar.gz`, and publishes its SHA-256 checksum.
5. Compare the workflow artifact manifest with the committed marketplace snapshot.

## Rollback

- Do not replace an existing tag or GitHub Release asset.
- Revert the faulty release on `master`, increment the patch version, rebuild, and publish a new tag.
- Codex users receive the corrected snapshot through `codex plugin marketplace upgrade weaver`.
- Claude users receive it through `install.sh update`.
- Project data migrations must remain backward-readable; never ask users to delete `.weaver/` as an upgrade step.

## Public-release gate

Before changing repository visibility to Public:

- run the complete CI and release checks;
- scan the current tree and full Git history for credentials and private data;
- confirm MIT licensing and third-party notices;
- verify README links and public installation commands;
- set repository description, Topics, and Social Preview;
- perform a final unauthenticated clone and installation after the visibility change.
