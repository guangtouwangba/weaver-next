import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { resolveSceneContext } from "@weaver/core";
import { getScenePack } from "@weaver/scene-packs";
import { resolveBoundCanvas } from "../shared/bound-canvas.js";
import { workspaceSchema } from "../shared/schemas.js";
import { workspaceByTask } from "../shared/workspace-registry.js";
import { defineTool, result, withStore } from "../shared/tool-runtime.js";
import { chatSessionKeyFromRequest } from "../thread-context.js";

/**
 * One model-facing read tool that groups the four session-scoped reads
 * (`weaver_read_session(resource:"bound_canvas")`, `weaver_get_agent_task`, `weaver_get_canvas_context`,
 * `weaver_resolve_context`) plus a `guard` shortcut that returns the bound canvas
 * and the active task in one call. Each `resource` preserves the exact auth and
 * store calls of the tool it replaces.
 */
export function registerReadSessionTool(server: McpServer) {
  server.registerTool("weaver_read_session", {
    title: "Read Session",
    description: "Read the current chat's session state: the bound canvas, a durable task, a canvas context snapshot, the resolved scene context, or a guard bundle (bound canvas + active task). Pick one via `resource`.",
    inputSchema: {
      ...workspaceSchema.shape,
      resource: z.enum(["bound_canvas", "task", "canvas_tasks", "canvas_context", "canvas_view_state", "resolved_context", "guard"]),
      taskId: z.string().optional(),
      canvasSessionId: z.string().optional(),
      viewId: z.string().optional(),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, defineTool(async ({ workspaceDir, resource, taskId, canvasSessionId, viewId }, extra) => {
    switch (resource) {
      case "bound_canvas": {
        // weaver_read_session(resource:"bound_canvas")
        const chatSessionKey = chatSessionKeyFromRequest(extra);
        return result(withStore(workspaceDir, (store) => resolveBoundCanvas(store, chatSessionKey)));
      }
      case "task": {
        // weaver_get_agent_task
        if (!taskId) throw new Error("INVALID_ARGS:taskId required");
        const chatSessionKey = chatSessionKeyFromRequest(extra);
        const task = withStore(workspaceDir, (store) => store.tasks.assertChat(taskId, chatSessionKey, false));
        workspaceByTask.set(taskId, workspaceDir);
        return result(task);
      }
      case "canvas_context": {
        // weaver_get_canvas_context
        if (!canvasSessionId) throw new Error("INVALID_ARGS:canvasSessionId required");
        const context = withStore(workspaceDir, (store) => store.sessions.canvasContext(canvasSessionId));
        if (!context) throw new Error("CANVAS_SESSION_NOT_FOUND");
        return result(context);
      }
      case "canvas_tasks": {
        if (!canvasSessionId) throw new Error("INVALID_ARGS:canvasSessionId required");
        return result(withStore(workspaceDir, (store) => { store.tasks.reapCanvas(canvasSessionId); return store.tasks.listCanvas(canvasSessionId); }));
      }
      case "canvas_view_state": {
        if (!canvasSessionId || !viewId) throw new Error("INVALID_ARGS:canvasSessionId and viewId required");
        return result(withStore(workspaceDir, (store) => store.catalog.canvasState(canvasSessionId, viewId) ?? { canvasSessionId, viewId, firstOpen: true }));
      }
      case "resolved_context": {
        // weaver_resolve_context
        if (!canvasSessionId) throw new Error("INVALID_ARGS:canvasSessionId required");
        const output = withStore(workspaceDir, (store) => {
          const context = store.sessions.canvasContext(canvasSessionId); if (!context) throw new Error("CANVAS_SESSION_NOT_FOUND");
          const project = store.catalog.getProject(context.projectId); if (!project) throw new Error("PROJECT_NOT_FOUND");
          const scenePack = getScenePack(project.scenePackId, project.scenePackVersion); if (!scenePack) throw new Error("SCENE_PACK_NOT_FOUND");
          const graph = store.graphChanges.read(project.id);
          const resolved = resolveSceneContext({ nodes: graph.nodes, edges: graph.edges, scenePack, selectedNodeIds: context.selectedNodeIds, pinnedNodeIds: context.pinnedContextNodeIds });
          return { projectId: project.id, graphRevision: graph.revision, policy: scenePack.contextPolicy, ...resolved };
        });
        return result(output, `Resolved ${output.nodes.length} context nodes.`);
      }
      case "guard": {
        // weaver_read_session(resource:"bound_canvas") + weaver_get_agent_task in one call. The task is
        // the given taskId (chat-bound), or the active non-terminal canvas task.
        const chatSessionKey = chatSessionKeyFromRequest(extra);
        const { boundCanvas, task } = withStore(workspaceDir, (store) => {
          const boundCanvas = resolveBoundCanvas(store, chatSessionKey);
          // No taskId: return the newest non-terminal canvas task. We deliberately
          // skip reapExpiredCanvasTasks first (matching the old weaver_get_agent_task,
          // which never reaped) — a still-listed but idle-expired task can surface as
          // active here; the caller re-checks status before writing, and start/submit
          // reap on their own. Passing an explicit taskId is exact and unaffected.
          const task = taskId ? store.tasks.assertChat(taskId, chatSessionKey, false) : store.tasks.listCanvas(boundCanvas.canvasSessionId)[0] ?? null;
          return { boundCanvas, task };
        });
        if (task) workspaceByTask.set(task.taskId, workspaceDir);
        return result({ boundCanvas, task });
      }
    }
  }));
}
