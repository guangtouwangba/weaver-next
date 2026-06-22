from __future__ import annotations

from pydantic import BaseModel


class ThoughtNode(BaseModel):
    id: str
    project_id: str
    parent_id: str | None
    title: str
    body: str
    status: str = "open"
    order_index: int = 0
    tag: str = "THOUGHT"
    x: int = 50
    y: int = 20


class ContextMessage(BaseModel):
    node_id: str
    title: str
    body: str


class BranchContext(BaseModel):
    target_node_id: str
    chain: list[ContextMessage]
    excluded_dead_end_ids: list[str]
    grounding_enabled: bool
    policy_fingerprint: str


class NodeForest(BaseModel):
    project_id: str
    nodes: dict[str, ThoughtNode]
    children: dict[str, list[str]]
    roots: list[str]

    @classmethod
    def build(cls, project_id: str, nodes: list[ThoughtNode]) -> "NodeForest":
        node_map = {node.id: node for node in nodes if node.project_id == project_id}
        children: dict[str, list[str]] = {node_id: [] for node_id in node_map}
        roots: list[str] = []
        for node in node_map.values():
            if node.parent_id and node.parent_id in node_map:
                children[node.parent_id].append(node.id)
            else:
                roots.append(node.id)

        def sort_key(node_id: str) -> tuple[int, str]:
            node = node_map[node_id]
            return (node.order_index, node.id)

        for child_ids in children.values():
            child_ids.sort(key=sort_key)
        roots.sort(key=sort_key)
        return cls(project_id=project_id, nodes=node_map, children=children, roots=roots)
