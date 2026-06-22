# Weaver Next Rebuild Plan

## Why Restart

The old implementation proved the product direction but accumulated too much
surface area:

- Too many capabilities were added before the core loop was stable.
- Frontend state became hard to reason about.
- Canvas, chat, source ingestion, and output generation were tightly coupled.
- Desktop, agent, and production-memory experiments blurred the product line.
- Test coverage existed, but it was not always aligned with the smallest user
  workflow.

The rebuild treats the old repository as a product reference, not as code to
port wholesale.

## Product Boundary

Weaver Next is a personal research workspace:

- It is for one user, not teams.
- It is source-grounded, not general chat.
- It is canvas-first, but chat remains the main input.
- It focuses on research-to-output, not generic document editing.

## Core Loop

The first usable loop is:

1. Create a project.
2. Add one or more sources.
3. Ask a question.
4. Receive an answer with citations.
5. Save the answer as a canvas card.
6. Move and connect cards.
7. Export the canvas as Markdown.

No extra feature enters the MVP unless it strengthens this loop.

## Architecture Principles

- One state model per concept: Project, Source, Chunk, Conversation, Card, Edge.
- Repository interfaces around persistence so local SQLite and Postgres stay
  swappable.
- Retrieval is a service with visible inputs and outputs, not hidden inside chat.
- The canvas stores semantic cards, not UI implementation details.
- Background jobs are introduced only after synchronous ingestion is proven too
  slow.
- Every milestone has a smoke test that mirrors the core loop.

## Milestones

### M0: Repo And Product Skeleton

- Create clean repository.
- Record product boundary.
- Record architecture rules.
- Add basic task list and test expectations.

### M1: Local Project And Source Model

- Create project CRUD.
- Add text source ingestion.
- Store source text and chunks.
- Add unit tests for chunking and repository behavior.

### M2: Cited Chat

- Add model-provider abstraction.
- Add retrieval over project chunks.
- Return answers with citation objects.
- Add a deterministic test mode with fake model responses.

### M3: Canvas Core

- Add cards and edges.
- Save chat answers as cards.
- Render cards on a simple canvas.
- Persist card position and relationships.

### M4: Export

- Export selected cards or the full canvas to Markdown.
- Preserve citations in export.
- Add one end-to-end smoke test for import -> chat -> card -> export.

### M5: Deployment

- Add Docker Compose.
- Add production env template.
- Add backup/restore notes.

## Explicit Non-Goals For MVP

- Real-time collaboration.
- Desktop app.
- Agent visualizer.
- Plugin marketplace.
- Podcast generation.
- Full video ingestion.
- Multi-tenant auth.
- Complex knowledge graph visualization.

These can return later only if the core loop is already excellent.

