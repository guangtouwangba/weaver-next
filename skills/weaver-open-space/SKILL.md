---
name: weaver-open-space
description: Open or resume the native Weaver semantic canvas for the active project. Use when the user asks to open, show, view, continue, or return to a Weaver space or knowledge graph inside Codex.
---

# Open Weaver Space

1. Resolve the user's active workspace directory.
2. Call `weaver_list_projects`.
3. If one project clearly matches the request, use it. If none exists, use `weaver-create-space`. If several are ambiguous, ask the user to choose.
4. Call `weaver_open_workspace_widget` with the explicit workspace and project id.

Do not start a localhost server. Do not inspect or modify `.weaver/weaver.sqlite` directly.
