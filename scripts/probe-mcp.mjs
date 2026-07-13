import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const workspaceDir = join(tmpdir(), `weaver-mcp-probe-${process.pid}`);
mkdirSync(workspaceDir, { recursive: true });
const transport = new StdioClientTransport({ command: process.env.WEAVER_PROBE_COMMAND ?? "node", args: process.env.WEAVER_PROBE_ARGS ? JSON.parse(process.env.WEAVER_PROBE_ARGS) : ["./scripts/start-mcp.mjs"], cwd: process.env.WEAVER_PROBE_CWD ?? process.cwd(), stderr: "pipe" });
const client = new Client({ name: "weaver-probe", version: "0.2.0" });
const threadId = `weaver-probe-thread-${process.pid}`;
const _meta = { threadId, "x-codex-turn-metadata": { thread_id: threadId } };
function data(result) { if (result.isError) throw new Error(result.structuredContent?.message ?? "MCP tool failed"); const value = result.structuredContent; return value && Object.keys(value).length === 1 && Array.isArray(value.items) ? value.items : value; }
const call = (name, args) => client.callTool({ name, arguments: args, _meta }).then(data);

try {
  await client.connect(transport);
  const tools = await client.listTools();
  const expected = ["weaver_open_space", "weaver_read_catalog", "weaver_read_graph", "weaver_read_session", "weaver_catalog_action", "weaver_canvas_action", "weaver_prepare_task", "weaver_task_action", "weaver_submit_changeset", "weaver_recommend_layout", "weaver_review_action", "weaver_import_asset", "weaver_publish_artifact", "weaver_subscribe_canvas", "weaver_get_diagnostics"].sort();
  const actual = tools.tools.map((tool) => tool.name).sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`Unexpected tool surface: ${actual.join(",")}`);

  const created = await call("weaver_catalog_action", { workspaceDir, action: "create_project", title: "机器人研究", goal: "梳理人形机器人技术栈", scenePackId: "entity-relationship" });
  const project = created.project;
  for (const [index, title] of ["人形机器人", "伺服系统", "减速器", "具身智能模型"].entries()) await call("weaver_canvas_action", { workspaceDir, action: "create_node", projectId: project.id, viewId: project.defaultViewId, semanticType: "entity", title, content: { kind: "document", mode: "note", markdown: `# ${title}`, excerpt: title, embeddedAssetIds: [] }, x: index * 220, y: index % 2 * 140 });
  const graph = await call("weaver_read_graph", { workspaceDir, resource: "full", projectId: project.id, viewId: project.defaultViewId });
  if (graph.nodes.length !== 5) throw new Error("Robot research graph was not created");

  const opened = await call("weaver_open_space", { workspaceDir, projectId: project.id, displayMode: "fullscreen" });
  const timestamp = new Date().toISOString();
  await call("weaver_canvas_action", { workspaceDir, action: "claim", snapshot: { version: 2, syncPurpose: "claim", canvasSessionId: "probe-session", workspaceDir, projectId: project.id, scenePackId: project.scenePackId, scenePackVersion: project.scenePackVersion, graphRevision: graph.project.graphRevision, viewId: project.defaultViewId, viewType: graph.layout.viewType, selectedNodeIds: graph.nodes.map((node) => node.id), selectedEdgeIds: [], selectedGroupIds: [], pinnedContextNodeIds: [], viewport: { x: 0, y: 0, zoom: 1 }, presence: { visible: true, focused: true, lastSeenAt: timestamp }, chatBinding: opened.chatBinding, agentEligible: true, sequence: 1, updatedAt: timestamp } });
  const task = await call("weaver_prepare_task", { workspaceDir, actionKey: "layout_view", userInstruction: "按技术栈从左到右排列" });
  await call("weaver_task_action", { workspaceDir, taskId: task.taskId, action: "start" });
  const generated = await call("weaver_recommend_layout", { workspaceDir, taskId: task.taskId, plan: { projectId: project.id, viewId: project.defaultViewId, baseGraphRevision: graph.project.graphRevision, baseLayoutRevision: graph.layout.layoutRevision, scope: { type: "whole-view" }, strategy: "layered", direction: "left-right", constraints: [{ type: "avoid-overlap", nodeIds: [], edgeIds: [], edgeTypes: [], strength: 1 }], preserve: { pinnedNodes: true, manualGroups: true, relativeOrder: true, mentalMapWeight: 0.7 }, candidateCount: 3, rationale: "机器人技术栈" } });
  const preview = await call("weaver_review_action", { workspaceDir, resource: "layout_run", action: "preview", id: generated.layoutRunId });
  const candidate = preview.candidates.find((item) => item.metrics.hardViolations.length === 0);
  if (!candidate) throw new Error("No valid layout candidate");
  const applied = await call("weaver_review_action", { workspaceDir, resource: "layout_run", action: "apply", id: generated.layoutRunId, candidateId: candidate.id });
  console.log(JSON.stringify({ ok: true, tools: actual.length, project: project.title, nodes: graph.nodes.length, graphRevision: graph.project.graphRevision, layoutRevision: applied.layoutRevision }));
} finally { await client.close().catch(() => {}); rmSync(workspaceDir, { recursive: true, force: true }); }
