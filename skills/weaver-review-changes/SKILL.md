---
name: weaver-review-changes
description: Review, explain, apply, reject, or revert pending Weaver graph and layout ChangeSets. Use when the user asks what an agent changed, wants to approve a proposed layout, or wants to undo a Weaver change.
---

# Review Weaver Changes

1. Call `weaver_read_session(resource:"bound_canvas")`, then read the explicit ChangeSet or LayoutRun id from the conversation or widget task. Stop if the current Chat binding is missing, offline, or stale.
2. Load the project manifest and proposed operations through MCP. Use `weaver_preview_changeset` for content and `weaver_get_layout_run` for layout.
3. Summarize content changes separately from layout changes.
4. Highlight archives, type changes, pinned-node movement, hard layout violations, and revision conflicts.
5. Re-read the bound Canvas and AgentTask immediately before applying or rejecting. Apply only after the user's permission level and explicit request allow it.
6. Apply or reject the whole proposal; partial ChangeSet application is not supported in this phase.
7. Use `weaver_apply_changeset` / `weaver_reject_changeset` for content, `weaver_apply_layout` / `weaver_reject_layout` for layout, and `weaver_revert_layout` for layout undo.
8. For `develop_then_layout`, continue the same Task ID after content becomes `ready_to_continue`. Rejecting layout does not roll back accepted content.

Never bypass a pending review by recreating operations through lower-level tools.
View catalog management is not a ChangeSet review surface. Do not trash, restore, purge, rename, pin, or reorder Views on the user's behalf unless the user explicitly requests that direct catalog action; permanent deletion always remains a user-confirmed operation.
