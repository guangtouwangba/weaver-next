---
name: weaver-create-space
description: Create a scene-driven Weaver space from a natural-language goal or structured visual template. Use when the user wants to start a brainstorm, mind map, knowledge network, flow, timeline, board, matrix, table, project breakdown, or another new Weaver project.
---

# Create Weaver Space

1. Resolve the user's active workspace directory. Never use the plugin repository as the data workspace unless it is the user's intended workspace.
2. Choose the Scene Pack yourself from the user's goal — there is no recommender tool. Match the strongest signal in the goal to a built-in scene `id` (all pinned at version `1.0.0`):
   - 词汇 / 单词 / vocab / word → `situational-vocabulary`
   - 因果 / 机制 / 反馈 / cause / causal → `causal-map`
   - 时间线 / 历史 / 事件 / timeline / chronology → `event-timeline`
   - 项目 / 里程碑 / 任务 / project / milestone → `project-breakdown`
   - 流程 / 步骤 / SOP / flow / process → `process-design`
   - 拆解 / 子问题 / 假设 / decompose → `problem-decomposition`
   - 决策 / 方案对比 / 权衡 / decision / compare options → `decision-comparison`
   - 论证 / 主张 / 证据 / argument / claim → `argument-map`
   - 概念 / 定义 / 前置知识 / concept learning → `concept-learning`
   - 学习路径 / 课程 / 阶段 / learning path / curriculum → `learning-path`
   - 实体关系 / 属性 / 知识图谱 / entity-relationship → `entity-relationship`
   - 人物 / 组织 / 角色 / 合作网络 / people / org network → `people-organization-network`
   - otherwise, or a free open-ended brainstorm → `free-brainstorming` (the default).
   Honor any scene the user names explicitly.
3. Optionally pick a structured VisualTemplate. Read `weaver_read_catalog(resource:"template.list", scenePackId:<chosen scene>, family:<family>)` — never invent a template id. Map the goal's requested visual form to a template `family`, then choose the first listed template compatible with the scene:
   - 时间 / 路线图 / timeline / roadmap → `temporal`
   - 流程 / 因果 / flow / cause → `flow`
   - 看板 / 泳道 / kanban / lane → `board`
   - 矩阵 / 象限 / SWOT / matrix → `matrix`
   - 表格 / 对比 / table / compare → `table`
   - 树 / 思维导图 / tree / mind map → `hierarchy`
   - 关系 / 网络 / relation / network → `relationship`
   - otherwise a free canvas → `canvas`.
   If no template fits or the user only wants a plain space, skip the template. State the chosen Scene Pack (and VisualTemplate, if any) in one sentence before creating.
4. Call `weaver_create_project`. When a visual template is selected, pass `template:{templateId, version}` to create the project, starter content graph, and themed default view from it; otherwise omit `template` for a plain scene-seeded project.
5. Creation atomically creates the first `ProjectView`, sets it as the Project default, and binds it to the current Codex Chat. Call `weaver_open_workspace_widget` with the workspace and returned project id to mount the Canvas and activate its independent Canvas Session.

Each scene semantic type declares `defaultContentKind` and `allowedContentKinds`. The first phase supports `document`, `image`, and `link`; do not represent these content kinds as scene semantic types.

Do not create scene-specific files by hand. Weaver pins the scene version and creates `.weaver/` through MCP.
Templates are immutable data. Never invent a template id, execute template-provided code, or silently add content to an existing project.
Creating a new Project from a template creates exactly one initial View. Do not create a second View as a follow-up unless the user asks for another projection.
