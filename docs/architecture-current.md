# Weaver Current Architecture

## Status

This is the current engineering architecture for Weaver. Product decisions remain
authoritative in `docs/PRD-Weaver-Redesign-2026.md`; repository constraints remain
authoritative in `AGENTS.md` and execution rules in `WORKFLOW.md`.

## Product surface

Weaver is a Codex plugin. Its formal UI is an Apps-SDK Widget served as a `ui://`
resource by the local MCP server. An inline card is the entry point; editing and
review happen in Codex fullscreen display mode. Natural-language intent stays in
Codex Chat. The Widget owns visual selection, editing, preview, apply/reject, undo,
and live status.

`apps/web` and `apps/api` are retired. There is no standalone product frontend or
Python domain core.

## Runtime modules

- `packages/contracts`: TS/Zod authority for every persisted and cross-runtime shape.
- `packages/core`: pure Semantic Graph, context policy, and validated operations.
- `packages/scene-packs` and `packages/visual-templates`: compiled immutable catalog.
- `packages/layout-engine`: deterministic candidate generation, routing, and scoring.
- `packages/storage`: project-local SQLite authority under `<workspace>/.weaver/`.
- `packages/mcp`: stdio tools, Chat identity, loopback assets/RPC, and SSE.
- `apps/widget`: inline entry card and fullscreen Codex Canvas.

## State authority

Graph content increments only `graphRevision`. Geometry, projection, theme, routing,
and Pin increment the current View's `layoutRevision`. View catalog metadata increments
`viewCatalogRevision`. Chat/Canvas Project or View switching increments
`bindingRevision`. No module may substitute one revision for another.

One Codex Chat has at most one writable Canvas Session. Raw thread identifiers are
never persisted or exposed. Agent writes require a current online binding and pass
through an auditable ChangeSet or validated LayoutPlan. SQLite transactions persist
state and ProjectEvent together; Widget recovery compares authoritative revisions.

## Data compatibility

The current schema is intentionally incompatible with the retired rebuild. Opening a
workspace with another schema backs up the entire `.weaver` directory to a timestamped
sibling and creates a fresh store. Backups are never deleted automatically.

## Verification

All behavior changes follow TDD. UI completion requires real interaction in the Codex
inline and fullscreen hosts, Claude preview, and dev read-only preview, including
refresh/recovery and console/network checks.
