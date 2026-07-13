# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Before exploring, read these

- **`CONTEXT.md`** at the repo root.
- **`docs/adr/`** — read ADRs that touch the area about to be changed.
- **`product.md`**, **`docs/PRD-Weaver-Redesign-2026.md`**, and **`docs/architecture-current.md`** as required by `AGENTS.md`.

If `CONTEXT.md` does not exist, proceed silently. Do not flag its absence or suggest creating it upfront. The `/domain-modeling` skill creates it lazily when terms or decisions are resolved.

## File structure

Weaver uses a single-context layout:

```text
/
├── CONTEXT.md
├── docs/
│   └── adr/
├── apps/
└── packages/
```

The packages are technical runtime boundaries within one Weaver product domain. Their presence does not imply separate domain contexts.

## Use the glossary's vocabulary

When output names a domain concept—in an issue title, refactor proposal, hypothesis, or test name—use the term defined in `CONTEXT.md`. Do not drift to synonyms the glossary explicitly avoids.

If a needed concept is absent from the glossary, reconsider whether the language belongs to the project or note the gap for `/domain-modeling`.

## Flag ADR conflicts

If output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0007 (event-sourced orders) — but worth reopening because…_
