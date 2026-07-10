# Weaver Next

Weaver Next is a scene-driven semantic knowledge space that runs as a native Codex plugin.

Users build typed nodes and relationships for brainstorming, learning, research, and planning. Nodes have two independent axes: a scene-semantic `type` and a first-phase content kind (`document`, `image`, or `link`). The same graph can be viewed as a free canvas, tree, relationship graph, board, timeline, flow, or table. Content and layout are versioned independently.

## Core Loop

1. Describe a goal; Weaver recommends a versioned scene pack and view.
2. Create or edit semantic nodes and typed relations in the native widget.
3. Send the current selection and instruction to the coding agent.
4. The agent submits auditable GraphOperations or a semantic LayoutPlan through MCP.
5. A loopback SSE stream delivers task status and revision deltas; the widget previews, applies, rejects, or reverts them without polling.
6. The deterministic layout engine calculates and scores layout candidates; mixed content-and-layout tasks continue after content review.
7. Produce scene-defined artifacts such as articles, flashcards, quizzes, plans, or SOPs.

## Content Nodes

- **Document** — Markdown-backed note or article. Canvas cards remain a stable preview; full writing happens in the 420px side editor with autosave and revision-conflict protection.
- **Image** — a validated, deduplicated local Asset projected as a semantic node or attached as an article cover/reference. The canvas loads only a 640px WebP thumbnail.
- **Link** — a public HTTP/HTTPS bookmark enriched with bounded title, description, and cover metadata. Private-network targets, oversized responses, and redirect abuse are blocked.

Use the widget's **Create** menu to add an article, upload an image, or save a link. Pasting an image while the canvas is focused creates an image node. Double-click a document card to edit it.

Canvas navigation follows a free design-tool model: drag empty space to pan, use the wheel or trackpad to pan, pinch or Cmd/Ctrl-scroll to zoom around the pointer, hold Space to pan from any tool state, and hold Shift to box-select. The live viewport is included in CanvasContext sent to the coding agent.

The agent never invents final coordinates or writes the project database directly. Weaver stores project state under `<workspace>/.weaver/`, keeps `graphRevision` separate from each view's `layoutRevision`, and routes agent writes through ChangeSets. The MCP process also owns a token-scoped, read-only SSE endpoint bound to `127.0.0.1`; SQLite remains authoritative and disconnects recover with `Last-Event-ID`.

## Packages

- `apps/widget` — native Codex widget and standalone development preview.
- `packages/contracts` — graph, task, ChangeSet, and layout schemas.
- `packages/core` — pure graph, layout-operation, and context logic.
- `packages/layout-engine` — deterministic candidates, routing, and quality scoring.
- `packages/storage` — project-local SQLite persistence.
- `packages/mcp` — local stdio MCP server and widget resource.
- `packages/scene-packs` — 13 built-in scene packs.
- `skills` — stable coding-agent workflows.

## Development

```bash
npm install
npm run build:plugin
npm run test
node scripts/probe-mcp.mjs
```

The authoritative product direction is [docs/PRD-Weaver-Redesign-2026.md](docs/PRD-Weaver-Redesign-2026.md).
