import { describe, expect, it } from "vitest";
import { activeTaskBusyLabel, taskAgeSuffix } from "../components/SelectionContextBar";
import type { AgentTask } from "../types";

describe("taskAgeSuffix", () => {
  const base = Date.parse("2026-07-12T10:00:00.000Z");
  it("stays silent inside the first minute", () => {
    expect(taskAgeSuffix(new Date(base).toISOString(), base + 59_000)).toBe("");
  });
  it("reports whole minutes elapsed", () => {
    expect(taskAgeSuffix(new Date(base).toISOString(), base + 5 * 60_000 + 10_000)).toBe(" · 已 5 分钟");
  });
});

describe("activeTaskBusyLabel", () => {
  it("prefers the agent's progress note while running", () => {
    const task = { status: "running", activeStage: "content", progressNote: "已写入 12/32 个节点…" } as AgentTask;
    expect(activeTaskBusyLabel(task)).toBe("已写入 12/32 个节点…");
  });
  it("falls back to the generic label when no progress note", () => {
    expect(activeTaskBusyLabel({ status: "running", activeStage: "content" } as AgentTask)).toBe("生成中…");
    expect(activeTaskBusyLabel({ status: "running", activeStage: "layout" } as AgentTask)).toBe("排版中…");
  });
});
