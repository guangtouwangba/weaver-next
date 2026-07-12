# ADR-0001: Codex Widget and TypeScript Semantic Graph are authoritative

- Status: Accepted
- Date: 2026-07-12
- Supersedes: legacy architecture ADR-0001 through ADR-0027

## Decision

Weaver is implemented as a Codex plugin with an Apps-SDK Widget and a local TypeScript
MCP server. The authoritative content model is a typed Semantic Graph. Canvas, Tree,
Graph, Flow, Timeline, Board, Matrix, and Table are independent Views over that Graph.
Graph, Layout, View Catalog, and Chat Binding revisions remain independent.

TypeScript/Zod contracts are the only structure authority. SQLite is the only storage
adapter. Agents submit semantic ChangeSets and LayoutPlans; deterministic modules
calculate and persist validated results. The Widget provides an inline entry card and
a fullscreen Canvas while natural-language input remains in Codex Chat.

## Consequences

- The retired Next.js/Python tree-first implementation leaves the active repository.
- No Python/OpenAPI code generation or hand-written Widget compatibility types remain.
- Existing `.weaver` data may be backed up and reset on schema incompatibility.
- MCP tool names and wire shapes may change as the tool surface is consolidated.
