---
version: alpha
name: TapNow Canvas
description: >-
  Design system reverse-engineered from app.tapnow.ai (Home + a live creative
  canvas), captured 2026-07-11. Colors, radius and font family are extracted
  from runtime CSS variables (exact). Spacing and some type sizes are visual
  estimates from 2x screenshots (marked ~). A dark, cinematic, content-first
  agentic creation canvas: near-monochrome chrome so colorful AI media is the
  only focal color.
colors:
  # Surfaces (dark app theme — what the canvas actually renders)
  background: "#0f0f0f"          # app shell
  canvas: "#0a0a0a"              # infinite canvas plane
  surface: "#1f1f1f"             # cards, panels
  surface-muted: "#2b2b2b"       # subtle fills
  surface-accent: "#404040"      # raised / hover fills
  # Foreground
  foreground: "#f5f5f5"          # primary text
  foreground-strong: "#fafafa"   # on-card text
  foreground-muted: "#7a7a7a"    # secondary text
  # Brand / interactive (single accent hue)
  primary: "#1fa2dc"
  primary-bright: "#33a8ff"
  primary-soft: "#90c4e5"
  on-primary: "#fafafa"
  # Lines
  border: "rgba(255,255,255,0.1)"        # thin translucent hairline
  border-selected: "#ffffff"             # selected node/element ring
  edge: "rgba(255,255,255,0.376)"        # graph connector stroke
  # Status
  success: "#4caf50"
  warning: "#ff9800"
  error: "#f44336"
  info: "#2196f3"
  # Light "tap" brand set (marketing / light surfaces — defined but not used in-app)
  brand-bg: "#e9f0f5"
  brand-blue: "#33a8ff"
  brand-pink: "#e896c9"
  brand-red: "#db5a4d"
typography:
  body:
    fontFamily: "Inter, -apple-system, system-ui, 'Segoe UI', sans-serif"
    fontSize: 16px
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: 0em
  heading:                       # ~ estimated from screenshots
    fontFamily: "{typography.body.fontFamily}"
    fontSize: 28px
    fontWeight: 700
    lineHeight: 1.25
    letterSpacing: -0.01em
  label:                         # ~ node type labels / captions
    fontFamily: "{typography.body.fontFamily}"
    fontSize: 12px
    fontWeight: 500
    lineHeight: 1.35
    letterSpacing: 0em
rounded:
  sm: 8px
  md: 12px                       # --radius 0.75rem, base for cards/nodes
  lg: 16px
  full: 9999px                   # pills, circular buttons
spacing:                         # ~ observed 4px-based scale, not measured exactly
  xs: 4px
  sm: 8px
  md: 12px
  lg: 16px
  xl: 24px
components:
  # Right-side agent chat panel (fixed ~1/3 width)
  agent-panel:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    width: 33%
  # Suggestion card inside the agent panel
  suggestion-card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.foreground-strong}"
    rounded: "{rounded.md}"
    padding: 16px
  # Chat / prompt input row (Home composer + canvas chat share this shape)
  chat-input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.md}"
    padding: 16px
  # A canvas node: type-label row + 16:9 media thumbnail (SVG-rendered)
  node-card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.foreground-muted}"
    rounded: "{rounded.sm}"
  node-card-selected:
    border: "{colors.border-selected}"
  # Faint bezier connector between nodes
  node-edge:
    color: "{colors.edge}"
    width: 2px
  # Floating vertical tool rail on the canvas left edge
  tool-rail:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.full}"
  tool-rail-button:
    textColor: "{colors.foreground}"
    rounded: "{rounded.full}"
    size: 44px
  # Circular primary action (send, add)
  button-primary:
    backgroundColor: "{colors.foreground-strong}"
    textColor: "{colors.background}"
    rounded: "{rounded.full}"
    size: 44px
  # Status / credits pill
  pill:
    backgroundColor: "{colors.surface-muted}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.full}"
    padding: 8px
  # Status badge on a node (blue check = confirmed, red text = limited)
  badge-confirmed:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
  badge-error:
    textColor: "{colors.error}"
---

# TapNow Canvas — DESIGN.md

## Overview

TapNow (`app.tapnow.ai`) is an **agentic creative canvas**: a two-pane workspace
where a right-side AI chat drives generation and a left-side infinite canvas holds
the visual output as a node graph. The design intent is **content-first**: the UI
is deliberately near-monochrome (a three-step grey ramp plus a single blue accent)
so the colorful AI-generated images and videos on the canvas are the only source
of color and the true focal point.

Captured from a logged-in account on 2026-07-11 across Home (`/home`) and one real
canvas (`/canvas/{id}`). Color, radius and font tokens are pulled from runtime CSS
custom properties; spacing and a couple of type sizes are visual estimates (`~`).

Global structure: top nav (`Logo · Home · Workspace · TapTV · Arena … Pricing ·
Notifications · Avatar`) → Home is a centered prompt composer + project cards +
featured banners → Canvas is the split-screen workspace detailed below.

## Colors

The app runs a **shadcn-style dark theme**. Surfaces climb a tight grey ramp —
`{colors.canvas}` → `{colors.background}` → `{colors.surface}` →
`{colors.surface-muted}` → `{colors.surface-accent}` — and a **single blue hue**
(`{colors.primary}` / `{colors.primary-bright}`) carries all brand and interactive
meaning. Text is a 3-level ramp: `{colors.foreground}`, `{colors.foreground-strong}`
(on cards), `{colors.foreground-muted}` (secondary).

Lines are intentionally low-contrast: hairline borders are
`{colors.border}` (white at 10%), and graph connectors are `{colors.edge}`
(white at ~38%, 2px) so wiring recedes behind the media. Selection is a solid
white ring (`{colors.border-selected}`).

Status colors (`{colors.success}` / `{colors.warning}` / `{colors.error}` /
`{colors.info}`) are a standard Material-ish set shared across themes.

Note: the site also ships a **second, unused light "tap" brand palette**
(`{colors.brand-bg}`, `{colors.brand-blue}`, sky/water gradients) for marketing
surfaces. The in-app canvas never renders it.

## Typography

One typeface: **Inter** with a system fallback stack (`{typography.body}`). Body is
16px/1.5. Headings like the canvas greeting ("今天一起创作点什么？") are large and
bold (`{typography.heading}`, ~28px/700); node type labels and captions are small
and medium-weight (`{typography.label}`, ~12px). UI is bilingual, following the
account language.

## Layout

Canvas is a **split screen**: left ~2/3 infinite canvas, right ~1/3 fixed agent
panel (`{components.agent-panel}`).

- **Canvas plane** (`{colors.canvas}`): dotted grid, pannable/zoomable, with a
  bottom-left control cluster (minimap · grid toggle · recenter · zoom slider ·
  help) and a "back to nodes" pill when the viewport is empty.
- **Floating tool rail** (`{components.tool-rail}`): a vertical pill hugging the
  left edge — add(+) · search · library · structure · chat · history · avatar.
- **Top bar**: project title + "saved to cloud" status (left); credits pill,
  Community, Share (right).
- **Agent panel** (right): "Hi {user}! What shall we create today?" greeting, a
  two-column grid of `{components.suggestion-card}` (refreshable), and a
  `{components.chat-input}` with inline `/ skills`, `@ references/plugins`, model
  switch, mic, and a circular send button.

## Elevation & Depth

Depth is expressed by **layering translucent chrome over the canvas**, not by heavy
shadows. Control clusters and the tool rail float as rounded, semi-transparent
surfaces above the plane; separation comes from the `{colors.border}` hairline and
the surface grey-ramp rather than drop shadows. This keeps the media plane visually
dominant.

## Shapes

Rounded and soft throughout. Base radius is `{rounded.md}` (12px, `--radius:
0.75rem`) for cards, panels, nodes and inputs. Pills and primary actions go
`{rounded.full}`: status/credits pills, the tool rail, and **circular** buttons for
the two primary actions (add `+`, send `↑`). Node thumbnails are a fixed 16:9.

## Components

- **`node-card`** — the atomic canvas unit: a type-label row (icon + "图片生成" /
  "Video") above a 16:9 media thumbnail. SVG-rendered (nodes are `<g>` elements,
  connectors are SVG paths). Generating states show an empty dark rectangle;
  status is a small badge — `{components.badge-confirmed}` (blue check) or
  `{components.badge-error}` (red "规格受限" text) — never a heavy card outline.
  Selected: `{components.node-card-selected}` white ring.
- **`node-edge`** — faint white bezier curve linking nodes (`{colors.edge}`, 2px).
- **`tool-rail` / `tool-rail-button`** — floating vertical pill of circular icon
  buttons. The `+` enters an "add from canvas" reference mode ("click a node to add
  as a reference"), pulling canvas nodes back into the chat as context.
- **`chat-input`** — one row absorbs all capability selection: free text, `/`
  skills, `@` references/plugins, a `Manual confirm` mode toggle, model picker
  (Kimi 2.6), mic, and circular send.
- **`suggestion-card`** — icon + title + muted description; two-up grid;
  dynamically refreshed.
- **`button-primary`** — circular, near-white fill on dark, for send/add.
- **`pill`** — status/credits/nav chips, fully rounded.

## Do's and Don'ts

- **Do** keep chrome near-monochrome and let generated media supply all color.
- **Do** use exactly one accent hue (`{colors.primary}`) for every interactive and
  brand affordance.
- **Do** render connectors and borders at very low contrast so structure recedes.
- **Do** float glassy, rounded control clusters over the canvas instead of docking
  heavy toolbars.
- **Don't** add drop shadows or thick outlines to nodes; express state with small
  badges and a white selection ring.
- **Don't** scatter capabilities across a toolbar — fold skills, references, model
  and mode into the single chat input row.
- **Don't** mix in the light "tap" brand palette inside the app; it is marketing-only.

---

## Appendix — Contrast with Weaver

Two ideological differences worth flagging for our own canvas:

1. **Theme direction.** TapNow commits to **dark, media-first** (`#0a0a0a` plane,
   grey chrome, one blue accent). Weaver is currently **light warm** (`#f2f3ed`
   plane, `#315cf6` accent). If Weaver wants generated media to dominate, a dark
   monochrome surface is the proven move here.
2. **Chat placement.** TapNow **embeds the chat panel directly in the canvas**
   (right pane). Weaver's PRD deliberately does **not** embed a chat box — natural
   language stays in Codex, the widget only tracks selection/context. That is the
   core divergence; removing the in-canvas `FollowUpComposer` earlier was defending
   exactly this line.

## Appendix — Capture Evidence

Screenshots live in this session's scratchpad (temp, not committed): `01-home.png`,
`02-canvas.png`, `03-canvas-nodes.png` / `06-node-zoom.png`, `04-add-menu.png`,
`05-node-selected.png`. Copy the key frames into `docs/assets/` if long-term
retention is wanted.
