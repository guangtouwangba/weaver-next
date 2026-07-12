# LayoutPlan contract

Use the task's exact project, view, graph revision, and layout revision.

```json
{
  "projectId": "project-id",
  "viewId": "graph-default",
  "baseGraphRevision": 3,
  "baseLayoutRevision": 2,
  "scope": { "type": "selection", "nodeIds": ["node-a", "node-b"] },
  "strategy": "cluster",
  "direction": "left-right",
  "constraints": [
    { "type": "avoid-overlap", "nodeIds": [], "edgeIds": [], "edgeTypes": [], "strength": 1 },
    { "type": "emphasis", "nodeIds": ["node-a"], "edgeIds": [], "edgeTypes": [], "strength": 1 }
  ],
  "preserve": {
    "pinnedNodes": true,
    "manualGroups": true,
    "relativeOrder": true,
    "mentalMapWeight": 0.7
  },
  "candidateCount": 3,
  "rationale": "Group related nodes while keeping the selected anchor prominent."
}
```

## Choosing a `strategy` from the graph's shape

There is no recommend-layout tool. Pick the `strategy` yourself by reading the task's graph (`weaver_read_graph(resource:"full")`) and looking at these signals, in this priority order — the first match wins:

1. **Goal says timeline** (时间线 / 时间轴 / 历史 / chronology) → `strategy:"timeline"` (arrange by the time field horizontally).
2. **Goal says flow / process / causal** (流程 / pipeline / 因果 / 工作流 / 工序 / cause) → `strategy:"layered"` with `direction:"left-right"` (directed layers, left→right).
3. **No edges** (edge count 0) → `strategy:"grid"` (no structure to exploit; use a tidy grid).
4. **Distinct layers** — nodes carry a `properties.layer` value and at least 2 distinct layers each have ≥2 nodes → `strategy:"cluster"` (semantic partitions show information layering and inter-cluster whitespace). The same applies if you can already see clear thematic groupings in the node titles/types yourself — but do not try to run a clustering algorithm; the deterministic engine forms the actual clusters.
5. **Star / hub shape** — one node's degree is high (≥3) and at least twice the median positive degree → `strategy:"cluster"`, and add an `emphasis` constraint on that hub node so it sits at the center with satellites around it.
6. **Otherwise** (flat, no clear layering or hub) → `strategy:"grid"`.

Signals to compute from the graph data you can read: node/edge counts, per-node degree (max and median over nodes with degree>0), the top-degree node id, and `properties.layer` coverage (how many distinct layers have ≥2 nodes). All of these are derivable from `weaver_read_graph(resource:"full")` alone. `cluster` needs no coordinates from you — the deterministic engine forms the clusters; you only set the strategy, direction, and any `emphasis`/`group` constraints. When unsure between `cluster` and `grid`, prefer `cluster` if any structure exists (edges, layers, or an obvious hub) and `grid` only when the graph is flat and edgeless.

## Mappings

- "不要移动这些节点" -> `pin` constraint plus `preserve.pinnedNodes=true`.
- "从左到右" -> `direction=left-right`.
- "按主题分组" -> `strategy=cluster` plus `group` constraints.
- "减少交叉线" -> `edge-routing` and `avoid-overlap` constraints; prefer layered for directed graphs.
- "主结论放中间" -> `emphasis` constraint and radial/hybrid strategy.
- "只整理选中的" -> selection scope. Never widen it silently.
