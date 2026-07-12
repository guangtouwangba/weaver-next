---
version: alpha
name: Weaver Semantic Canvas
description: >-
  A calm, dark, content-first semantic canvas for human and AI collaboration.
  Weaver uses a restrained monochrome workspace, one blue interaction accent,
  typed connectors, and softly bounded regions so nodes, relationships, and
  spatial structure remain legible at every zoom level. Content is authoritative
  in the Graph; visual geometry belongs to an independent LayoutDocument.

colors:
  canvas: "#0a0a0a"
  background: "#0f0f0f"
  surface: "#1f1f1f"
  surface-muted: "#2b2b2b"
  surface-raised: "#404040"
  foreground: "#f5f5f5"
  foreground-strong: "#fafafa"
  foreground-muted: "#7a7a7a"
  primary: "#1fa2dc"
  primary-bright: "#33a8ff"
  primary-soft: "#90c4e5"
  on-primary: "#0a0a0a"
  border: "rgba(255,255,255,0.10)"
  border-strong: "rgba(255,255,255,0.20)"
  selection: "#ffffff"
  edge: "rgba(255,255,255,0.376)"
  edge-muted: "rgba(255,255,255,0.18)"
  group-fill: "rgba(31,162,220,0.08)"
  group-border: "rgba(31,162,220,0.40)"
  success: "#4caf50"
  warning: "#ff9800"
  danger: "#f44336"

typography:
  ui-body:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: 13px
    fontWeight: 400
    lineHeight: 1.5
  node-title:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: 15px
    fontWeight: 700
    lineHeight: 1.22
  node-body:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: 10px
    fontWeight: 400
    lineHeight: 1.45
  label:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: 9px
    fontWeight: 800
    lineHeight: 1.35
    letterSpacing: 0.09em
  metadata:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
    fontSize: 9px
    fontWeight: 500
    lineHeight: 1.4
  reading:
    fontFamily: "ui-serif, Georgia, Cambria, 'Times New Roman', serif"
    fontSize: 17px
    fontWeight: 400
    lineHeight: 1.78

rounded:
  xs: 4px
  control: 8px
  card: 12px
  panel: 14px
  full: 9999px

spacing:
  xxs: 4px
  xs: 6px
  sm: 8px
  md: 12px
  lg: 16px
  xl: 24px
  xxl: 32px

components:
  canvas-plane:
    backgroundColor: "{colors.canvas}"
  content-node:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.foreground-strong}"
    rounded: "{rounded.card}"
  content-node-selected:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.selection}"
    rounded: "{rounded.card}"
  typed-edge:
    backgroundColor: "{colors.edge}"
    width: 2px
  typed-edge-muted:
    backgroundColor: "{colors.edge-muted}"
    width: 1px
  semantic-region:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.card}"
  semantic-region-fill:
    backgroundColor: "{colors.group-fill}"
    rounded: "{rounded.card}"
  semantic-region-border:
    backgroundColor: "{colors.group-border}"
    height: 1px
  floating-panel:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.panel}"
  control-muted:
    backgroundColor: "{colors.surface-muted}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.control}"
  metadata-muted:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.foreground-muted}"
    typography: "{typography.metadata}"
  focus-context:
    backgroundColor: "{colors.primary-soft}"
    textColor: "{colors.on-primary}"
    rounded: "{rounded.control}"
  hairline:
    backgroundColor: "{colors.border}"
    height: 1px
  hairline-strong:
    backgroundColor: "{colors.border-strong}"
    height: 1px
  button-primary:
    backgroundColor: "{colors.foreground-strong}"
    textColor: "{colors.canvas}"
    rounded: "{rounded.full}"
    height: 40px
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.control}"
  status-success:
    backgroundColor: "{colors.success}"
    textColor: "{colors.canvas}"
    rounded: "{rounded.full}"
  status-warning:
    backgroundColor: "{colors.warning}"
    textColor: "{colors.canvas}"
    rounded: "{rounded.full}"
  status-danger:
    backgroundColor: "{colors.danger}"
    textColor: "{colors.canvas}"
    rounded: "{rounded.full}"
---

# Weaver Semantic Canvas Design System

## Overview

Weaver is not a generic drawing board. It is a semantic knowledge space in
which humans and agents can see, edit, branch, compare, and reorganize the same
typed content graph.

The visual system must make three primitives immediately understandable:

- **Point — Node:** a bounded content object with a semantic type.
- **Line — Edge:** a typed relationship between content objects.
- **Plane — Region:** a spatial boundary that organizes a view without silently
  changing the underlying Graph.

The canvas should feel calm, precise, and alive. The chrome is near-monochrome;
content and state earn color. The result should read as a thinking surface, not
as a dashboard placed behind draggable cards.

### Authority boundary

- Graph content and semantic relationships are authoritative in the Graph.
- Coordinates, dimensions, routing, projection, theme, and viewport belong to
  the current View's `LayoutDocument`.
- Visual changes must not increment `graphRevision`.
- A region becomes semantic only through an explicit Graph operation. Drawing,
  resizing, or moving a visual frame must never imply semantic membership.
- Agents submit semantic intent and validated layout constraints. The
  deterministic layout engine computes final coordinates.

## Design Principles

1. **Content before chrome.** The canvas and controls recede so the knowledge
   structure is the strongest visual signal.
2. **Relationships are content.** Connectors have type, direction, state, and
   labels; they are not decorative strokes.
3. **Space carries meaning, but never silently.** Proximity and regions help
   users read a View, while Graph membership remains explicit and auditable.
4. **One accent, semantic variation.** Blue communicates focus and interaction.
   Additional colors appear only for content type, status, or scene semantics.
5. **Readable at every scale.** Level of detail changes the amount of visible
   information without changing object identity or meaning.
6. **Organic exploration, deterministic result.** Users may drag and pin;
   automated layout remains stable, repeatable, and no-overlap.
7. **Agent proposals stay visibly provisional.** Preview, pending, conflict,
   applied, rejected, and stale states must never look identical.

## Colors

### Canvas and chrome

- `{colors.canvas}` is the infinite working plane.
- `{colors.background}` is the app shell around the plane.
- `{colors.surface}` is used for nodes and floating panels.
- `{colors.surface-muted}` is used for secondary controls and quiet hover fills.
- Borders remain translucent so dense boards do not become a grid of boxes.

### Accent and semantics

- `{colors.primary}` marks focus, active tools, anchored context, and actionable
  links. It is not a decorative fill.
- `{colors.selection}` is reserved for direct selection and resize geometry.
- Success, warning, and danger colors communicate state only.
- Node-type palettes must remain low-saturation. Media is allowed to be the most
  colorful content on the canvas.

### Contrast

- Text and essential controls must meet WCAG AA contrast at their rendered size.
- Edge labels use an opaque or near-opaque canvas chip so paths never reduce
  label legibility.
- A selected object must remain identifiable without relying on color alone.

## Typography

- Human-facing UI and node content use the sans-serif family.
- IDs, revisions, counts, object types, and machine state use the monospace
  metadata style.
- Long-form documents use the reading face only in the document viewer/editor,
  never across compact canvas cards.
- Uppercase labels are short and structural. Do not render prose in uppercase.
- Canvas text must remain legible at 100% zoom; zoomed-out modes reduce content
  before reducing type below a readable threshold.

## Layout and Spatial Rhythm

- Use a 4px base unit and an 8px primary rhythm.
- Default node-to-node spacing must leave room for edge labels and selection
  handles.
- Layout candidates must respect pinned nodes, no-overlap, region confinement,
  and readable edge routing.
- Whitespace is structural. Do not fill empty regions merely to increase visual
  density.
- Floating UI stays at the canvas perimeter and must not obscure the current
  selection or task preview.

## Point — Nodes

### Node anatomy

A content node contains, in order of priority:

1. semantic type or short kicker;
2. title or one-sentence gist;
3. optional summary, preview, or media;
4. compact provenance/status metadata;
5. interaction affordances revealed by focus or selection.

### Node shape

- Rounded rectangles are the default because most Weaver nodes contain text or
  documents.
- Shape must not be the only carrier of semantic type.
- Circular, diamond, pill, or specialized forms are allowed only when the Scene
  Pack defines a stable meaning for them.
- User content and agent proposals must use the same component vocabulary; state
  treatment distinguishes their lifecycle.

### Node states

- **Resting:** hairline border, no attention-seeking glow.
- **Hovered:** slightly stronger border; affordances may appear.
- **Selected:** high-contrast ring plus visible handles when resizable.
- **Focused:** selected or anchored context treatment, depending on host action.
- **Pinned:** visible pin indicator; layout must preserve position.
- **Proposed:** preview treatment that cannot be mistaken for persisted content.
- **Stale/conflicted:** explicit icon and actionable message, not color alone.
- **Dimmed:** reduced emphasis only; text must remain discoverable.

## Line — Typed Edges

### Edge meaning

Every persisted Graph edge has a semantic type. Its rendering may vary by View,
but the View must not invent or remove semantic meaning.

### Edge anatomy

- source attachment;
- routed path;
- optional direction marker;
- relationship label;
- target attachment;
- interaction hit area wider than the visible stroke.

### Routing rules

- Edges bind to node boundaries, never arbitrary nearby pixels.
- Paths must not cross node content or region titles.
- Prefer stable, low-bend routes. Curves are acceptable for organic relationship
  views; orthogonal routing is preferred for process and structured flows.
- Parallel edges require distinguishable routing and labels.
- Self-relations must render as deliberate loops, not routing failures.
- Edge labels sit beside the path on a canvas-colored chip and must not collide
  with nodes, arrowheads, or other labels.

### Edge states

- Incident edges may strengthen when a node is hovered or selected.
- Unrelated edges may mute during focus, but must not disappear if disappearance
  would alter the user's interpretation.
- Proposed edges use a distinct preview pattern such as a dash plus state badge.
- Broken, detached, or invalid endpoints show an actionable error state.

## Plane — Frames, Groups, and Regions

“Plane” is a family of spatial constructs, not one generic rectangle.

### Frame

A titled visual boundary used to compose or present a portion of a View. A frame
may affect layout confinement and export bounds. It does not imply Graph
membership unless an explicit semantic operation says so.

### Interaction group

A temporary or persisted layout grouping that enables joint selection, movement,
or resizing. It belongs to the LayoutDocument.

### Semantic region

A region backed by explicit semantic membership or relationships. Creation and
membership changes require an auditable Graph operation.

### Projection region

A lane, column, row, board column, timeline band, matrix cell, or table section
derived by a View projection. Its structure is computed from Graph data and View
configuration; users must not mistake it for an independent content node.

### Region rules

- Regions render behind nodes and edges.
- Titles remain readable at all supported zoom levels.
- Nested regions need clear containment without multiplying heavy borders.
- Moving a region moves contained objects only when the region's interaction
  model explicitly supports it.
- Resizing a region must not silently delete, reclassify, or absorb nodes.
- Edge routing may cross a region boundary when semantically necessary, but it
  must avoid the title and expose the crossing clearly.

## Selection, Focus, and Context

- Selection means “the user is operating on this object.”
- Focus means “this object is the center of current reading or navigation.”
- Agent context means “this object is included in the next task.”
- These states may overlap but must not be represented by one ambiguous ring.
- Multi-selection shows one collective bounds treatment plus individual object
  membership cues.
- Canvas selection and viewport synchronization do not rotate the Chat/Canvas
  lease or change Graph content.

## Zoom and Level of Detail

### Full

Show title, type, summary/media, provenance, state, edge labels, and relevant
controls.

### Compact

Show type, title, essential state, and important relationship labels. Hide body
previews and secondary metadata.

### Thumbnail

Show stable silhouette, title or short gist, selection/focus, and high-priority
status. Do not shrink full card contents into illegible text.

LOD transitions must be deterministic, reversible, and based on effective zoom.
Selected and focused objects may retain one level more detail than their peers.

## Motion and Feedback

- Motion explains spatial or lifecycle change; it is not ambient decoration.
- Hover and selection transitions should complete in roughly 90–180ms.
- View changes, drawer entrances, and task-preview transitions may take 180–260ms.
- Respect `prefers-reduced-motion`.
- Do not use repeated reloads, delays, or animation to conceal stale state.
- Applying a ChangeSet should make affected objects traceable from preview to
  persisted result.

## Components

### Content node

Use `{components.content-node}`. Node-type variants may change internal anatomy and
a restrained accent, but share selection, resize, error, and proposal behavior.

### Typed edge

Use `{components.typed-edge}` for normal relationships and
`{components.typed-edge-muted}` only for intentionally de-emphasized context.
Visible stroke width and pointer hit width are separate values.

### Semantic region

Use `{components.semantic-region}` as the base. Semantic regions require a clear
title and membership explanation; purely visual frames must not masquerade as
semantic containers.

### Floating controls

Toolbars, minimaps, composers, menus, and task previews use
`{components.floating-panel}`. They should form a small number of coherent islands,
not a ring of unrelated buttons around the canvas.

## Accessibility and Input

- All canvas operations require keyboard-accessible equivalents.
- Focus indicators must remain visible over nodes, media, and the canvas plane.
- Pointer targets are at least 24px for dense controls and preferably 40px for
  primary actions.
- Connector hit areas must be larger than their visible strokes.
- Do not encode node type, edge type, proposal state, or errors by color alone.
- Pan, zoom, selection, drag, resize, and text editing must not compete for the
  same unannounced gesture.

## Do's and Don'ts

### Do

- Keep the canvas dark, quiet, and content-first.
- Treat nodes, edges, and regions as equally deliberate design surfaces.
- Use typed edge labels whenever the relation is not obvious from context.
- Preserve stable visual identity while switching View projections.
- Use deterministic defaults so minimally specified Agent output still produces
  a coherent board.
- Expose Project, View, Session, error code, and revisions in actionable failure
  states.
- Verify light/dark contrast if a future light theme is introduced; do not derive
  it by simple color inversion.

### Don't

- Do not copy Miro's yellow brand, Roobert typography, or marketing-page scale.
- Do not turn every node type into a different saturated color or novelty shape.
- Do not use proximity, containment, or overlap to silently mutate the Graph.
- Do not let connectors run through cards, labels, or region headers.
- Do not make selected, focused, pinned, and Agent-context states look identical.
- Do not store final coordinates authored directly by an Agent without validation.
- Do not increment `graphRevision` for geometry, routing, projection, theme, Pin,
  or viewport changes.
- Do not show infinite Loading when an actionable stale/offline/conflict state is
  known.

## Canvas Acceptance Checklist

- [ ] Point: every node type is legible in resting, hover, selected, focused,
      pinned, proposed, and error states.
- [ ] Line: edge direction, type, label, selection, and proposal state remain
      understandable without relying on color alone.
- [ ] Plane: frames, interaction groups, semantic regions, and projection regions
      are visually distinguishable.
- [ ] No edge label overlaps a node, region title, arrowhead, or another label.
- [ ] No automatic layout overlaps nodes or violates pinned-node constraints.
- [ ] Full, compact, and thumbnail LOD preserve identity and essential state.
- [ ] Graph-only operations increment `graphRevision`; layout-only operations do
      not.
- [ ] Preview, apply, reject, undo, stale, offline, and conflict states are
      visually and behaviorally testable.
- [ ] Keyboard, pointer, zoom, resize, and reduced-motion behavior are verified in
      the real Codex Widget and Claude browser host.
- [ ] Browser console and network logs contain no unexpected errors during the
      verified interaction path.

## Relationship to Product and Engineering Documents

- Product decisions: `docs/PRD-Weaver-Redesign-2026.md`
- Runtime and state authority: `docs/architecture-current.md`
- Required implementation and UI verification process: `WORKFLOW.md`
- Screen-level historical reference: `docs/design/page-designs.md`
- Current dark-canvas visual research: `docs/tapnow-canvas-design.md`

When these documents conflict, follow the repository priority defined in
`AGENTS.md`. This file is the visual and interaction design authority; it does not
override product semantics, state authority, or engineering constraints.
