# Architecture Notes

> **历史草稿（已废弃）**：本文记录早期 tree-first/Web 方向。当前架构事实源为 [`architecture-current.md`](architecture-current.md) 与 superseding ADR。

> Direction: see [PRD-Weaver-Redesign-2026.md](PRD-Weaver-Redesign-2026.md).
> Core artifact is a **branching thinking tree**, not a canvas.

## Initial Shape

The first implementation should be small:

```text
app/
  web/        Next.js UI
  api/        API service
packages/
  core/       shared domain types and pure logic (tree, branch, context)
  retrieval/  chunking, embedding, search interfaces (used only when grounded)
docs/
  *.md
```

This structure can change, but the boundary should stay clear:

- UI renders state and sends user intent.
- API owns orchestration.
- Core owns domain rules (the thinking tree, branching, context resolution).
- Retrieval owns source-to-context behavior (optional grounding).
- Persistence is hidden behind repositories.

## Domain Model

```text
Project
ThoughtNode      a thought segment + user annotation; the tree's unit
Branch           a path of nodes; carries its own isolated context
Relation         additive cross-branch link (merge/connection) over the tree
Source           OPTIONAL grounding input
Chunk            OPTIONAL, from a Source
Citation         sentence-level link to a Source (when grounded)
Outline          OPTIONAL crystallization of promising branches
Draft
Export
```

The backbone is a **tree** auto-laid-out from forking. `Relation` is an overlay,
never a free-form canvas. Avoid adding new domain objects until one of these can
no longer express the workflow clearly.

## Per-Branch Context Resolution (the moat)

A first-class service in `core`:

- Input: a target `ThoughtNode`.
- Output: the context = **only that node's ancestor chain** (not sibling
  branches).
- This is what makes branch B immune to branch A's assumptions, and is the
  capability NotebookLM / YouMind / ChatGPT lack.
- It must be pure and unit-testable independent of any model call.

## Testing Defaults

- Unit tests for: branch context resolver, fork/backtrack/prune tree logic,
  citation mapping (when grounded), outline-from-branches.
- API contract tests for each route.
- One browser smoke test per milestone.
- Deterministic fake LLM responses in CI.

## Migration Rule From Old Weaver

Do not copy a module directly from the old repo unless all of these are true:

- It supports the new branching-thinking core loop (not the old canvas loop).
- It has a clear owner boundary.
- It can be tested without the old app shell.
- It does not drag unrelated dependencies with it.
