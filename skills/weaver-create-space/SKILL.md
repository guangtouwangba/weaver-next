---
name: weaver-create-space
description: Create a scene-driven Weaver space from a natural-language goal or structured visual template. Use when the user wants to start a brainstorm, mind map, knowledge network, flow, timeline, board, matrix, table, project breakdown, or another new Weaver project.
---

# Create Weaver Space

1. Resolve the user's active workspace directory. Never use the plugin repository as the data workspace unless it is the user's intended workspace.
2. Call `weaver_recommend_scene` and `weaver_recommend_visual_templates` with the user's goal.
3. Explain the top Scene Pack and VisualTemplate recommendation in one sentence. Honor explicit choices.
4. Call `weaver_create_project`. When a visual template is selected, pass `template:{templateId, version}` to create the project, starter content graph, and themed default view from it; otherwise omit `template` for a plain scene-seeded project.
5. Creation atomically creates the first `ProjectView`, sets it as the Project default, and binds it to the current Codex Chat. Call `weaver_open_workspace_widget` with the workspace and returned project id to mount the Canvas and activate its independent Canvas Session.

Each scene semantic type declares `defaultContentKind` and `allowedContentKinds`. The first phase supports `document`, `image`, and `link`; do not represent these content kinds as scene semantic types.

Do not create scene-specific files by hand. Weaver pins the scene version and creates `.weaver/` through MCP.
Templates are immutable data. Never invent a template id, execute template-provided code, or silently add content to an existing project.
Creating a new Project from a template creates exactly one initial View. Do not create a second View as a follow-up unless the user asks for another projection.
