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
