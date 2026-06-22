# Weaver Next

Weaver Next is a clean rebuild of Weaver: a self-hosted NotebookLM-style
research workspace with an infinite canvas.

The goal is not to copy the old codebase. The goal is to preserve the useful
product idea and rebuild it with a smaller, testable core.

## Product Direction

Weaver Next helps a single user turn sources into spatial understanding:

1. Import sources.
2. Ask cited questions.
3. Save useful answers as canvas cards.
4. Connect and reorganize cards.
5. Export a structured research output.

## What We Keep

- NotebookLM alternative positioning.
- Self-hosted deployment.
- Source-grounded chat with citations.
- Visual canvas for research structure.
- Bring-your-own model provider.
- Chinese and global source workflows.

## What We Rebuild

- Start with one source pipeline before adding every file/video platform.
- Keep canvas data simple before adding advanced node types.
- Use explicit project state instead of sprawling frontend stores.
- Make RAG quality observable from day one.
- Prefer boring deployment over clever architecture.

## First Milestone

The first milestone is a local MVP:

- One Next.js app.
- One API service.
- SQLite or Postgres via a thin repository layer.
- Source upload for PDF/text/URL.
- Basic chunking and retrieval.
- Cited chat.
- Canvas cards saved from answers.
- Markdown export.

See [docs/rebuild-plan.md](docs/rebuild-plan.md) for the execution plan.

