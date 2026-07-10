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
  for (const [edgeId, edge] of Object.entries(after.edges)) {
    const previous = before.edges[edgeId];
    if (JSON.stringify(previous) !== JSON.stringify(edge)) operations.push({ type: "set-edge-route", viewId: after.viewId, edgeId, route: edge });
  }
  if (JSON.stringify(before.config) !== JSON.stringify(after.config)) operations.push({ type: "set-layout-config", viewId: after.viewId, config: after.config });
  return operations;
}
