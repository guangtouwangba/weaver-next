---
name: weaver-open-space
description: Open or resume the canonical localhost Weaver Canvas for the active project, preferring the Codex in-app Browser. Use when the user asks to open, show, view, continue, or return to a Weaver space or knowledge graph.
---

# Open Weaver Space

1. Resolve the user's active workspace directory.
2. Call `weaver_read_catalog(resource:"project.list")`.
3. If one project clearly matches the request, use it. If none exists, use `weaver-create-space`. If several are ambiguous, ask the user to choose.
4. Call `weaver_open_space` with the explicit workspace and project id. It ensures the workspace-scoped runtime and returns a short-lived, one-time `launchUrl`; it does not render a native Widget and does not bind the Browser until the URL is consumed.
5. In Codex, use the `browser:control-in-app-browser` capability. Claim and reuse the existing Weaver tab when one is open; otherwise create a new in-app Browser tab. Navigate that tab to `launchUrl`, wait until the URL is nonce-free `/app/`, verify `/api/bootstrap` succeeded and the Canvas toolbar is visible, then make the Browser visible and leave the tab open as the deliverable.
6. In Claude, let the tool's system-browser launch run. If automatic opening fails, return the short-lived link once without logging or persisting it.
7. Restore the current Chat's last active View when its binding is still valid. Otherwise open the Project's default active View. Never choose a View by global recency or another Chat's Canvas state.
8. Use `weaver_read_catalog(resource:"view.list")` when the user asks what Views exist. Historical and unpinned Views remain discoverable through the View Library even when they are not visible in the top switcher.

Do not start an ad-hoc localhost server: `weaver_open_space` owns on-demand supervisor startup and reuse. Never repeat `launchUrl` in assistant prose or diagnostics. Do not inspect or modify `.weaver/weaver.sqlite` directly.
