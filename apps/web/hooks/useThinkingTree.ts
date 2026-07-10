import { useEffect, useState } from "react";
import { fallbackForest, withNodeDefaults } from "../lib/fallback-data";
import {
  BranchContext,
  ForestView,
  ForkProposal,
  createNode,
  fetchForest,
  fetchNodeContext,
  forkNode,
  proposeForks
} from "../lib/api";

export function useThinkingTree() {
  const [forest, setForest] = useState<ForestView>(fallbackForest);
  const [focusedNodeId, setFocusedNodeId] = useState("node_demand");
  const [context, setContext] = useState<BranchContext | null>(null);
  const [proposals, setProposals] = useState<ForkProposal[]>([]);
  const [treeStatus, setTreeStatus] = useState<"loading" | "live" | "offline">("loading");
  const [composerText, setComposerText] = useState("");

  const focusedNode = forest.nodes.find((node) => node.id === focusedNodeId) ?? forest.nodes[0];

  useEffect(() => {
    void loadForest();
  }, []);

  useEffect(() => {
    if (!focusedNode?.id) return;
    void loadContextAndProposals(focusedNode.id);
  }, [focusedNode?.id]);

  async function loadForest(focusId = focusedNodeId) {
    try {
      const nextForest = await fetchForest("proj_subscription_fatigue");
      setForest(nextForest);
      setFocusedNodeId(focusId || nextForest.focused_node_id || nextForest.roots[0] || "node_root");
      setTreeStatus("live");
    } catch {
      setForest(fallbackForest);
      setTreeStatus("offline");
    }
  }

  async function loadContextAndProposals(nodeId: string) {
    try {
      const [nextContext, nextProposals] = await Promise.all([
        fetchNodeContext(nodeId),
        proposeForks(nodeId)
      ]);
      setContext(nextContext);
      setProposals(nextProposals.proposals);
      setTreeStatus("live");
    } catch {
      setContext({
        target_node_id: nodeId,
        chain: [
          {
            node_id: "node_root",
            title: "Is subscription fatigue actually killing independent media?",
            body: "Root question.",
            kind: "user_thought",
            role: "user",
            provenance: { node_id: "node_root" }
          },
          {
            node_id: nodeId,
            title: focusedNode?.title ?? "Focused branch",
            body: focusedNode?.body ?? "",
            kind: "user_thought",
            role: "user",
            provenance: { node_id: nodeId }
          }
        ],
        excluded_dead_end_ids: [],
        grounding_enabled: false,
        policy_fingerprint: "offline"
      });
      setProposals([
        {
          title: "Pressure-test this branch",
          prompt: "What evidence would make this branch false?",
          suggested_label: "COUNTERPOINT"
        },
        {
          title: "Split the next assumption",
          prompt: "What should be separated before drafting from this branch?",
          suggested_label: "FORK"
        }
      ]);
      setTreeStatus("offline");
    }
  }

  async function acceptProposal(proposal: ForkProposal) {
    try {
      const created = await forkNode(focusedNode.id, proposal);
      const createdId = created[0]?.id ?? focusedNode.id;
      await loadForest(createdId);
      setFocusedNodeId(createdId);
    } catch {
      const localId = `local_node_${Date.now()}`;
      setForest((current) => ({
        ...current,
        focused_node_id: localId,
        children: {
          ...current.children,
          [focusedNode.id]: [...(current.children[focusedNode.id] ?? []), localId],
          [localId]: []
        },
        nodes: [
          ...current.nodes,
          withNodeDefaults({
            id: localId,
            project_id: focusedNode.project_id,
            parent_id: focusedNode.id,
            title: proposal.title,
            body: proposal.prompt,
            status: "open",
            order_index: (current.children[focusedNode.id] ?? []).length,
            tag: proposal.suggested_label,
            x: Math.min(90, focusedNode.x + 14),
            y: Math.min(72, focusedNode.y + 18)
          })
        ]
      }));
      setFocusedNodeId(localId);
      setTreeStatus("offline");
    }
  }

  async function addComposerNode() {
    const text = composerText.trim();
    if (!text || !focusedNode) return;
    setComposerText("");
    try {
      const created = await createNode(focusedNode.project_id, {
        parent_id: focusedNode.id,
        title: text,
        body: text,
        tag: "USER THOUGHT",
        kind: "user_thought"
      });
      await loadForest(created.id);
      setFocusedNodeId(created.id);
      setTreeStatus("live");
    } catch {
      const localId = `local_node_${Date.now()}`;
      setForest((current) => ({
        ...current,
        focused_node_id: localId,
        children: {
          ...current.children,
          [focusedNode.id]: [...(current.children[focusedNode.id] ?? []), localId],
          [localId]: []
        },
        nodes: [
          ...current.nodes,
          withNodeDefaults({
            id: localId,
            project_id: focusedNode.project_id,
            parent_id: focusedNode.id,
            title: text,
            body: text,
            status: "open",
            order_index: (current.children[focusedNode.id] ?? []).length,
            tag: "USER THOUGHT",
            x: Math.min(90, focusedNode.x + 14),
            y: Math.min(72, focusedNode.y + 18)
          })
        ]
      }));
      setFocusedNodeId(localId);
      setTreeStatus("offline");
    }
  }

  const edgePaths = forest.nodes
    .filter((node) => node.parent_id)
    .map((node) => {
      const parent = forest.nodes.find((candidate) => candidate.id === node.parent_id);
      if (!parent) return null;
      const midY = (parent.y + node.y) / 2;
      return {
        id: `${parent.id}-${node.id}`,
        active: node.id === focusedNodeId || parent.id === focusedNodeId,
        d: `M${parent.x} ${parent.y + 8} C${parent.x} ${midY} ${node.x} ${midY} ${node.x} ${node.y}`
      };
    })
    .filter(Boolean) as Array<{ id: string; active: boolean; d: string }>;
  const branchCount = forest.nodes.filter((node) => (forest.children[node.id] ?? []).length === 0).length;

  return {
    forest,
    focusedNodeId,
    setFocusedNodeId,
    focusedNode,
    context,
    proposals,
    treeStatus,
    composerText,
    setComposerText,
    acceptProposal,
    addComposerNode,
    edgePaths,
    branchCount
  };
}
