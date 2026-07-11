# Releasing Weaver

Weaver releases one version through two GitHub-native channels: the Codex Git marketplace snapshot in `plugins/weaver-next/` and a GitHub Release archive for inspection and distribution. npm is not part of the release process.

## Prerequisites

- A clean, reviewed release commit on `master`.
- Node.js 24 and a current npm installation.
- GitHub CLI authenticated with release and repository administration permission.
- The version synchronized in the root package and `.codex-plugin/plugin.json`.
- All secrets removed from the current tree and Git history.

## Build and validate

```bash
npm ci
npm run build:release
npm run check:release
npm test
npm run typecheck:widget
node scripts/probe-mcp.mjs
```

`build:release` regenerates `plugins/weaver-next/`. Review the generated manifest and ensure the snapshot contains only the runtime, Widget, Skills, native image dependency, metadata, and license.

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
