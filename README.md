# Weaver Next

Weaver Next is a clean rebuild of Weaver as a **branching thinking tool**.

The old product idea was "NotebookLM + infinite canvas". The redesign goes back
to first principles: **thinking is branching** (fork, backtrack, compare, merge,
prune), but linear chat flattens it into a single line — the medium destroys the
shape of thought. Weaver Next makes thinking branch, stay visible, and
crystallize into writing.

- Authoritative product spec: [docs/PRD-Weaver-Redesign-2026.md](docs/PRD-Weaver-Redesign-2026.md) (中文, source of truth)
- Competitive analysis: [docs/competitive-analysis-2026.md](docs/competitive-analysis-2026.md)

## Product Direction

Weaver Next is a "thinking tree" tool:

1. **Think by branching.** Every step is a node (a thought segment + your
   annotation); fork from any node.
2. **The tree lays itself out** — visualization is a by-product of thinking, not
   extra cleanup work.
3. **Each branch carries its own context** — the AI in branch B is not polluted
   by branch A's assumptions.
4. **Crystallize** promising branches into an argument outline (optional).
5. **Draft directly from the tree**, with citations and a chosen voice.

**Primary user:** deep content creators (long-form, newsletter, analysis).
But the tool **does not require sources** — you can branch-think from nothing but
AI + your own ideas. This makes it a general branching-thinking tool, with
writing as its most natural downstream output.

## What We Keep

- Self-hosted, local-first deployment.
- Bring-your-own model provider.
- Source-grounded answers with citations — **when sources exist** (optional).
- Chinese and global workflows.

## What Changed From The Old Direction

- **Not canvas-first.** The core artifact is a branching thinking tree, not a
  free-form canvas (no manual dragging/arranging).
- **Sources are optional** grounding, not a requirement.
- **Argument outline is an optional** crystallization layer, not a mandatory step.
- **Positioning:** "thinking tree / branching thinking tool", not "NotebookLM
  alternative with canvas".

## Core Differentiator

**Per-branch context isolation:** each branch only inherits its ancestor chain.
NotebookLM / YouMind / ChatGPT cannot do this — their "edit message and
regenerate" is an implicit fork that throws away the tree and keeps one polluted
context window. This is an architecture-level moat, not just a UI.

## First Milestone

A local MVP across **3 pages**: Dashboard, Thinking Tree (with optional source
sidebar), Draft. See [docs/rebuild-plan.md](docs/rebuild-plan.md) for the
execution plan.
