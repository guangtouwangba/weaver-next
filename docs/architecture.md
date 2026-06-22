# Architecture Notes

## Initial Shape

The first implementation should be small:

```text
app/
  web/        Next.js UI
  api/        API service
packages/
  core/       shared domain types and pure logic
  retrieval/  chunking, embedding, search interfaces
docs/
  *.md
```

This structure can change, but the boundary should stay clear:

- UI renders state and sends user intent.
- API owns orchestration.
- Core owns domain rules.
- Retrieval owns source-to-context behavior.
- Persistence is hidden behind repositories.

## Domain Model

```text
Project
Source
Chunk
Conversation
Message
Citation
Card
Edge
Export
```

Avoid adding new domain objects until one of these can no longer express the
workflow clearly.

## Testing Defaults

- Unit tests for pure parsing, chunking, citation mapping, and card graph logic.
- API contract tests for each route.
- One browser smoke test per milestone.
- Deterministic fake LLM responses in CI.

## Migration Rule From Old Weaver

Do not copy a module directly from the old repo unless all of these are true:

- It supports the MVP core loop.
- It has a clear owner boundary.
- It can be tested without the old app shell.
- It does not drag unrelated dependencies with it.

