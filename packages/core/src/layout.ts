import type { LayoutDocument, LayoutOperation } from "@weaver/contracts";

export function applyLayoutOperations(document: LayoutDocument, operations: LayoutOperation[], nextRevision = document.layoutRevision + 1): LayoutDocument {
  const next = structuredClone(document);
  for (const operation of operations) {
    if (operation.viewId !== document.viewId) throw new Error(`LAYOUT_VIEW_MISMATCH:${operation.viewId}`);
    switch (operation.type) {
      case "set-node-frame": {
        const node = next.nodes[operation.nodeId];
        if (!node) throw new Error(`LAYOUT_NODE_NOT_FOUND:${operation.nodeId}`);
        Object.assign(node, operation.frame);
        break;
      }
      case "pin-node":
      case "unpin-node": {
        const node = next.nodes[operation.nodeId];
        if (!node) throw new Error(`LAYOUT_NODE_NOT_FOUND:${operation.nodeId}`);
        node.pinned = operation.type === "pin-node";
        break;
      }
      case "set-node-visibility":
        next.nodes[operation.nodeId].hidden = operation.hidden;
        break;
      case "set-node-collapsed":
        next.nodes[operation.nodeId].collapsed = operation.collapsed;
        break;
      case "set-node-z-index":
        next.nodes[operation.nodeId].zIndex = operation.zIndex;
        break;
      case "assign-node-to-group":
        next.nodes[operation.nodeId].groupId = operation.groupId ?? undefined;
        break;
      case "set-group-frame":
        next.groups[operation.groupId] = { ...(next.groups[operation.groupId] ?? { groupId: operation.groupId, padding: 32, collapsed: false }), ...operation.frame };
        break;
      case "set-group-direction":
        if (!next.groups[operation.groupId]) throw new Error(`LAYOUT_GROUP_NOT_FOUND:${operation.groupId}`);
        next.groups[operation.groupId].direction = operation.direction;
        break;
      case "set-node-rank":
        next.nodes[operation.nodeId].rank = operation.rank;
        break;
      case "set-node-lane":
        next.nodes[operation.nodeId].laneId = operation.laneId ?? undefined;
        break;
      case "set-edge-route":
        next.edges[operation.edgeId] = operation.route;
        break;
      case "set-layout-config":
        next.config = operation.config;
        break;
      case "set-viewport-preset":
        break;
      case "set-view-name":
        next.viewName = operation.viewName;
        break;
      case "set-view-projection":
        next.projection = operation.projection;
        break;
      case "set-view-theme":
        next.theme = operation.theme;
        break;
    }
  }
  next.layoutRevision = nextRevision;
  next.updatedAt = new Date().toISOString();
  return next;
}

export function diffLayoutDocuments(before: LayoutDocument, after: LayoutDocument): LayoutOperation[] {
  const operations: LayoutOperation[] = [];
  for (const [nodeId, node] of Object.entries(after.nodes)) {
    const previous = before.nodes[nodeId];
    if (!previous || previous.x !== node.x || previous.y !== node.y || previous.width !== node.width || previous.height !== node.height) {
      operations.push({ type: "set-node-frame", viewId: after.viewId, nodeId, frame: { x: node.x, y: node.y, width: node.width, height: node.height } });
    }
  }
  for (const [nodeId, node] of Object.entries(after.nodes)) {
    const previous = before.nodes[nodeId];
    if ((previous?.groupId ?? undefined) !== (node.groupId ?? undefined)) {
      operations.push({ type: "assign-node-to-group", viewId: after.viewId, nodeId, groupId: node.groupId ?? null });
    }
  }
  // Group boxes. Deletions are not representable as an operation (there is no
  // remove-group in the union) — acceptable because applyLayoutCandidate persists
  // the whole document, so the group set is authoritative; these ops only enrich
  // the audit/event stream.
  for (const [groupId, group] of Object.entries(after.groups)) {
    const previous = before.groups[groupId];
    if (!previous || previous.x !== group.x || previous.y !== group.y || previous.width !== group.width || previous.height !== group.height) {
      operations.push({ type: "set-group-frame", viewId: after.viewId, groupId, frame: { x: group.x, y: group.y, width: group.width, height: group.height } });
    }
  }
  for (const [edgeId, edge] of Object.entries(after.edges)) {
    const previous = before.edges[edgeId];
    if (JSON.stringify(previous) !== JSON.stringify(edge)) operations.push({ type: "set-edge-route", viewId: after.viewId, edgeId, route: edge });
  }
  if (JSON.stringify(before.config) !== JSON.stringify(after.config)) operations.push({ type: "set-layout-config", viewId: after.viewId, config: after.config });
  if (before.viewName !== after.viewName) operations.push({ type: "set-view-name", viewId: after.viewId, viewName: after.viewName });
  if (JSON.stringify(before.projection) !== JSON.stringify(after.projection)) operations.push({ type: "set-view-projection", viewId: after.viewId, projection: after.projection });
  if (JSON.stringify(before.theme) !== JSON.stringify(after.theme)) operations.push({ type: "set-view-theme", viewId: after.viewId, theme: after.theme });
  return operations;
}
