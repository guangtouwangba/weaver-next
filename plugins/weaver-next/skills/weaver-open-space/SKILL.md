---
name: weaver-open-space
description: Open or resume the native Weaver semantic canvas for the active project. Use when the user asks to open, show, view, continue, or return to a Weaver space or knowledge graph inside Codex.
---

# Open Weaver Space

1. Resolve the user's active workspace directory.
2. Call `weaver_read_catalog(resource:"project.list")`.
3. If one project clearly matches the request, use it. If none exists, use `weaver-create-space`. If several are ambiguous, ask the user to choose.
4. Call `weaver_open_workspace_widget` with the explicit workspace and project id. This creates or replaces the current Chat's binding; a forked Chat does not inherit it.
5. Restore the current Chat's last active View when its binding is still valid. Otherwise open the Project's default active View. Never choose a View by global recency or another Chat's Canvas state.
6. Use `weaver_read_catalog(resource:"view.list")` when the user asks what Views exist. Historical and unpinned Views remain discoverable through the View Library even when they are not visible in the top switcher.

Do not start a localhost server. Do not inspect or modify `.weaver/weaver.sqlite` directly.
