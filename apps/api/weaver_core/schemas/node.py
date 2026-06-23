from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


NodeStatus = Literal["open", "promising", "dead_end"]
NodeKind = Literal["question_answer", "ai_reasoning", "user_thought"]
ContextRole = Literal["system", "user", "assistant", "tool"]


class ThoughtNode(BaseModel):
    id: str
    project_id: str
    parent_id: str | None
    title: str
    body: str
    annotation: str | None = None
    status: NodeStatus = "open"
    order_index: int = 0
    tag: str = "THOUGHT"
    kind: NodeKind = "user_thought"
    collapsed: bool = False
    x: int = 50
    y: int = 20


class ContextMessage(BaseModel):
    node_id: str
    title: str
    body: str
    annotation: str | None = None
    kind: NodeKind = "user_thought"
    role: ContextRole = "user"
    provenance: dict[str, str] = Field(default_factory=dict)


class BranchContext(BaseModel):
    target_node_id: str
    chain: list[ContextMessage]
    excluded_dead_end_ids: list[str]
    grounding_enabled: bool
    policy_fingerprint: str


class Branch(BaseModel):
    head_node_id: str
    node_ids: list[str]
    depth: int


class NodeForest(BaseModel):
    project_id: str
    nodes: dict[str, ThoughtNode]
    children: dict[str, list[str]]
    roots: list[str]

    def branch_of(self, node_id: str) -> Branch:
        if node_id not in self.nodes:
            raise KeyError(node_id)
        node_ids: list[str] = []
        seen: set[str] = set()
        cursor_id: str | None = node_id
        while cursor_id:
            if cursor_id in seen:
                raise ValueError("CYCLE_DETECTED")
            seen.add(cursor_id)
            node_ids.append(cursor_id)
            parent_id = self.nodes[cursor_id].parent_id
            cursor_id = parent_id if parent_id in self.nodes else None
        node_ids.reverse()
        return Branch(head_node_id=node_id, node_ids=node_ids, depth=max(len(node_ids) - 1, 0))

    def descendants(self, node_id: str) -> list[str]:
        result: list[str] = []
        stack = list(self.children.get(node_id, []))
        while stack:
            current = stack.pop(0)
            result.append(current)
            stack[0:0] = self.children.get(current, [])
        return result

    def with_node(self, node: ThoughtNode) -> "NodeForest":
        return self.with_nodes([node])

    def with_nodes(self, nodes: list[ThoughtNode]) -> "NodeForest":
        merged = list(self.nodes.values())
        replacement_ids = {node.id for node in nodes}
        merged = [node for node in merged if node.id not in replacement_ids]
        merged.extend(nodes)
        return NodeForest.build(self.project_id, merged)

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
