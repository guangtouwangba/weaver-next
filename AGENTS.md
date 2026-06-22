# weaver-next

## Stack

Planned stack: Next.js, TypeScript, Python or TypeScript API service, npm.

## Product Direction

Branching thinking tool. See [docs/PRD-Weaver-Redesign-2026.md](docs/PRD-Weaver-Redesign-2026.md)
(source of truth) and [docs/rebuild-plan.md](docs/rebuild-plan.md).

## Guidelines

- Keep the product loop narrow: thought node -> fork/branch -> (optional
  crystallize) -> cited draft -> export.
- The core artifact is a branching thinking tree, NOT a canvas. Sources are
  optional grounding, not required.
- Per-branch context isolation (each branch inherits only its ancestor chain) is
  the moat — build and test it early, keep it pure.
- Put tests in `__tests__/` when working in frontend/package code.
- Do not port old Weaver modules wholesale without documenting why (and only if
  they fit the new branching loop, not the old canvas loop).
- Prefer simple local-first architecture before introducing distributed systems.
