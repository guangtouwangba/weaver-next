# Agent 任务生命周期健壮化 + 模板种子节点替换 实现计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 修掉"生成中…"僵尸任务（永不超时、阻塞新指令、无进度可见），并让模板占位节点在真实内容落地时自动归档。

**Architecture:** 四个独立可交付的改动，按依赖排序：(1) 服务端对 `dispatched`/`running` 任务加惰性超时回收（reap），在 `prepareAgentTask` 和 `weaver_list_canvas_tasks` 两个入口触发；(2) widget 忙碌 pill 显示任务已运行时长；(3) 给 `AgentTask` 加 `progressNote` 字段 + 新 MCP 工具 `weaver_report_task_progress`，agent 汇报进度的同时充当心跳（updatedAt 刷新让 reaper 不会误杀长任务）；(4) 在 `projectSchema` 记录 `starterNodeIds`，`applyChangeSet` 首次落地新增节点时归档未被用户动过的模板占位节点。

**Tech Stack:** TypeScript monorepo（npm workspaces）、node:sqlite、zod contracts、vitest、React widget（Vite）。

**关键背景（执行者必读）:**

- 任务状态机在 `packages/storage/src/store-internal.ts:10`（`taskTransitions`）。`prepared/dispatched/running → failed` 都是合法迁移；`pending_review`/`ready_to_continue` 是"等用户"状态，**不回收**。
- 现有 prepared 过期逻辑内联在 `packages/storage/src/agent-tasks.ts:21-25`，本计划把它抽成通用 `reapExpiredCanvasTasks`。
- 测试伪造时间的既有写法（不要用 fake timers）：直接改 SQLite 行里的 `updatedAt`，见 `packages/storage/__tests__/workspace-store.test.ts:304`：
  `db.db.prepare("UPDATE agent_task SET data = json_set(data, '$.updatedAt', ?) WHERE id = ?").run(new Date(Date.now() - 121_000).toISOString(), task.taskId);`
- 测试 helper `store()` / `bindCanvas()` / `dispatchAndStart()` 已存在于 `packages/storage/__tests__/workspace-store.test.ts:14-31`，直接复用。
- **contracts 是编译产物依赖**：storage/mcp/widget 通过 package exports 引用 `@weaver/contracts` 的 dist。每次改完 `packages/contracts/src/space.ts` 必须先 `npm --workspace @weaver/contracts run build` 再跑下游测试，否则新字段不可见。
- widget 的 `AgentTask` 类型 re-export 自 contracts（`apps/widget/src/types.ts:9`）。
- 本仓库规矩：conventional commits；`plugins/weaver-next` 是构建快照，**不手改**，最后统一 `npm run build:release` 刷新并单独提交（对照 git log 里的 `build(release): refresh plugin snapshot`）。
- 不新增 `@weaver/*` 子路径 import（只加字段/函数），所以不用碰 esbuild bundler maps。

**验证命令速查:**

```bash
npm --workspace @weaver/contracts run build        # 改 contracts 后必跑
npx vitest run packages/storage                    # storage 测试
npx vitest run packages/mcp                        # mcp 测试
npx vitest run apps/widget                         # widget 测试
npm run typecheck:widget                           # widget 类型检查
```

---

## Feature 1：僵尸任务回收

### Task 1: storage 层 `reapExpiredCanvasTasks`

**Files:**
- Modify: `packages/storage/src/store-internal.ts`（加过期常量）
- Modify: `packages/storage/src/agent-tasks.ts`（新函数 + 重构 `prepareAgentTask`）
- Modify: `packages/storage/src/workspace-store.ts`（暴露方法）
- Test: `packages/storage/__tests__/workspace-store.test.ts`

**Step 1: 写失败测试**

加到 `workspace-store.test.ts` 里现有 "expires an abandoned prepared task" 测试（约 309 行）之后：

```ts
  it("reaps a silent running task so the canvas is unblocked", () => {
    const db = store(); const scene = getScenePack("free-brainstorming")!;
    const project = db.createProject({ title: "Reap", goal: "", scenePack: scene });
    const chatSessionKey = bindCanvas(db, project, scene, "reap-session");
    const zombie = db.prepareAgentTask({ canvasSessionId: "reap-session", actionKey: "develop_selection", dispatchKey: "zombie", chatSessionKey });
    dispatchAndStart(db, zombie);
    db.db.prepare("UPDATE agent_task SET data = json_set(data, '$.updatedAt', ?) WHERE id = ?").run(new Date(Date.now() - 601_000).toISOString(), zombie.taskId);
    const reaped = db.reapExpiredCanvasTasks("reap-session");
    expect(reaped).toHaveLength(1);
    expect(db.getAgentTask(zombie.taskId)).toMatchObject({ status: "failed", error: { code: "AGENT_TASK_TIMEOUT" } });
    expect(db.listCanvasTasks("reap-session")).toHaveLength(0);
    const replacement = db.prepareAgentTask({ canvasSessionId: "reap-session", actionKey: "develop_selection", dispatchKey: "fresh", chatSessionKey });
    expect(replacement.taskId).not.toBe(zombie.taskId);
    db.close();
  });

  it("reaps a dispatched task no agent ever started, but never review states", () => {
    const db = store(); const scene = getScenePack("free-brainstorming")!;
    const project = db.createProject({ title: "ReapDispatch", goal: "", scenePack: scene });
    const chatSessionKey = bindCanvas(db, project, scene, "reap-dispatch-session");
    const task = db.prepareAgentTask({ canvasSessionId: "reap-dispatch-session", actionKey: "develop_selection", dispatchKey: "d1", chatSessionKey });
    db.confirmAgentDispatch(task.taskId, "d1");
    db.db.prepare("UPDATE agent_task SET data = json_set(data, '$.updatedAt', ?) WHERE id = ?").run(new Date(Date.now() - 181_000).toISOString(), task.taskId);
    db.reapExpiredCanvasTasks("reap-dispatch-session");
    expect(db.getAgentTask(task.taskId)).toMatchObject({ status: "failed", error: { code: "AGENT_DISPATCH_TIMEOUT" } });

    // pending_review 等用户，无论多久都不回收
    const second = db.prepareAgentTask({ canvasSessionId: "reap-dispatch-session", actionKey: "develop_selection", dispatchKey: "d2", chatSessionKey });
    dispatchAndStart(db, second);
    db.updateAgentTask(second.taskId, { status: "pending_review" });
    db.db.prepare("UPDATE agent_task SET data = json_set(data, '$.updatedAt', ?) WHERE id = ?").run(new Date(Date.now() - 3_600_000).toISOString(), second.taskId);
    expect(db.reapExpiredCanvasTasks("reap-dispatch-session")).toHaveLength(0);
    expect(db.getAgentTask(second.taskId)?.status).toBe("pending_review");
    db.close();
  });
```

**Step 2: 跑测试确认失败**

Run: `npx vitest run packages/storage -t "reaps"`
Expected: FAIL — `db.reapExpiredCanvasTasks is not a function`

**Step 3: 最小实现**

3a. `packages/storage/src/store-internal.ts` — 在 `canvasOfflineAfterMs`（第 9 行）后加：

```ts
export const preparedTaskExpiryMs = 120_000;
export const dispatchedTaskExpiryMs = 180_000;
export const runningTaskExpiryMs = 600_000;
```

3b. `packages/storage/src/agent-tasks.ts` — import 三个常量（第 4 行的 `from "./store-internal.js"`），在 `prepareAgentTask` 之前加：

```ts
/** Lazily fail tasks whose owner went silent: prepared never dispatched, dispatched
 * never started, running with no heartbeat (any updateAgentTask bumps updatedAt).
 * pending_review / ready_to_continue wait on the USER and are never reaped. */
export function reapExpiredCanvasTasks(db: DatabaseSync, canvasSessionId: string) {
  const reaped: AgentTask[] = [];
  for (const task of listCanvasTasks(db, canvasSessionId)) {
    const idleMs = Date.now() - Date.parse(task.updatedAt);
    if (task.status === "prepared" && idleMs > preparedTaskExpiryMs) {
      reaped.push(updateAgentTask(db, task.taskId, { status: "failed", error: { code: "PREPARED_TASK_EXPIRED", message: "Prepared task was not dispatched within two minutes" } }));
    } else if (task.status === "dispatched" && idleMs > dispatchedTaskExpiryMs) {
      reaped.push(updateAgentTask(db, task.taskId, { status: "failed", error: { code: "AGENT_DISPATCH_TIMEOUT", message: "No agent started this task within three minutes" } }));
    } else if (task.status === "running" && idleMs > runningTaskExpiryMs) {
      reaped.push(updateAgentTask(db, task.taskId, { status: "failed", error: { code: "AGENT_TASK_TIMEOUT", message: "Agent reported no progress for ten minutes; task reaped so the canvas is unblocked" } }));
    }
  }
  return reaped;
}
```

3c. 同文件 `prepareAgentTask` — 把第 21-27 行的过期循环整体替换为：

```ts
  reapExpiredCanvasTasks(db, context.canvasSessionId);
  const [blocking] = listCanvasTasks(db, context.canvasSessionId);
  if (blocking) throw new Error(`ACTIVE_CANVAS_TASK_EXISTS:${blocking.taskId}`);
```

（保留其上的 dispatchKey 幂等 duplicate 检查不动。）

3d. `packages/storage/src/workspace-store.ts` — 在 `listCanvasTasks` 方法（第 134 行）旁加：

```ts
  reapExpiredCanvasTasks(canvasSessionId: string) { return agentTasks.reapExpiredCanvasTasks(this.db, canvasSessionId); }
```

**Step 4: 跑测试确认通过**

Run: `npx vitest run packages/storage`
Expected: 全绿，包括原有 "expires an abandoned prepared task"（错误码 `PREPARED_TASK_EXPIRED` 语义未变）。

**Step 5: Commit**

```bash
git add packages/storage
git commit -m "feat(storage): reap silent dispatched/running agent tasks"
```

### Task 2: `weaver_list_canvas_tasks` 先回收再返回

widget 每次打开画布/轮询都走这个工具（`apps/widget/src/hooks/useCanvasEventStream.ts:160,204`），在这里回收意味着：僵尸任务在画布打开瞬间变成 `failed`，`task.updated` 事件同时广播给其它在线画布，widget 端零改动。

**Files:**
- Modify: `packages/mcp/src/tools/agent-tasks.ts:63`
- Test: `packages/mcp/__tests__/`（先看 `claude-agent-loop.test.ts` 里有没有现成的 list_canvas_tasks 调用可扩展；没有就新建 `task-reaping.test.ts`，仿照该文件的 server 搭建方式）

**Step 1: 写失败测试**

用现有 mcp 测试的 `createWeaverServer`/`dispatch` 模式（照抄 `claude-agent-loop.test.ts` 的 setup），核心断言：

```ts
// 造一个 running 任务 → 直接改 DB 把 updatedAt 拨旧 11 分钟 →
// dispatch("weaver_list_canvas_tasks", { workspaceDir, canvasSessionId }) →
// 期望返回 [] 且 weaver_get_agent_task 显示 status failed / AGENT_TASK_TIMEOUT
```

**Step 2: 跑测试确认失败**

Run: `npx vitest run packages/mcp -t "reap"`
Expected: FAIL — list 返回了僵尸任务（长度 1）。

**Step 3: 实现**

`packages/mcp/src/tools/agent-tasks.ts` 第 63 行，把 handler 从 `withStore` 换成先回收：

```ts
server.registerTool("weaver_list_canvas_tasks", { title: "List Canvas Tasks", description: "Widget-only recovery of non-terminal tasks associated with one canvas session. Reaps expired tasks first.", inputSchema: { ...workspaceSchema.shape, canvasSessionId: z.string() }, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }, _meta: { ui: { visibility: ["app"] } } }, defineTool(async ({ workspaceDir, canvasSessionId }) => result(mutateWithStore(workspaceDir, (store) => { store.reapExpiredCanvasTasks(canvasSessionId); return store.listCanvasTasks(canvasSessionId); }))));
```

注意 `readOnlyHint` 改为 `false`（它现在会写库）。

**Step 4: 跑测试**

Run: `npx vitest run packages/mcp`
Expected: 全绿。若有工具清单/annotations 快照类测试（如 `plugin-package.test.ts`）因 readOnlyHint 变化失败，同步更新该断言。

**Step 5: Commit**

```bash
git add packages/mcp
git commit -m "feat(mcp): reap expired tasks on canvas task recovery"
```

---

## Feature 2：忙碌 pill 显示任务年龄

### Task 3: `taskAgeSuffix` + pill 渲染

**Files:**
- Modify: `apps/widget/src/components/SelectionContextBar.tsx`
- Modify: `apps/widget/src/main.tsx:150`
- Test: `apps/widget/src/__tests__/task-age.test.ts`（新建）

**Step 1: 写失败测试**

```ts
import { describe, expect, it } from "vitest";
import { taskAgeSuffix } from "../components/SelectionContextBar";

describe("taskAgeSuffix", () => {
  const base = Date.parse("2026-07-12T10:00:00.000Z");
  it("stays silent inside the first minute", () => {
    expect(taskAgeSuffix(new Date(base).toISOString(), base + 59_000)).toBe("");
  });
  it("reports whole minutes elapsed", () => {
    expect(taskAgeSuffix(new Date(base).toISOString(), base + 5 * 60_000 + 10_000)).toBe(" · 已 5 分钟");
  });
});
```

**Step 2: 跑测试确认失败**

Run: `npx vitest run apps/widget -t "taskAgeSuffix"`
Expected: FAIL — `taskAgeSuffix` 未导出。

**Step 3: 实现**

`SelectionContextBar.tsx`：

3a. 顶部 import 改为 `import { useEffect, useState } from "react";`，并加纯函数（放 `activeTaskBusyLabel` 后面）：

```ts
/** " · 已 N 分钟" once a task has run ≥1 minute — makes zombie tasks obvious at a glance. */
export function taskAgeSuffix(createdAt: string, nowMs: number): string {
  const minutes = Math.floor((nowMs - Date.parse(createdAt)) / 60_000);
  return minutes < 1 ? "" : ` · 已 ${minutes} 分钟`;
}
```

3b. props 加 `busySince?: string;`，解构同步加。

3c. 组件顶部（`const [expanded...]` 旁，必须在任何 early return 之前）加 30 秒重渲染 tick：

```ts
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (!props.busy) return;
    const id = window.setInterval(() => setNowMs(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, [props.busy]);
```

3d. busy 分支（第 55 行）的 `<span>` 改为：

```tsx
<span>{`${busyLabel ?? "处理中…"}${busySince ? taskAgeSuffix(busySince, nowMs) : ""}`}</span>
```

3e. `apps/widget/src/main.tsx:150` 的 `<SelectionContextBar ...` 追加一个 prop：`busySince={activeTask?.createdAt}`。

**Step 4: 跑测试 + 类型检查**

Run: `npx vitest run apps/widget && npm run typecheck:widget`
Expected: PASS

**Step 5: Commit**

```bash
git add apps/widget
git commit -m "feat(widget): show elapsed minutes on the busy pill"
```

---

## Feature 3：进度通道 progressNote

### Task 4: contracts 字段 + storage `reportTaskProgress`

**Files:**
- Modify: `packages/contracts/src/space.ts:296`（`agentTaskSchema`）
- Modify: `packages/storage/src/agent-tasks.ts`
- Modify: `packages/storage/src/workspace-store.ts`
- Test: `packages/storage/__tests__/workspace-store.test.ts`

**Step 1: 写失败测试**

```ts
  it("records progress notes only while running", () => {
    const db = store(); const scene = getScenePack("free-brainstorming")!;
    const project = db.createProject({ title: "Progress", goal: "", scenePack: scene });
    const chatSessionKey = bindCanvas(db, project, scene, "progress-session");
    const task = db.prepareAgentTask({ canvasSessionId: "progress-session", actionKey: "develop_selection", chatSessionKey });
    expect(() => db.reportTaskProgress(task.taskId, "太早了")).toThrow("TASK_NOT_RUNNING:prepared");
    dispatchAndStart(db, task);
    const updated = db.reportTaskProgress(task.taskId, "已写入 12/32 个节点…");
    expect(updated.progressNote).toBe("已写入 12/32 个节点…");
    expect(updated.taskRevision).toBeGreaterThan(task.taskRevision);
    db.close();
  });
```

**Step 2: 跑测试确认失败**

Run: `npx vitest run packages/storage -t "progress notes"`
Expected: FAIL — `reportTaskProgress is not a function`

**Step 3: 实现**

3a. `packages/contracts/src/space.ts` — `agentTaskSchema` 里 `results` 行（296）之后加：

```ts
  progressNote: z.string().max(280).optional(),
```

3b. Run: `npm --workspace @weaver/contracts run build`（下游才能看到字段）。

3c. `packages/storage/src/agent-tasks.ts` 末尾加：

```ts
/** One-line heartbeat from the agent. Bumping taskRevision/updatedAt is the point:
 * it feeds the busy pill AND resets the running-task reaper clock. */
export function reportTaskProgress(db: DatabaseSync, taskId: string, note: string) {
  const task = getAgentTask(db, taskId);
  if (!task) throw new Error(`AGENT_TASK_NOT_FOUND:${taskId}`);
  if (task.status !== "running") throw new Error(`TASK_NOT_RUNNING:${task.status}`);
  return updateAgentTask(db, taskId, { progressNote: note });
}
```

3d. `workspace-store.ts` 加方法：

```ts
  reportTaskProgress(taskId: string, note: string) { return agentTasks.reportTaskProgress(this.db, taskId, note); }
```

**Step 4: 跑测试**

Run: `npx vitest run packages/storage`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/contracts packages/storage
git commit -m "feat(storage): progress-note heartbeat on running agent tasks"
```

### Task 5: MCP 工具 `weaver_report_task_progress`

**Files:**
- Modify: `packages/mcp/src/tools/agent-tasks.ts`（第 58 行 start/complete 循环之后）
- Test: `packages/mcp/__tests__/`（跟 Task 2 同一文件即可）

**Step 1: 写失败测试** — dispatch 新工具名，断言返回 task 带 progressNote；再断言非本 chat 的 `chatSessionKey` 调用被 `TASK_CHAT_MISMATCH` 拒绝（`assertTaskChat` 已有行为，测过即锁定）。

**Step 2: 确认失败** — `npx vitest run packages/mcp -t "progress"` → unknown tool。

**Step 3: 实现**

```ts
  server.registerTool("weaver_report_task_progress", { title: "Report Task Progress", description: "Post a one-line progress note on a running task; shown live on the canvas busy indicator and doubles as the liveness heartbeat.", inputSchema: { ...workspaceSchema.shape, taskId: z.string(), note: z.string().min(1).max(280) }, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } }, defineTool(async ({ workspaceDir, taskId, note }, extra) => { const chatSessionKey = chatSessionKeyFromRequest(extra); return result(mutateWithStore(workspaceDir, (store) => { store.assertTaskChat(taskId, chatSessionKey); return store.reportTaskProgress(taskId, note); })); }));
```

（不加 `_meta.ui.visibility` —— 这是 agent 侧工具；也不进 `PREVIEW_TOOL_ALLOWLIST`，浏览器 widget 不调它。）

**Step 4: 跑测试** — `npx vitest run packages/mcp` 全绿；工具清单类测试若失败则把新工具名补进清单断言。

**Step 5: Commit**

```bash
git add packages/mcp
git commit -m "feat(mcp): add weaver_report_task_progress tool"
```

### Task 6: widget 忙碌 pill 优先展示 progressNote

**Files:**
- Modify: `apps/widget/src/components/SelectionContextBar.tsx:14`
- Test: `apps/widget/src/__tests__/task-age.test.ts`（追加）

**Step 1: 写失败测试**

```ts
import { activeTaskBusyLabel } from "../components/SelectionContextBar";
import type { AgentTask } from "../types";

it("prefers the agent's progress note while running", () => {
  const task = { status: "running", activeStage: "content", progressNote: "已写入 12/32 个节点…" } as AgentTask;
  expect(activeTaskBusyLabel(task)).toBe("已写入 12/32 个节点…");
  expect(activeTaskBusyLabel({ status: "running", activeStage: "content" } as AgentTask)).toBe("生成中…");
});
```

**Step 2: 确认失败** — `npx vitest run apps/widget -t "progress note"` → 期望值不等。

**Step 3: 实现** — `activeTaskBusyLabel` 第 14 行改为：

```ts
    case "running": return task.progressNote ?? (task.activeStage === "layout" ? "排版中…" : "生成中…");
```

**Step 4: 跑测试** — `npx vitest run apps/widget && npm run typecheck:widget` → PASS（若类型报错说明忘了重建 contracts，回 Task 4 Step 3b）。

**Step 5: Commit**

```bash
git add apps/widget
git commit -m "feat(widget): surface agent progress notes on the busy pill"
```

### Task 7: 教 agent 调进度工具（skills 文档）

**Files:**
- Modify: `skills/weaver-agent-loop/SKILL.md`
- Modify: `skills/weaver-develop-space/SKILL.md`

**Step 1:** 先通读两个文件里描述 `weaver_start_agent_task` → `weaver_submit_changeset` 流程的段落。

**Step 2:** 在 start 与 submit 之间的流程描述处，各插入一条同风格的指令，要点：

- `weaver_start_agent_task` 之后、每完成一个明显阶段（如构造完一批节点、开始排版计算）就调 `weaver_report_task_progress { taskId, note }`，note 是给用户看的一句中文进度（例："已写入 12/32 个节点…"）。
- 长任务每 2-3 分钟至少汇报一次——超过 10 分钟没有任何任务更新，服务端会把任务判死（AGENT_TASK_TIMEOUT）。

**Step 3:** 只改 `skills/` 源目录；`plugins/weaver-next/skills` 是快照，最终 Task 10 统一刷新。

**Step 4: Commit**

```bash
git add skills
git commit -m "docs(skills): require progress heartbeats in the agent loop"
```

---

## Feature 4：模板占位节点自动替换

### Task 8: `starterNodeIds` 记录到 project

**Files:**
- Modify: `packages/contracts/src/space.ts:105`（`projectSchema`）
- Modify: `packages/storage/src/projects.ts`（新 `patchProject`）
- Modify: `packages/storage/src/layout-templates.ts:147`（创建时记录）
- Test: `packages/storage/__tests__/workspace-store.test.ts`

**Step 1: 写失败测试**

```ts
  it("records template starter node ids on the project", () => {
    const db = store(); const scene = getScenePack("problem-decomposition")!; const template = getVisualTemplate("logic-tree")!;
    const created = db.createProjectFromVisualTemplate({ title: "Seeded", goal: "", scenePack: scene, template });
    expect(created.project.starterNodeIds).toHaveLength(template.starterBlueprint.nodes.length);
    expect(new Set(created.graph.nodes.map((node) => node.id))).toEqual(new Set(created.project.starterNodeIds));
    db.close();
  });
```

**Step 2: 确认失败** — `npx vitest run packages/storage -t "starter node ids"` → `starterNodeIds` undefined。

**Step 3: 实现**

3a. `packages/contracts/src/space.ts` — `projectSchema` 的 `createdFromTemplate`（105 行）后加：

```ts
  starterNodeIds: z.array(z.string()).default([]),
```

然后 `npm --workspace @weaver/contracts run build`。

3b. `packages/storage/src/projects.ts` — `getProject` 后加：

```ts
export function patchProject(db: DatabaseSync, projectId: string, patch: Partial<SpaceProject>) {
  const current = getProject(db, projectId);
  if (!current) throw new Error(`PROJECT_NOT_FOUND:${projectId}`);
  const next = projectSchema.parse({ ...current, ...patch, id: current.id, createdAt: current.createdAt, updatedAt: now() });
  db.prepare("UPDATE project SET data = ? WHERE id = ?").run(json(next), projectId);
  return next;
}
```

3c. `packages/storage/src/layout-templates.ts` — import 处给 `./projects.js` 加 `patchProject`；`createProjectFromVisualTemplate` 里 `replaceGraph(...)`（147 行）之后、`project = getProject(...)`（148 行）之前插入：

```ts
    patchProject(db, project.id, { starterNodeIds: nodes.map((node) => node.id) });
```

**Step 4: 跑测试** — `npx vitest run packages/storage` 全绿（schema 字段带 default，旧数据/旧测试不受影响）。

**Step 5: Commit**

```bash
git add packages/contracts packages/storage
git commit -m "feat(storage): track template starter nodes on the project"
```

### Task 9: `applyChangeSet` 归档未动过的占位节点

规则：ChangeSet **新增了节点** 且 project 还有 `starterNodeIds` 时——凡是占位节点仍然"纯净"（body 空、document content 的 markdown 空、且不是本 ChangeSet 任何操作的目标），连同挂在它们身上的边一起归档；用户写过字的占位节点保留。之后清空 `starterNodeIds`（占位期结束）。

**Files:**
- Modify: `packages/storage/src/changesets.ts`
- Test: `packages/storage/__tests__/workspace-store.test.ts`

**Step 0: 先读 `packages/storage/src/graph.ts` 的 `replaceGraph`**，确认它按传入快照整体覆写并广播 `graph.changed`（归档节点会以 `archivedNodeIds` 进 delta，widget 已处理）。若它对 `revision` 有额外校验，保持传入 `nextGraph.revision` 不变即可——归档是同一个修订内的内容差异。

**Step 1: 写失败测试**

```ts
  it("archives pristine starter placeholders when real content lands, keeping user-edited ones", () => {
    const db = store(); const scene = getScenePack("problem-decomposition")!; const template = getVisualTemplate("logic-tree")!;
    const created = db.createProjectFromVisualTemplate({ title: "Starter swap", goal: "", scenePack: scene, template });
    let project = created.project;
    const [editedId, ...pristineIds] = project.starterNodeIds;
    db.updateNodeContent({ projectId: project.id, nodeId: editedId, baseGraphRevision: project.graphRevision, content: { kind: "document", mode: "note", markdown: "用户手写的内容", excerpt: "", embeddedAssetIds: [] } });
    project = db.getProject(project.id)!;
    const chatSessionKey = bindCanvas(db, project, scene, "starter-session");
    const task = db.prepareAgentTask({ canvasSessionId: "starter-session", actionKey: "develop_selection", chatSessionKey });
    dispatchAndStart(db, task);
    const timestamp = new Date().toISOString();
    db.submitChangeSet({ id: "starter-change", taskId: task.taskId, projectId: project.id, baseGraphRevision: project.graphRevision, baseLayoutRevisions: {}, graphOperations: [{ type: "add-node", node: { id: "real-node", projectId: project.id, type: scene.nodeTypes[0].key, title: "真实节点", body: "", contentKind: "document", content: { kind: "document", mode: "note", markdown: "", excerpt: "", embeddedAssetIds: [] }, properties: {}, archived: false, createdAt: timestamp, updatedAt: timestamp } }], layoutOperations: [], rationale: "First real content", riskLevel: "low", status: "pending", createdAt: timestamp, updatedAt: timestamp });
    db.applyChangeSet("starter-change");
    const graph = db.getGraph(project.id);
    for (const id of pristineIds) expect(graph.nodes.find((node) => node.id === id)?.archived).toBe(true);
    expect(graph.nodes.find((node) => node.id === editedId)?.archived).toBe(false);
    expect(graph.nodes.find((node) => node.id === "real-node")?.archived).toBe(false);
    expect(graph.edges.filter((edge) => !edge.archived).every((edge) => !pristineIds.includes(edge.sourceNodeId) && !pristineIds.includes(edge.targetNodeId))).toBe(true);
    expect(db.getProject(project.id)?.starterNodeIds).toEqual([]);
    db.close();
  });
```

注意：`updateNodeContent` 会把 graphRevision 推到 2，所以后续 `baseGraphRevision` 用重新读取的 `project.graphRevision`，`bindCanvas` 也要在其后调用（它上报 graphRevision）。

**Step 2: 确认失败** — `npx vitest run packages/storage -t "starter placeholders"` → pristine 节点未被归档。

**Step 3: 实现**

`packages/storage/src/changesets.ts`：

3a. import 行给 `./projects.js` 加 `patchProject`（`getProject` 已在）。

3b. 在 `applyChangeSet` 里 `const applied = ...`（103 行）之前插入：

```ts
  const project = getProject(db, changeSet.projectId)!;
  const starterIds = new Set(project.starterNodeIds);
  let finalGraph = nextGraph;
  if (addedNodes.length && starterIds.size) {
    // First real content: retire template placeholders the user never touched.
    const touched = new Set(changeSet.graphOperations.flatMap((operation) => "nodeId" in operation ? [operation.nodeId as string] : []));
    const timestamp = now();
    const pristine = (node: (typeof nextGraph.nodes)[number]) =>
      starterIds.has(node.id) && !touched.has(node.id) && !node.archived &&
      node.body === "" && node.content.kind === "document" && node.content.markdown === "";
    const retiredIds = new Set(nextGraph.nodes.filter(pristine).map((node) => node.id));
    if (retiredIds.size) finalGraph = {
      ...nextGraph,
      nodes: nextGraph.nodes.map((node) => retiredIds.has(node.id) ? { ...node, archived: true, updatedAt: timestamp } : node),
      edges: nextGraph.edges.map((edge) => retiredIds.has(edge.sourceNodeId) || retiredIds.has(edge.targetNodeId) ? { ...edge, archived: true, updatedAt: timestamp } : edge),
    };
  }
```

3c. transaction 内（106 行）改用 `finalGraph`，并清空记录：

```ts
    if (changeSet.graphOperations.length) replaceGraph(db, finalGraph, { taskId: task.taskId, canvasSessionId: task.canvasSessionId });
```

并在 `replaceGraph` 之后加：

```ts
    if (addedNodes.length && starterIds.size) patchProject(db, changeSet.projectId, { starterNodeIds: [] });
```

3d. 该函数内其余 `nextGraph.revision` 引用（`expectedGraphRevision`、返回值 `graphRevision`、`nextLayout.graphRevision`）全部改为 `finalGraph.revision`（两者数值相同，统一避免混用）。

**Step 4: 跑测试**

Run: `npx vitest run packages/storage`
Expected: 全绿，特别确认既有 "applies mixed content atomically"（无模板项目，`starterNodeIds` 为空数组，逻辑短路）不受影响。

**Step 5: Commit**

```bash
git add packages/storage
git commit -m "feat(storage): retire pristine template placeholders when real content lands"
```

---

## Task 10: 全量验证 + 刷新插件快照

**Step 1:** 全量构建与测试：

```bash
npm run build:packages && npm run build:widget
npx vitest run
npm run typecheck:widget
npm run lint
```

Expected: 全部通过。lint 若报格式问题 `npm run lint:fix` 后复查 diff。

**Step 2:** 刷新插件快照（含 skills 与 widget bundle）：

```bash
npm run build:release && npm run check:release
```

**Step 3: Commit**

```bash
git add plugins
git commit -m "build(release): refresh plugin snapshot"
```

**Step 4: 端到端冒烟（手动，可选但推荐）：** 在 Claude Code 宿主里打开一个画布（/weaver-open），发一条画布指令，观察：pill 出现"生成中…"，agent 调 `weaver_report_task_progress` 后 pill 文案变为进度句 + " · 已 N 分钟"；杀掉 agent 进程等 10 分钟后重开画布，pill 不再出现、可直接发新指令。
