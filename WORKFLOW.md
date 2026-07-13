# Weaver Development Workflow

本文定义 Weaver 的强制开发工作流。目标不是“代码能编译”，而是用可重复证据证明行为正确，并避免 Graph/Layout、Chat/Canvas 和浏览器/MCP 多运行时之间的回归。

## 1. 开始前

1. 阅读 [AGENTS.md](AGENTS.md)、[product.md](product.md) 和任务相关 PRD/architecture 文档。
2. 检查 `git status`，识别用户已有改动；不得覆盖或清理无关内容。
3. 明确本次变更属于哪些边界：Canvas、Contracts、Core、Storage、Workspace Service、Supervisor、MCP Bridge、Layout Engine、Plugin packaging。
4. 写出可验证的验收条件，至少包含正常路径、失败路径和 revision/持久化影响。
5. 若问题来自 UI，先在真实页面复现并记录：操作步骤、当前 DOM/视觉状态、错误信息、相关网络/console 信号。

## 2. TDD：Red → Green → Refactor

所有缺陷修复和可测试功能默认按 TDD 开发。

### Red：先证明问题存在

- 在最接近行为所有者的层级增加最小失败测试。
- 纯领域规则测试放在 `packages/*/__tests__/` 或 Canvas 的 `src/__tests__/`（迁移期路径仍为 `apps/widget/src/__tests__/`）。
- Storage 测试要验证事务结果和 revisions，不只验证返回值。
- MCP 测试要验证 Tool 的结构化输出、错误码、Session/Chat 隔离和事件可见性。
- UI 问题先保留真实页面复现证据，再为可抽离逻辑增加测试；不要用脆弱快照代替行为断言。
- 运行测试并确认它因预期原因失败，而不是因为环境、fixture 或语法错误失败。

### Green：实现最小正确变更

- 只实现让验收条件成立的最小改动。
- 不绕过 schema、revision、lease、ChangeSet 或 path confinement。
- 不用固定 sleep、无限重试、静默 catch 或整页 reload 掩盖竞态。
- 跨层数据先修改 `packages/contracts`，再更新生产者、消费者和 legacy 默认值。
- 修改 Layout/Theme/viewport 时显式确认 `graphRevision` 未变化。

### Refactor：消除偶然复杂度

- 测试保持绿色后再整理命名、拆分 hook/module、去重和收紧类型。
- 保持 Core 纯函数化，把 IO、身份和持久化留在 Storage/MCP 边界。
- 检查是否存在 stale closure、旧 revision、并发写入、重复 Session 或旧 MCP 进程等多运行时问题。
- 重跑相关测试，确认重构没有改变外部行为。

## 3. 测试分层

按风险逐层扩大，不用完整测试替代针对性测试。

### A. 针对性测试

每次改动首先运行最接近代码的测试，例如：

```bash
npm run test:ts -- --run apps/widget/src/__tests__/canvas-theme-and-edges.test.ts
npm run test:ts -- --run packages/storage/__tests__/workspace-store.test.ts
```

### B. 静态检查与构建

```bash
npm run typecheck:widget
npm run build:packages
npm run build:widget
```

### C. 完整回归

以下情况必须执行 `npm test`：

- Contracts、Storage schema 或事务变化。
- MCP Tool、Chat binding、Canvas Session、SSE 或事件过滤变化。
- Graph/Layout revision 规则变化。
- 跨两个以上 workspace package 的改动。
- 插件发布、安装或开发启动链路变化。

仓库不再包含 Python API；`npm test` 仅运行正式 TypeScript/Widget/MCP/Storage 测试链。

## 4. UI 改动的真实页面验收

任何用户可见改动都必须执行本节，包括颜色、Theme、间距、响应式、按钮、表单、拖拽、缩放、Selection、Loading、错误态、SSE 重连和 viewport 恢复。

### 强制规则

- 单元测试、DOM snapshot 和构建成功都不能单独证明 UI 完成。
- 必须启动真实本地页面，并使用浏览器实际点击、输入、拖动、缩放、刷新或切换可见性。
- 优先复用用户当前打开的 localhost 页面；不要无必要创建重复标签。
- 每次交互后检查一个权威信号：可访问名称、`data-*` 状态、实际 style、可见文本、revision 状态或明确的成功/错误提示。
- 对切换类功能至少验证一个完整往返，例如 light → dark → light，而不是只验证第一次点击。
- 对持久化功能必须刷新页面后再次验证。
- 对响应式改动至少验证目标断点两侧。
- 检查浏览器 console error；已有无关错误要说明，新错误必须修复。

### UI 验收步骤

1. 启动或确认迁移期 Canvas 开发服务：

   ```bash
   npm --workspace @weaver/widget run dev
   ```

2. 若修改过 Contracts、MCP 或插件资源，先重建并重启 Vite/MCP 子进程。热更新前端代码不代表 Node 子进程已加载新 schema。
3. 在目标 Project URL 打开/复用页面，等待权威数据加载完成。
4. 按验收条件执行真实交互。
5. 读取最小必要 DOM/视觉状态确认结果；视觉问题使用截图辅助，但截图不能替代状态断言。
6. 刷新后复验持久化和恢复行为。
7. 在最终报告中记录：
   - 测试 URL/Project。
   - 实际点击或输入步骤。
   - 每一步观察到的结果。
   - 页面刷新后的结果。
   - console/network 是否出现新错误。

### UI 任务完成门槛

满足以下全部条件才可声明完成：

- 相关自动化测试通过。
- Canvas typecheck/build 通过。
- 真实页面操作通过。
- 目标状态与服务端持久化一致。
- 页面刷新/恢复后仍正确。
- 没有新增 console error。

## 5. MCP、插件与多进程验证

localhost runtime 迁移的目标边界以 `docs/localhost-canvas-runtime-prd.md` 为准：生产与 E2E 必须使用同一个 workspace supervisor/worker Canvas；MCP 只作为 Chat bridge。迁移期保留的 Apps-SDK Widget 只允许用于回滚，不得承载 localhost 路径没有的新功能。

- 修改 workspace service/supervisor/Contracts 后必须重启或升级 worker；只重启 Chat 的 MCP bridge 不代表新服务端代码已加载。
- `weaver_open_space` 的完成证据包括 runtime health、pairing 领取和 Canvas bootstrap；仅返回 URL 或启动进程不算打开成功。
- 核心 PR E2E 必须使用真实 application RPC、SSE 和 SQLite，覆盖刷新、Chat 断开、重复标签接管、worker kill/restart 和 revision gap recovery。
- Codex 右侧内置浏览器与 Claude 只做相同 localhost 应用的容器 smoke，不得各自保留业务分叉。
- runtime/build/protocol 不一致时 fail closed，完成受控 worker 升级后才能恢复写入。

- `apps/widget/vite.config.ts` 会懒启动 MCP 子进程；修改 MCP/Contracts 后必须重启 Vite 才能获得新进程。
- Claude 宿主(`scripts/start-mcp-claude.mjs`)开发态会按需重读 widget dist 并在重建时经 SSE `widget.reload` 自动刷新浏览器：**只改 widget 前端时 `npm run build:widget` 后浏览器自动刷新即可，不必重启 MCP**；改服务端(MCP/Contracts/scene-packs)仍必须重启 MCP。
- 安装态验证前运行 `npm run build:plugin`，再刷新本地插件缓存。
- 区分“已安装”和“当前 Codex Chat 已加载”。当前 Chat 已启动的 MCP 进程不会因覆盖缓存自动热更新；需要重启或新建 Chat。
- 校验 workspace build、Widget build ID、MCP Server 版本和插件缓存是否一致。
- loopback 端点必须只绑定本机、只读、带 token，并保持 CSP 最小开放。

### 5.0 两个宿主跑的是不同副本（改代码为什么“没生效”）

以下是迁移完成前的 legacy 现实：**Claude 和 Codex 可能运行不同缓存副本**。目标 runtime 落地后由 `~/.weaver/runtimes/<buildId>/` 的不可变构建和 supervisor 受控升级取代此差异。

- **Claude 预览宿主**：`scripts/start-mcp-claude.mjs` 直接从**仓库**跑，`cwd = 仓库根`。所以仓库里 `npm run build:plugin` + 在 Claude 里重连 `weaver-preview` 就能拿到新代码。
- **Codex**：`weaver_mcp` 由 Codex 从**本地 marketplace 安装的缓存副本**跑，链路是三跳：

  ```
  仓库 /Users/kids/Documents/weaver-next        ← 你在这里改 / build
    ↓ 需要“发布”
  marketplace /Users/kids/.agents/weaver-marketplace   ← Codex 的安装源（config.toml: marketplaces.weaver-local, source_type=local）
    ↓ Codex 安装一份拷贝
  缓存 ~/.codex/plugins/cache/weaver-local/weaver-next/<version>/   ← Codex 实际运行的就是这份
  ```

  **只在仓库里 build，Codex 永远看不到**——它跑的是缓存副本。症状就是“改了半天、Codex 里依旧报旧问题 / `MCP proxy request failed`”。用 `lsof -a -p <pid> -d cwd` 看某个 `start-mcp.mjs` 的 cwd，落在 `~/.codex/plugins/cache/...` 就是 Codex 那份、落在仓库就是 Claude/dev 那份。

- **改完代码要让 Codex 生效的完整步骤**：
  1. 仓库 `npm run build:plugin`；
  2. **发布到 marketplace** `/Users/kids/.agents/weaver-marketplace`（用你既有的发布流程；缓存里 `plugin-install-*` 目录的时间戳能确认最近一次安装是否拿到了新代码）；
  3. 在 **Codex** 里更新 / 重装 `weaver-local` 插件并重连 `weaver_mcp`（新建 Chat 也行）。
  4. 存量僵尸进程：只 `kill` 父进程为 `launchd`(PID 1) 的孤儿 `start-mcp.mjs`；父进程是 ChatGPT/Codex app-server 或某个 Claude 会话的**不要**动（那是活跃连接）。

- 排查时优先在 Codex 里调 `weaver_get_diagnostics`（见 §5.1），不要默认依赖缓存目录里的持久日志。

### 5.1 可观测性（排查 MCP“黑盒”问题）

MCP server 走 stdio，不能 `console.log`（会污染协议），所以所有诊断走两个 host 无关的出口：

- **默认不写持久日志**：运行信息只进入 200 条、全字段脱敏的内存环。启动时会清理旧版本遗留的 `.weaver/logs/mcp-*.jsonl`，避免进程重启持续堆积文件。
- **诊断工具 `weaver_get_diagnostics`**（Codex 与 Claude 都可调，且在 loopback 白名单里）：返回 `pid/host/uptime/buildId`、是否有 preview、是否启用文件日志，以及脱敏后的最近事件。不得返回 `previewUrl`、capability token、绝对日志路径、原始 prompt 或 stack。
- **文件日志仅限临时排障**：显式设置 `WEAVER_FILE_LOG=1` 才会创建文件。默认只记 `warn/error`，权限 `0600`，1 MB 轮转、最多 3 个文件、保留 7 天；即使通过环境变量调整，也硬限制在单文件 10 MB、10 个文件和 30 天以内。排障结束后必须关闭该变量并重启。
- **stderr 默认关闭**：宿主可能把 stderr 再次持久化，因此只有显式设置 `WEAVER_STDERR_LOG=1` 才输出脱敏诊断；阈值由 `WEAVER_LOG_LEVEL` 控制，排障结束后必须关闭并重启。
- 记录点覆盖：`server.boot`、每个工具的 `tool.call/tool.result/tool.error`（带 `durationMs`）、loopback 的 `rpc.toolNotAllowed/rpc.workspaceScopeViolation/asset.notFound`、进程级 `process.uncaughtException/unhandledRejection/signal` 与 `transport.closed`——即“为什么进程悄悄死了”。
- 这是服务端代码：改完要**重启/重连 MCP** 才生效。

## 6. 数据与状态机专项检查

每次相关变更都回答以下问题：

- 这是 Graph 内容变化还是 Layout/View/Binding 变化？递增了正确的 revision 吗？
- 重复请求是否幂等？旧 sequence/revision 是否被拒绝？
- 两个 Chat 或两个 Canvas Session 是否会互相污染？
- Session offline、duplicate、detached、stale、build mismatch 时是否 fail closed？
- SSE 丢事件后能否通过权威 revision 恢复？
- claim 是否避免覆盖保存的 viewport？state 是否最终保存恢复后的 viewport？
- AgentTask 取消或失效后，晚到写入是否被拒绝？
- 用户已有内容、布局和未提交工作是否被保留？

## 7. 完成与交付

### Push 前自动验证

`npm install` 会将本仓库的 Git hooks 配置为 `.githooks`。每次 `git push` 前，`pre-push` 会自动运行 `npm run verify:push`，顺序覆盖 CI 的 lint、packages/widget build、TS tests、Widget typecheck、插件发布构建、release check 和 MCP probe。发布包在临时目录生成，不污染工作区；任一命令失败都会阻止 push。

如需在 push 前手动预检，可直接运行：

```bash
npm run verify:push
```

提交结果前：

1. 查看最终 diff，确认没有无关或生成物污染。
2. 运行与风险相称的测试、构建和真实页面验证。
3. 更新受影响的 README、AGENTS、WORKFLOW、product、PRD 或 architecture 文档。
4. 报告具体结果，不只写“已测试”：列出测试数量、命令和真实页面操作。
5. 明确仍需用户执行的动作，例如重启 Codex、新建 Chat、重新配对或重新打开 Canvas。

若任何必需验证因环境原因无法执行，不得宣称完成；应说明阻塞条件、已验证部分和最短下一步。
