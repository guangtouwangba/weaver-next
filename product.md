# Weaver Product Vision

## 一句话愿景

Weaver 让人和 AI 在一个可见、可分支、可回溯、可审计的语义空间里共同思考，而不是把复杂思考压缩成一条不断滚动的 Chat 时间线。

## 为什么存在

深度思考天然会岔开：提出多个假设、沿不同方向探索、回到旧节点、比较证据、合并洞察并剪掉死路。线性 Chat 把这些动作混进同一个上下文和滚动历史中，用户看不见探索结构，分支之间也容易互相污染。

传统白板可以画结构，却要求用户在思考之后额外整理；传统笔记可以存内容，却不会主动维护推理上下文；通用 Chat 擅长生成答案，却不擅长保留“我们如何走到这里”。

Weaver 的目的，是让可视化成为思考过程的副产品：用户每次创建节点、建立关系、分叉、回溯或调用 Agent，空间本身就同步长成可继续工作的知识结构。

## 为谁服务

首要用户是需要长期处理复杂材料和观点的人：

- 深度内容创作者、Newsletter 作者和行业研究者。
- 需要比较假设、证据与反例的分析者。
- 用 Codex 完成研究、规划、写作和知识组织的高级用户。

产品不要求用户先有完整素材。用户可以从一个问题或想法开始；当有文档、图片或公共链接时，Weaver 再用它们为节点和结论提供接地证据。

## 核心产品目的

1. **保留思考结构**：让分叉、回溯、比较、汇合和剪枝成为一等操作。
2. **隔离上下文**：不同分支只继承必要的祖先链或场景定义的有界邻域，减少上下文污染。
3. **统一内容、多种视图**：同一语义图谱可投影成 Canvas、Tree、Graph、Flow、Timeline、Board、Matrix 或 Table。
4. **让 AI 成为思考副驾**：AI 提议结构、补充证据、发现缺口和生成可审计变更，但不替用户决定最终观点。
5. **让结构可操作**：用户可以预览、确认、拒绝、撤销和重排 AI 的建议，而不是接受不可解释的整页生成。
6. **从探索走向产物**：空间最终可以结晶为文章、研究报告、计划、SOP、卡片、测验等场景定义的产物。

## 产品模型

### Semantic Graph 是核心工件

- Node 表达概念、问题、证据、人物、步骤、事件等场景语义。
- Edge 表达有类型的关系，而不是只有视觉连线。
- Node 的语义类型与内容形态是两个独立维度；第一阶段内容形态包括 Markdown document、project-local image 和安全 enrichment 的 public link。
- Graph 内容和 View layout 独立版本化。

### View 是投影，不是内容副本

不同 View 回答不同问题：

- Canvas 用于自由组织和发散。
- Tree 用于层级和祖先链。
- Graph 用于关系网络。
- Flow 用于过程与依赖。
- Timeline 用于时间结构。
- Board/Matrix/Table 用于分组、比较和操作性管理。

创建新 View 不复制或改写 Graph。模板是不可变、版本化的纯数据，只定义内容骨架、Projection、LayoutPreset 和 Theme。

### Codex 是语言入口，Widget 是操作界面

- 用户在 Codex Chat 中表达自然语言意图。
- Widget 展示并操作画布、选择、任务状态、ChangeSet 和布局候选。
- MCP 精确绑定 Chat 与 Canvas，提供结构化读写工具。
- Skills 把创建空间、发展内容、布局、审阅和产物生成固化成稳定工作流。

## 产品原则

### 可见而非隐藏

用户应能看见当前 Project、View、Session、任务状态和 revisions。系统不能用无限 Loading、隐式最近焦点或静默覆盖掩盖状态问题。

### 建议而非越权

Agent 提交可检查的意图和变更；高影响写入必须经过预览、确认或明确的工具边界。用户拥有最终结构和观点。

### 本地优先、数据归用户

项目数据存放在 workspace，支持导出和自托管方向。媒体二进制与图谱 JSON 分离，完整内容按需显式读取。

### 可靠性是产品体验

Session 绑定、离线保护、revision 冲突、事件重放、恢复和 undo 不是后台细节，它们决定用户是否敢把真实研究放进 Weaver。

### 复杂能力，克制界面

底层可以有 Graph、Scene Pack、ChangeSet 和 LayoutPlan，但用户看到的应是清晰的节点、关系、视图、状态和下一步行动，不应被内部术语淹没。

## 核心体验循环

1. 用户描述目标或从模板创建空间。
2. Weaver 固定 Scene Pack，并建立语义 Graph 与默认 View。
3. 用户在 Widget 中添加、选择、连接、Pin 或编辑节点。
4. 用户在 Codex 中要求发展内容、研究缺口或调整布局。
5. Agent 基于当前 Canvas 的精确上下文提交 ChangeSet 或 LayoutPlan。
6. Widget 展示实时状态和候选，用户 apply/reject/undo。
7. 空间持续积累，最终结晶为可交付产物。

## 差异化

- 相比通用 Chat：Weaver 保留分支结构，并让上下文按分支或场景隔离。
- 相比 NotebookLM：Weaver 不只回答素材问题，还让论证结构可见、可改、可追。
- 相比通用白板：Weaver 的节点和关系有语义，Agent 能安全读取和操作。
- 相比 Notion/Obsidian：Weaver 不只存储和链接内容，还主动协助形成结构、发现缺口和生成候选。
- 相比纯 AI 生成工具：Weaver 强调可审计变更、确定性布局和用户确认，而不是一次性覆盖结果。

## MVP 边界

MVP 聚焦：

- 本地优先的 typed semantic graph。
- Codex 原生 Widget 与 MCP/Skills 协作。
- 场景包和版本化视觉模板。
- Graph/Layout/View/Binding 独立 revisions。
- Canvas、Tree、Graph、Flow、Timeline、Board、Matrix、Table 投影基础。
- Document、Image、Public Link 三类内容形态。
- ChangeSet 审阅、确定性布局候选、apply/reject/undo。
- Chat/Canvas 精确绑定、Session 隔离和 SSE 恢复。

当前不以在线模板市场、多人实时协作、无限媒体格式、外部 CDN、自动替用户发布内容或通用分布式后端为优先目标。

## 成功标准

产品成功不是“生成了多少节点”，而是用户是否能更清楚地思考并继续工作：

- 用户能快速看懂当前问题的结构、分支、证据和缺口。
- 回到项目时能恢复正确 View、viewport 和任务上下文。
- AI 建议可预览、可追溯、可拒绝，不破坏已有内容。
- 同一 Graph 的不同视图保持一致内容，同时保留独立布局。
- 用户从探索到产物的路径比在线性 Chat 中复制、整理和重写更短。
- 系统在刷新、断线、重复标签和 revision 冲突下仍不丢数据、不串 Chat、不无限 Loading。

## 产品事实源

本文描述稳定愿景和边界。详细需求、阶段优先级和最新交互决策以 [docs/PRD-Weaver-Redesign-2026.md](docs/PRD-Weaver-Redesign-2026.md) 为准；工程架构与 Agent 约束见 [AGENTS.md](AGENTS.md)，开发验收流程见 [WORKFLOW.md](WORKFLOW.md)。
