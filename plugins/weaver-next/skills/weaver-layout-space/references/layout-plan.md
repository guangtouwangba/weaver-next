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

Mappings:

- "不要移动这些节点" -> `pin` constraint plus `preserve.pinnedNodes=true`.
- "从左到右" -> `direction=left-right`.
- "按主题分组" -> `strategy=cluster` plus `group` constraints.
- "减少交叉线" -> `edge-routing` and `avoid-overlap` constraints; prefer layered for directed graphs.
- "主结论放中间" -> `emphasis` constraint and radial/hybrid strategy.
- "只整理选中的" -> selection scope. Never widen it silently.
