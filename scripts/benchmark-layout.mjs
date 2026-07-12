import { performance } from "node:perf_hooks";
import { generateLayoutCandidates } from "../packages/layout-engine/dist/engine.js";

const timestamp = "2026-07-10T00:00:00.000Z";

function fixture(count) {
  const nodes = Array.from({ length: count }, (_, index) => ({
    id: `n-${index}`, projectId: "benchmark", type: index ? "idea" : "root", title: `Node ${index}`,
    contentKind: "document", content: { kind: "document", mode: "note", markdown: "", excerpt: "", embeddedAssetIds: [] }, properties: {}, archived: false, createdAt: timestamp, updatedAt: timestamp,
  }));
  const edges = nodes.slice(1).map((node, index) => ({
    id: `e-${index}`, projectId: "benchmark", type: "branch", sourceNodeId: nodes[Math.floor(index / 2)].id,
    targetNodeId: node.id, directed: true, properties: {}, archived: false, createdAt: timestamp, updatedAt: timestamp,
  }));
  const current = {
    projectId: "benchmark", viewId: "graph-default", viewType: "graph", graphRevision: 1, layoutRevision: 0, strategy: "grid",
    config: { direction: "left-right", nodeSpacing: 48, rankSpacing: 96, density: 1, viewportWidth: 1280, viewportHeight: 800 },
    nodes: Object.fromEntries(nodes.map((node) => [node.id, { nodeId: node.id, x: 0, y: 0, width: 180, height: 90, rotation: 0, zIndex: 0, pinned: false, hidden: false, collapsed: false }])),
    edges: {}, groups: {}, bounds: { x: 0, y: 0, width: 0, height: 0 }, createdBy: "user", updatedAt: timestamp,
  };
  const plan = { projectId: "benchmark", viewId: "graph-default", baseGraphRevision: 1, baseLayoutRevision: 0,
    scope: { type: "whole-view" }, strategy: "grid", constraints: [{ type: "avoid-overlap", nodeIds: [], edgeIds: [], edgeTypes: [], strength: 1 }],
    preserve: { pinnedNodes: true, manualGroups: true, relativeOrder: true, mentalMapWeight: 0.5 }, candidateCount: 1, rationale: "Scale probe" };
  return { nodes, edges, current, plan, layoutRunId: `benchmark-${count}` };
}

const results = [];
for (const count of [100, 500, 2000]) {
  const input = fixture(count);
  const startedAt = performance.now();
  const [candidate] = await generateLayoutCandidates(input);
  const durationMs = Math.round((performance.now() - startedAt) * 10) / 10;
  if (Object.keys(candidate.document.nodes).length !== count) throw new Error(`Lost nodes at ${count}`);
  if (candidate.metrics.overlapCount !== 0) throw new Error(`Overlap at ${count}`);
  results.push({ nodes: count, edges: input.edges.length, durationMs, score: candidate.metrics.score });
}
console.log(JSON.stringify(results, null, 2));

const mixed = fixture(100);
mixed.nodes = mixed.nodes.map((node, index) => index < 50
  ? { ...node, contentKind: "image", content: { kind: "image", assetId: `asset-${index}`, alt: "", caption: "" } }
  : index < 75
    ? { ...node, contentKind: "link", content: { kind: "link", url: `https://example.com/${index}`, title: node.title, description: "", domain: "example.com", enrichmentStatus: "ready" } }
    : node);
mixed.current.nodes = Object.fromEntries(mixed.nodes.map((node, index) => [node.id, { nodeId: node.id, x: 0, y: 0, width: node.contentKind === "image" ? 320 : node.contentKind === "link" ? 300 : 280, height: node.contentKind === "image" ? 220 : node.contentKind === "link" ? 180 : 160, rotation: 0, zIndex: 0, pinned: false, hidden: false, collapsed: false }]));
const mixedStartedAt = performance.now();
const [mixedCandidate] = await generateLayoutCandidates({ ...mixed, layoutRunId: "benchmark-mixed-content" });
if (mixedCandidate.metrics.overlapCount !== 0 || Object.keys(mixedCandidate.document.nodes).length !== 100 || mixed.nodes.filter((node) => node.contentKind === "image").length !== 50) throw new Error("Mixed content benchmark failed");
console.log(JSON.stringify({ mixedNodes: 100, imageNodes: 50, durationMs: Math.round((performance.now() - mixedStartedAt) * 10) / 10, overlapCount: mixedCandidate.metrics.overlapCount }, null, 2));
