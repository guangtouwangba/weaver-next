# weaver-next

## Stack

Planned stack: Next.js, TypeScript, Python or TypeScript API service, npm.

## Product Direction

Scene-driven semantic knowledge space with Codex MCP/Skills integration. See [docs/PRD-Weaver-Redesign-2026.md](docs/PRD-Weaver-Redesign-2026.md)
(source of truth) and [docs/rebuild-plan.md](docs/rebuild-plan.md).

## Guidelines

- Keep graph content and view layout separate: `graphRevision` must not change for layout-only operations.
- The core artifact is a typed semantic graph. Canvas, tree, graph, board, timeline, flow, and table are projections with independent layout state.
- Coding agents generate semantic GraphOperations or LayoutPlan constraints, never unchecked final coordinates or direct database edits.
- Preserve per-branch context isolation as the `ancestor_path` policy while allowing other scene-specific bounded context policies.
- Treat pinned nodes, no-overlap, project path confinement, ChangeSet audit, deterministic layout, preview, and undo as binding invariants.
- Put tests in `__tests__/` when working in frontend/package code.
- Do not port old Weaver modules wholesale without documenting why (and only if
  they fit the new branching loop, not the old canvas loop).
- Prefer simple local-first architecture before introducing distributed systems.
