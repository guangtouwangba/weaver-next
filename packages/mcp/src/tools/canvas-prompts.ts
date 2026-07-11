import { randomUUID } from "node:crypto";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { workspaceSchema } from "../shared/schemas.js";
import { workspaceByTask } from "../shared/workspace-registry.js";
import { defineTool, result, withStore, type MutateWithStore } from "../shared/tool-runtime.js";
import { chatSessionKeyFromRequest } from "../thread-context.js";
import { awaitCanvasPromptSignal, notifyCanvasPrompt } from "../shared/canvas-prompts.js";

export type CanvasPromptsToolsCtx = { mutateWithStore: MutateWithStore };

const AWAIT_DEFAULT_MS = 25_000;
const AWAIT_MAX_MS = 60_000;
const AWAIT_SLICE_MS = 5_000;

/** Canvas-driven prompts: the widget submits an instruction on the canvas and the terminal
 *  agent (watch mode) long-polls to pick it up — turning the canvas into the primary input. */
export function registerCanvasPromptsTools(server: McpServer, ctx: CanvasPromptsToolsCtx) {
  const { mutateWithStore } = ctx;

  server.registerTool("weaver_submit_canvas_prompt", {
    title: "Submit Canvas Prompt",
    description: "Widget-only: submit a natural-language instruction typed on the canvas against the exact bound online Canvas. Creates a durable, self-dispatched task for the terminal agent to pick up; does not itself run the model.",
    inputSchema: { ...workspaceSchema.shape, instruction: z.string().min(1), actionKey: z.enum(["develop_selection", "follow_up_ask", "develop_then_layout"]).default("develop_selection") },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    _meta: { ui: { visibility: ["app"] } },
  }, defineTool(async ({ workspaceDir, instruction, actionKey }, extra) => {
    const chatSessionKey = chatSessionKeyFromRequest(extra);
    const dispatchKey = `canvas-${randomUUID()}`;
    const task = mutateWithStore(workspaceDir, (store) => {
      const prepared = store.prepareAgentTaskFromBoundCanvas({ chatSessionKey, actionKey, userInstruction: instruction, dispatchKey });
      return store.confirmAgentDispatch(prepared.taskId, dispatchKey);
    });
    workspaceByTask.set(task.taskId, workspaceDir);
    notifyCanvasPrompt(workspaceDir);
    return result({ taskId: task.taskId, status: task.status, actionKey }, "Submitted canvas prompt.");
  }));

  server.registerTool("weaver_await_canvas_prompt", {
    title: "Await Canvas Prompt",
    description: "Terminal watch mode: long-poll for the next canvas-submitted instruction on the bound Canvas. Returns the pending task immediately when one exists, otherwise waits up to timeoutMs then returns { pending: false }. Loop this while watching.",
    inputSchema: { ...workspaceSchema.shape, timeoutMs: z.number().int().positive().max(AWAIT_MAX_MS).optional() },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, defineTool(async ({ workspaceDir, timeoutMs }, extra) => {
    const chatSessionKey = chatSessionKeyFromRequest(extra);
    const deadline = Date.now() + Math.min(timeoutMs ?? AWAIT_DEFAULT_MS, AWAIT_MAX_MS);
    // Long-poll: return the oldest not-yet-started canvas task, else wait for a submit signal.
    for (;;) {
      const pending = withStore(workspaceDir, (store) => {
        let canvasSessionId: string;
        try { canvasSessionId = store.getBoundCanvas(chatSessionKey, false).context.canvasSessionId; }
        catch { return null; }
        return store.listCanvasTasks(canvasSessionId)
          .filter((task) => task.status === "dispatched" && task.activeStage === "content")
          .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1))[0] ?? null;
      });
      if (pending) return result({ pending: true, task: pending }, "Picked up a canvas prompt. Handle it now (weaver_start_agent_task → resolve context → weaver_submit_changeset), then call weaver_await_canvas_prompt AGAIN to keep watching. Do not end your turn.");
      const remaining = deadline - Date.now();
      if (remaining <= 0) return result({ pending: false }, "No canvas prompt yet. Call weaver_await_canvas_prompt AGAIN immediately to keep watching — the canvas is the input. Do not end your turn or wait for the terminal.");
      await awaitCanvasPromptSignal(workspaceDir, Math.min(remaining, AWAIT_SLICE_MS));
    }
  }));
}
