import { nodeSchema, type GraphOperation, type SpaceEdge, type SpaceNode } from "@weaver/contracts";

export interface GraphSnapshot {
  projectId: string;
  revision: number;
  nodes: SpaceNode[];
  edges: SpaceEdge[];
}

export function applyGraphOperations(snapshot: GraphSnapshot, operations: GraphOperation[]): GraphSnapshot {
  const nodes = new Map(snapshot.nodes.map((node) => [node.id, structuredClone(node)]));
  const edges = new Map(snapshot.edges.map((edge) => [edge.id, structuredClone(edge)]));
  let changed = false;

  for (const operation of operations) {
    switch (operation.type) {
      case "add-node": {
        if (operation.node.projectId !== snapshot.projectId) throw new Error("CROSS_PROJECT_NODE");
        if (nodes.has(operation.node.id)) throw new Error(`NODE_ALREADY_EXISTS:${operation.node.id}`);
        nodes.set(operation.node.id, operation.node);
        changed = true;
        break;
      }
      case "update-node": {
        const current = nodes.get(operation.nodeId);
        if (!current) throw new Error(`NODE_NOT_FOUND:${operation.nodeId}`);
        nodes.set(operation.nodeId, nodeSchema.parse({ ...current, ...operation.patch, id: current.id, projectId: current.projectId }));
        changed = true;
        break;
      }
      case "set-node-content": {
        const current = nodes.get(operation.nodeId);
        if (!current) throw new Error(`NODE_NOT_FOUND:${operation.nodeId}`);
        nodes.set(operation.nodeId, { ...current, contentKind: operation.content.kind, content: operation.content, updatedAt: new Date().toISOString() });
        changed = true;
        break;
      }
      case "attach-asset": {
        const current = nodes.get(operation.nodeId);
        if (!current) throw new Error(`NODE_NOT_FOUND:${operation.nodeId}`);
        if (current.content.kind !== "document") throw new Error("ASSET_ATTACH_REQUIRES_DOCUMENT");
        const content = operation.role === "cover"
          ? { ...current.content, coverAssetId: operation.assetId }
          : { ...current.content, embeddedAssetIds: [...new Set([...current.content.embeddedAssetIds, operation.assetId])] };
        nodes.set(operation.nodeId, { ...current, content, updatedAt: new Date().toISOString() });
        changed = true;
        break;
      }
      case "detach-asset": {
        const current = nodes.get(operation.nodeId);
        if (!current) throw new Error(`NODE_NOT_FOUND:${operation.nodeId}`);
        if (current.content.kind !== "document") throw new Error("ASSET_DETACH_REQUIRES_DOCUMENT");
        const content = { ...current.content, coverAssetId: current.content.coverAssetId === operation.assetId ? undefined : current.content.coverAssetId, embeddedAssetIds: current.content.embeddedAssetIds.filter((id) => id !== operation.assetId) };
        nodes.set(operation.nodeId, { ...current, content, updatedAt: new Date().toISOString() });
        changed = true;
        break;
      }
      case "set-node-cover": {
        const current = nodes.get(operation.nodeId);
        if (!current) throw new Error(`NODE_NOT_FOUND:${operation.nodeId}`);
        if (current.content.kind !== "document") throw new Error("NODE_COVER_REQUIRES_DOCUMENT");
        nodes.set(operation.nodeId, { ...current, content: { ...current.content, coverAssetId: operation.assetId ?? undefined }, updatedAt: new Date().toISOString() });
        changed = true;
        break;
      }
      case "archive-node": {
        const current = nodes.get(operation.nodeId);
        if (!current) throw new Error(`NODE_NOT_FOUND:${operation.nodeId}`);
        nodes.set(operation.nodeId, { ...current, archived: true, updatedAt: new Date().toISOString() });
        for (const [edgeId, edge] of edges) {
          if (edge.sourceNodeId === operation.nodeId || edge.targetNodeId === operation.nodeId) {
            edges.set(edgeId, { ...edge, archived: true, updatedAt: new Date().toISOString() });
          }
        }
        changed = true;
        break;
      }
      case "add-edge": {
        if (operation.edge.projectId !== snapshot.projectId) throw new Error("CROSS_PROJECT_EDGE");
        if (!nodes.has(operation.edge.sourceNodeId) || !nodes.has(operation.edge.targetNodeId)) throw new Error("EDGE_NODE_NOT_FOUND");
        if (operation.edge.sourceNodeId === operation.edge.targetNodeId) throw new Error("SELF_EDGE");
        if (edges.has(operation.edge.id)) throw new Error(`EDGE_ALREADY_EXISTS:${operation.edge.id}`);
        edges.set(operation.edge.id, operation.edge);
        changed = true;
        break;
      }
      case "update-edge": {
        const current = edges.get(operation.edgeId);
        if (!current) throw new Error(`EDGE_NOT_FOUND:${operation.edgeId}`);
        edges.set(operation.edgeId, { ...current, ...operation.patch, id: current.id, projectId: current.projectId });
        changed = true;
        break;
      }
      case "archive-edge": {
        const current = edges.get(operation.edgeId);
        if (!current) throw new Error(`EDGE_NOT_FOUND:${operation.edgeId}`);
        edges.set(operation.edgeId, { ...current, archived: true, updatedAt: new Date().toISOString() });
        changed = true;
        break;
      }
      case "create-artifact":
        changed = true;
        break;
    }
  }

  return {
    projectId: snapshot.projectId,
    revision: changed ? snapshot.revision + 1 : snapshot.revision,
    nodes: [...nodes.values()],
    edges: [...edges.values()],
  };
}
