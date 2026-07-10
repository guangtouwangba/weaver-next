---
name: weaver-create-space
description: Create a scene-driven Weaver semantic knowledge space from a user's natural-language goal. Use when the user wants to start a brainstorm, vocabulary-learning map, knowledge graph, causal map, timeline, project breakdown, process, or another new Weaver project.
---

# Create Weaver Space

1. Resolve the user's active workspace directory. Never use the plugin repository as the data workspace unless it is the user's intended workspace.
2. Call `weaver_recommend_scene` with the user's goal.
3. Explain the top recommendation and its default view in one sentence. If the user already named a scene, honor it.
4. Call `weaver_create_project` with the confirmed scene pack and the project's automation level.
5. Call `weaver_open_workspace_widget` with the workspace and returned project id.

Each scene semantic type declares `defaultContentKind` and `allowedContentKinds`. The first phase supports `document`, `image`, and `link`; do not represent these content kinds as scene semantic types.

Do not create scene-specific files by hand. Weaver pins the scene version and creates `.weaver/` through MCP.
