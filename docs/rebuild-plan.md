# Weaver Next Rebuild Plan

> Direction is set by [PRD-Weaver-Redesign-2026.md](PRD-Weaver-Redesign-2026.md)
> (中文, source of truth). This plan is the execution view of that PRD.

## Why Restart

The old implementation proved a product idea but accumulated too much surface
area:

- Too many capabilities were added before the core loop was stable.
- Frontend state became hard to reason about.
- Canvas, chat, source ingestion, and output generation were tightly coupled.
- Desktop, agent, and production-memory experiments blurred the product line.
- Test coverage existed, but it was not always aligned with the smallest user
  workflow.

The rebuild also **changes direction**, not just code: from "NotebookLM + canvas"
to a **branching thinking tool**. The old repo is a product reference, not code
to port wholesale.

## Product Boundary

Weaver Next is a personal **branching-thinking** workspace:

- It is for one user, not teams.
- It is **branching-tree-first**, not canvas-first and not linear chat.
- Sources are **optional** grounding — it works with zero sources (AI + your own
  ideas), and grounds answers in citations when sources exist.
- An argument outline is an **optional** crystallization layer, not required.
- It focuses on **think -> visualize -> draft**, not generic document editing.

## Core Loop

The first usable loop is:

1. Create a project (a thinking topic / a piece to produce).
2. *(Optional)* Add sources for grounding.
3. Add a thought — ask a question, or write your own thought + annotation. It
   becomes a **node**.
4. **Fork** from any node — explicitly, or by accepting an AI-proposed fork.
5. Backtrack (refocus an old node), prune dead branches. **Each branch keeps its
   own context** (only its ancestor chain).
6. *(Optional)* Crystallize promising branches into an argument outline.
7. Generate a draft — **directly from selected branches**, or via the outline —
   with citations (when grounded) and a chosen tone.
8. Export Markdown.

No extra feature enters the MVP unless it strengthens this loop.

## Architecture Principles

- One state model per concept: Project, ThoughtNode, Branch, Relation,
  Source *(optional)*, Chunk, Citation, Outline *(optional)*, Draft, Export.
- The thinking tree's backbone is a **tree** (auto-laid-out from the act of
  forking); cross-branch links are an additive **Relation** layer, never a
  free-form canvas to arrange by hand.
- **Per-branch context resolution is a first-class service**: given a node, it
  returns only the ancestor-chain context. This is the moat — build and test it
  early.
- Repository interfaces around persistence so local SQLite and Postgres stay
  swappable.
- Retrieval is a service with visible inputs and outputs, not hidden inside chat.
- Background jobs are introduced only after synchronous work is proven too slow.
- Every milestone has a smoke test that mirrors the core loop.

## Milestones

### M0: Repo And Product Skeleton

- Create clean repository.
- Record product boundary and architecture rules (this plan + PRD).
- Add basic task list and test expectations.

### M1: Local Project Model

- Create project CRUD.
- Persist project state via the repository layer.
- Unit tests for repository behavior.

### M2: Branching Thinking Tree Core  ⭐ (the moat — prioritized)

- ThoughtNode + Branch model; node = thought segment + annotation.
- Model-provider abstraction; deterministic fake-model test mode.
- Add a node from a question or a written thought.
- **Fork** (explicit) + **AI-proposed forks**; backtrack; prune; fold/expand.
- **Per-branch context isolation**: AI in a branch sees only its ancestor chain.
- Auto-layout tree render; pan/zoom; focus highlight.
- Tests: branch context resolver, fork/backtrack/prune graph logic.

### M3: Optional Source Grounding

- Source ingestion (text/PDF/URL) + chunking + retrieval.
- When sources exist, node answers carry sentence-level clickable citations.
- The tree still works fully with zero sources.

### M4: Crystallize + Draft

- Promote branches/nodes into an (optional) argument outline.
- Generate a cited draft — directly from selected branches, or via the outline.
- Long-form editor + Voice (preset tone: academic / casual / professional).

### M5: Export

- Export the draft to Markdown, preserving citations.
- End-to-end smoke test: think -> branch -> (optional crystallize) -> draft ->
  export.

### M6: Deployment

- Docker Compose.
- Production env template.
- Backup/restore notes.

## Explicit Non-Goals For MVP

- Free-form / infinite canvas (manual node arrangement).
- Real-time collaboration.
- Desktop app.
- Agent visualizer.
- Plugin marketplace.
- Podcast / video generation.
- Full video ingestion.
- Multi-tenant auth.
- Cross-project thinking network.
- Multi-format output beyond Markdown.

These can return later only if the core loop is already excellent.
