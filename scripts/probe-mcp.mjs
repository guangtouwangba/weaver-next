import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import sharp from "sharp";

const workspaceDir = join(tmpdir(), `weaver-mcp-probe-${process.pid}`);
mkdirSync(workspaceDir, { recursive: true });
const transport = new StdioClientTransport({ command: "node", args: ["./scripts/start-mcp.mjs"], cwd: process.cwd(), stderr: "pipe" });
const client = new Client({ name: "weaver-probe", version: "0.1.0" });
const threadId = `weaver-probe-thread-${process.pid}`;
const threadMeta = { threadId, "x-codex-turn-metadata": { thread_id: threadId } };

function data(result) {
  if (result.isError) throw new Error(result.content?.find((item) => item.type === "text")?.text ?? "MCP tool failed");
  const value = result.structuredContent;
  return value && Object.keys(value).length === 1 && Array.isArray(value.items) ? value.items : value;
}

try {
  await client.connect(transport);
  const tools = await client.listTools();
  const required = ["weaver_open_workspace_widget", "weaver_create_project", "weaver_get_or_create_view", "weaver_get_node_content", "weaver_get_asset_metadata", "weaver_import_image_asset", "weaver_create_content_node", "weaver_update_node_content", "weaver_enrich_link", "weaver_sync_canvas_context", "weaver_prepare_agent_task", "weaver_generate_layout_candidates", "weaver_apply_layout", "weaver_revert_layout"];
  for (const name of required) if (!tools.tools.some((tool) => tool.name === name)) throw new Error(`Missing MCP tool ${name}`);
  const resources = await client.listResources();
  const resourceTemplates = await client.listResourceTemplates();
  if (!resources.resources.some((resource) => resource.uri === "ui://widget/weaver/workspace.html")) throw new Error("Missing Weaver widget resource");
  for (const uriTemplate of ["weaver://projects/{projectId}/nodes/{nodeId}/content", "weaver://projects/{projectId}/assets/{assetId}", "weaver://projects/{projectId}/assets/{assetId}/thumbnail"]) if (!resourceTemplates.resourceTemplates.some((resource) => resource.uriTemplate === uriTemplate)) throw new Error(`Missing MCP resource template ${uriTemplate}`);
  const widget = await client.readResource({ uri: "ui://widget/weaver/workspace.html" });
  const widgetHtml = widget.contents.find((content) => "text" in content)?.text ?? "";
  if (!widgetHtml.includes("Weaver Space") || !widgetHtml.includes("<script type=\"module\">")) throw new Error("Widget resource was not bundled inline");

  const project = data(await client.callTool({ name: "weaver_create_project", arguments: { workspaceDir, title: "Probe", goal: "Map a causal question", scenePackId: "causal-map" } }));
  const createdDocument = data(await client.callTool({ name: "weaver_create_content_node", arguments: { workspaceDir, projectId: project.id, viewId: project.defaultViewId, semanticType: "cause", title: "Detailed cause", content: { kind: "document", mode: "article", markdown: "# Full private markdown", excerpt: "Full private markdown", embeddedAssetIds: [] }, x: 320, y: 0 } }));
  const graphAfterDocument = data(await client.callTool({ name: "weaver_get_project_graph", arguments: { workspaceDir, projectId: project.id, viewId: project.defaultViewId } }));
  const documentSummary = graphAfterDocument.nodes.find((node) => node.id === createdDocument.node.id);
  if (documentSummary.content.markdown !== undefined) throw new Error("Graph response leaked full Markdown");
  const fullDocument = data(await client.callTool({ name: "weaver_get_node_content", arguments: { workspaceDir, projectId: project.id, nodeId: createdDocument.node.id } }));
  if (fullDocument.node.content.markdown !== "# Full private markdown") throw new Error("Full node content unavailable");
  const updatedDocument = data(await client.callTool({ name: "weaver_update_node_content", arguments: { workspaceDir, projectId: project.id, nodeId: createdDocument.node.id, baseGraphRevision: graphAfterDocument.project.graphRevision, title: "Updated cause" } }));
  const png = await sharp({ create: { width: 120, height: 80, channels: 4, background: "#315cf6" } }).png().toBuffer();
  const imported = data(await client.callTool({ name: "weaver_import_image_asset", arguments: { workspaceDir, projectId: project.id, mimeType: "image/png", base64: png.toString("base64") } }));
  const duplicate = data(await client.callTool({ name: "weaver_import_image_asset", arguments: { workspaceDir, projectId: project.id, mimeType: "image/png", base64: png.toString("base64") } }));
  if (duplicate.asset.id !== imported.asset.id || !duplicate.deduplicated) throw new Error("Asset deduplication failed");
  const createdImage = data(await client.callTool({ name: "weaver_create_content_node", arguments: { workspaceDir, projectId: project.id, viewId: project.defaultViewId, semanticType: "effect", title: "Visual evidence", content: { kind: "image", assetId: imported.asset.id, alt: "Blue rectangle", caption: "Probe" }, x: 640, y: 0 } }));
  const assetMetadata = data(await client.callTool({ name: "weaver_get_asset_metadata", arguments: { workspaceDir, projectId: project.id, assetId: imported.asset.id } }));
  if (assetMetadata.width !== 120 || createdImage.node.contentKind !== "image" || updatedDocument.node.title !== "Updated cause") throw new Error("Content node workflow failed");
  const graph = data(await client.callTool({ name: "weaver_get_project_graph", arguments: { workspaceDir, projectId: project.id, viewId: project.defaultViewId } }));
  const graphView = data(await client.callTool({ name: "weaver_get_or_create_view", arguments: { workspaceDir, projectId: project.id, viewType: "graph" } }));
  if (graphView.viewId === project.defaultViewId || graphView.layoutRevision !== 0) throw new Error("Independent view was not created");
  const sessionId = "probe-session";
  const opened = data(await client.callTool({ name: "weaver_open_workspace_widget", arguments: { workspaceDir, projectId: project.id }, _meta: threadMeta }));
  const timestamp = new Date().toISOString();
  data(await client.callTool({ name: "weaver_sync_canvas_context", arguments: { workspaceDir, snapshot: { version: 2, canvasSessionId: sessionId, workspaceDir, projectId: project.id, scenePackId: project.scenePackId, scenePackVersion: project.scenePackVersion, graphRevision: graph.project.graphRevision, viewId: project.defaultViewId, viewType: graph.layout.viewType, selectedNodeIds: graph.nodes.map((node) => node.id), selectedEdgeIds: [], selectedGroupIds: [], pinnedContextNodeIds: [], viewport: { x: 0, y: 0, zoom: 1 }, presence: { visible: true, focused: true, lastSeenAt: timestamp }, chatBinding: opened.chatBinding, agentEligible: true, sequence: 1, updatedAt: timestamp } }, _meta: threadMeta }));
  const task = data(await client.callTool({ name: "weaver_prepare_task_from_active_canvas", arguments: { workspaceDir, actionKey: "layout_view", userInstruction: "Arrange causes left to right" }, _meta: threadMeta }));
  data(await client.callTool({ name: "weaver_start_agent_task", arguments: { workspaceDir, taskId: task.taskId }, _meta: threadMeta }));
  const generated = data(await client.callTool({ name: "weaver_generate_layout_candidates", arguments: { workspaceDir, taskId: task.taskId, plan: { projectId: project.id, viewId: project.defaultViewId, baseGraphRevision: graph.project.graphRevision, baseLayoutRevision: graph.layout.layoutRevision, scope: { type: "whole-view" }, strategy: "layered", direction: "left-right", constraints: [{ type: "avoid-overlap", nodeIds: [], edgeIds: [], edgeTypes: [], strength: 1 }], preserve: { pinnedNodes: true, manualGroups: true, relativeOrder: true, mentalMapWeight: 0.7 }, candidateCount: 3, rationale: "Causal direction" } }, _meta: threadMeta }));
  const run = data(await client.callTool({ name: "weaver_get_layout_run", arguments: { workspaceDir, layoutRunId: generated.layoutRunId }, _meta: threadMeta }));
  const valid = run.candidates.find((candidate) => candidate.metrics.hardViolations.length === 0);
  if (!valid) throw new Error("No valid layout candidate");
  const applied = data(await client.callTool({ name: "weaver_apply_layout", arguments: { workspaceDir, layoutRunId: run.id, candidateId: valid.id }, _meta: threadMeta }));
  if (applied.layoutRevision !== graph.layout.layoutRevision + 1) throw new Error("layoutRevision did not increment");
  const current = data(await client.callTool({ name: "weaver_get_project_graph", arguments: { workspaceDir, projectId: project.id, viewId: project.defaultViewId } }));
  if (current.project.graphRevision !== graph.project.graphRevision) throw new Error("layout changed graphRevision");
  console.log(JSON.stringify({ ok: true, tools: tools.tools.length, resources: resources.resources.length, candidates: run.candidates.length, contentKinds: [...new Set(current.nodes.map((node) => node.contentKind))], graphRevision: current.project.graphRevision, layoutRevision: current.layout.layoutRevision }));
} finally {
  await client.close().catch(() => {});
  rmSync(workspaceDir, { recursive: true, force: true });
}
