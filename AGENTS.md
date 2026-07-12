# Weaver Next Agent Guide

本文件是所有开发 Agent 进入仓库后的第一入口。开始工作前必须同时阅读：

- [product.md](product.md)：产品愿景、目标用户、核心问题与产品边界。
- [WORKFLOW.md](WORKFLOW.md)：强制开发流程、TDD 规则和 UI 真实页面验收规则。
- [docs/PRD-Weaver-Redesign-2026.md](docs/PRD-Weaver-Redesign-2026.md)：当前产品需求的详细事实源。
- [docs/architecture-current.md](docs/architecture-current.md)：当前运行时、状态权威与数据兼容架构。

`docs/rebuild-plan.md` 与 `docs/architecture/` 已废弃，只可用于了解早期 tree-first 重建背景，不得作为当前需求、架构或里程碑依据。

若现行文档互相冲突，优先级为：最新 PRD 明确决策 > 本文件的工程约束 > `WORKFLOW.md` 的执行流程。发现冲突时不要静默猜测，应在实现说明中指出并修正文档。

## 项目是什么

Weaver 是一个以 Codex 插件为正式入口的、场景驱动的语义知识空间。底层核心工件是带类型的 Node/Edge 图谱；自由画布、树、关系图、流程、时间线、看板、矩阵和表格只是同一内容图谱的独立投影。

用户在 Widget 中编辑、选择和组织内容，在 Codex Chat 中表达自然语言意图。Agent 读取当前 Chat 精确绑定的 Canvas 上下文，提交可审计的 `GraphOperation`、`ChangeSet` 或语义化 `LayoutPlan`；确定性布局引擎负责最终坐标，Widget 负责预览、确认、撤销和实时反馈。

## 核心设计

### 1. 内容和呈现严格分离

- Graph 是内容权威，内容变更只递增 `graphRevision`。
- 每个 View 有独立 `LayoutDocument` 和 `layoutRevision`。
- 坐标、尺寸、Pin、路由、Projection、Theme 和 viewport 相关操作不得递增 `graphRevision`。
- View 目录元数据使用 `viewCatalogRevision`；Chat/Canvas 租约切换使用 `bindingRevision`。
- 同一 Graph 可有多个 View；应用模板到已有项目只能创建 View，不得静默插入内容节点。

### 2. Agent 提交意图，系统计算结果

- Coding Agent 可以生成语义 Graph 操作、ChangeSet 和 LayoutPlan 约束。
- Agent 不得直接修改 SQLite，不得绕过 ChangeSet 审计，不得发明未经校验的最终坐标。
- 最终坐标由确定性布局引擎计算、评分并生成候选。
- pinned node、no-overlap、project path confinement、preview、apply/reject、undo 是约束，不是建议。

### 3. Chat 与 Canvas 精确绑定

- 一个 Codex Chat 同一时间只允许一个可写 Canvas Session。
- `threadId` 只在 MCP Server 内哈希为 `chatSessionKey`，不得存储或输出原始 Chat 标识。
- selection、viewport、focused node、Pin 和 presence 同步不旋转租约。
- Project/View 显式切换递增 binding revision，并使旧 Session 失效。
- AgentTask 必须绑定当前在线 Session；离线、opening、duplicate、detached 或 stale Session 均不得继续写入。
- 项目级 Graph/Layout 事件广播到相关 Session；Task 与 binding 事件按 Session 隔离。

### 4. 本地优先与可恢复

- 项目数据保存在 `<workspace>/.weaver/`，SQLite 是权威状态。
- MCP 通过 stdio 提供结构化工具，通过带随机令牌的 loopback HTTP 提供 Widget 静态资源和 SSE。
- Widget 必须能通过 revision 核对恢复遗漏事件，不能依赖旧页面收到完整历史广播。
- viewport 恢复失败不能阻止 Session 激活；应降级为 Fit All 并给出可见警告。
- 优先保持简单的 local-first 架构，不为未来假设提前引入分布式系统。

### 5. 场景化上下文

- Scene Pack 固定节点类型、关系类型、上下文策略、推荐视图、Agent actions 和产物类型。
- branching/argument 场景保留 `ancestor_path` 隔离；其他场景使用有界的类型邻域与用户 Pin。
- 默认不得把整个 Graph 无边界塞入模型上下文。

## 运行时架构

```mermaid
flowchart LR
  User["User"] --> Widget["Codex Widget / Browser Preview"]
  User --> Chat["Codex Chat"]
  Widget -->|"MCP app tools"| MCP["Local MCP Server"]
  Chat -->|"MCP tools + Skills"| MCP
  MCP --> Contracts["Contracts + Core policies"]
  MCP --> Storage["WorkspaceStore / SQLite"]
  MCP --> Layout["Deterministic Layout Engine"]
  Storage --> Data["<workspace>/.weaver/"]
  MCP -->|"tokenized static assets + SSE"| Widget
  Layout -->|"candidates + metrics"| MCP
```

关键数据流：

1. Widget 加载 Project/Graph/Layout，并先 claim Canvas Session。
2. Session 激活后异步恢复 viewport，再发送完整 state snapshot。
3. Widget 将 selection、focused node、Pin、viewport 和 revisions 同步到 MCP。
4. Codex 根据当前 Chat binding 准备并执行 AgentTask。
5. 内容写入经过 ChangeSet；布局写入经过 LayoutPlan/validated layout operations。
6. SQLite 事务写入状态和 ProjectEvent；SSE 推送增量。
7. Widget 幂等应用 delta，序列缺口或 revision 落后时重新读取权威 Graph/Layout。

## 目录地图

| 路径 | 职责 |
|---|---|
| `apps/widget/` | 正式 Codex Widget 与 localhost 开发预览；React、React Flow、Vite。 |
| `apps/widget/src/hooks/` | Bootstrap、Canvas 状态、绑定同步、SSE、文档编辑和 View 管理等前端领域逻辑。 |
| `apps/widget/src/components/` | Canvas、节点、边、导航、编辑器和任务预览 UI。 |
| `apps/widget/src/__tests__/` | Widget 纯逻辑与交互相关回归测试。 |
| `packages/contracts/` | Zod schema、共享类型、错误和 API contract；跨层数据的唯一结构定义。 |
| `packages/core/` | 无 IO 的 Graph、LayoutOperation、上下文策略等纯领域逻辑。 |
| `packages/layout-engine/` | 确定性布局、候选生成、连线路由和质量评分。 |
| `packages/storage/` | `WorkspaceStore`、SQLite schema/事务、Graph/Layout/View/Task/事件持久化。 |
| `packages/mcp/` | stdio MCP Server、Tools、Resources、Chat identity、SSE 与 loopback 静态资源。 |
| `packages/scene-packs/` | 内置场景包及上下文/动作规则。 |
| `packages/visual-templates/` | 不可变、版本化的结构化视觉模板目录。 |
| `skills/` | 面向 Coding Agent 的稳定 Weaver 工作流。 |
| `scripts/` | MCP 启动、开发入口、探针和 benchmark。 |
| `docs/` | PRD、架构、设计和实施计划。 |
| `.codex-plugin/` | Codex 插件 manifest 和安装配置。 |
| `.weaver/` | 当前 workspace 的本地运行数据；不要手工编辑或提交业务状态。 |

## 工程边界

- 不要整体搬运旧 Weaver 模块；只有符合当前 branching/semantic-space loop 时才可复用，并记录原因。
- Schema 变更必须保持 legacy 数据可读；能用默认值兼容时不做无意义迁移。
- 所有写路径必须验证 Project/View/Session/revision 边界。
- 布局操作必须保持 `graphRevision` 不变。
- 文件和 Asset 必须限制在 project/workspace 路径内；禁止把任意本地路径暴露给 Widget 或模型。
- Widget 有三种宿主：`codex`（Apps-SDK iframe）、`claude`（Claude Code 终端 + 独立浏览器预览，通过 loopback `/preview` + `/mcp-rpc`，是完整绑定的 agent 宿主）、`dev`（Vite localhost 只读预览）。仅 `dev` 与 `?demo=1` 必须显示 `Browser preview. Agent unavailable`；`claude` 宿主与 Codex 一样 agent-eligible。宿主判定见 `apps/widget/src/lib/host-mode.ts`。
- Claude 宿主由 `scripts/start-mcp-claude.mjs`（`WEAVER_HOST_KIND=claude`）启动，与 Codex 共用同一 store/binding，靠进程级合成 `chatSessionKey`（`packages/mcp/src/session-identity.ts`）让 stdio（Claude）与 loopback（浏览器）收敛到同一绑定。`.mcp.json` 保持 Codex 干净，不要写入 `WEAVER_HOST_KIND`。
- loopback `/mcp-rpc`/`/api/bootstrap`/`/preview` 只绑本机、带 token、workspace 钉死、工具白名单、最小 CSP；身份从进程推导，从不取自请求。
- Localhost browser preview（dev）不得启动 AgentTask，必须清楚显示 `Browser preview. Agent unavailable`。
- Widget、插件和 MCP Server 必须校验 build/version；开发态使用 workspace build，安装态使用插件缓存。
- 开发态下 Claude 宿主的 MCP 进程会**按需重读 widget dist**并在重建时通过 SSE `widget.reload` 让浏览器自动刷新（`SseEventHub` 的 bundle 注册表按 buildId 服务，杜绝 HTML/资源 buildId 错配的白屏）。因此**只改 widget 前端 → 刷新/自动刷新浏览器即可**，无需重启 MCP。
- **改 MCP/contracts/scene-packs 等服务端代码后仍必须重启对应 MCP/Vite 进程**（运行中进程加载的是旧服务端代码），再做真实页面验收，避免用旧 schema/逻辑得出错误结论。

## 开发与验收

所有变更必须遵循 [WORKFLOW.md](WORKFLOW.md)。最重要的完成标准：

- 使用 TDD：先写会失败的测试，再实现，再重构。
- Frontend/package 测试放在对应 `__tests__/`。
- 至少运行与改动直接相关的 typecheck/test；跨包协议、Storage、MCP 或发布链路改动运行完整回归。
- 任何 UI 行为、样式、响应式、交互、加载态或浏览器生命周期变更，都必须在真实本地页面完成点击/输入/刷新验证。
- UI 任务只有单元测试通过不算完成；最终报告必须写明实际操作路径、观察到的 DOM/视觉结果以及浏览器控制台错误情况。

常用命令：

```bash
npm install
npm --workspace @weaver/widget run dev
npm run typecheck:widget
npm run build:plugin
npm run test
node scripts/probe-mcp.mjs
```

## 修改策略

- 工作区可能存在用户未提交改动；只修改当前任务需要的文件，不覆盖、不回滚无关变化。
- 优先小步、可验证、可回滚的改动。
- 修复根因，不用延时、重复 reload 或吞掉异常掩盖状态机问题。
- 状态栏和错误页应暴露可行动信息：Project、View、Session、错误码和 revisions，而不是无限 Loading。
- 完成后更新受影响文档；若实现改变了产品边界，同时更新 `product.md` 和 PRD。
