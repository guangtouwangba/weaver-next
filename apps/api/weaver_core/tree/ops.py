from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass

from weaver_core.schemas.node import NodeForest, NodeKind, NodeStatus, ThoughtNode
from weaver_core.tree.validate import InvalidTreeError, validate_forest


@dataclass(frozen=True)
class NodeSpec:
    title: str
    body: str
    tag: str = "THOUGHT"
    kind: NodeKind = "user_thought"
    annotation: str | None = None


def add_root(forest: NodeForest, spec: NodeSpec, *, new_id: Callable[[], str]) -> tuple[NodeForest, ThoughtNode]:
    node = ThoughtNode(
        id=new_id(),
        project_id=forest.project_id,
        parent_id=None,
        title=spec.title,
        body=spec.body,
        annotation=spec.annotation,
        order_index=_next_root_order_index(forest),
        tag=spec.tag,
        kind=spec.kind,
    )
    next_forest = forest.with_node(node)
    validate_forest(next_forest)
    return next_forest, node


def fork(
    forest: NodeForest,
    parent_node_id: str,
    specs: list[NodeSpec],
    *,
    new_id: Callable[[], str],
) -> tuple[NodeForest, list[ThoughtNode]]:
    if parent_node_id not in forest.nodes:
        raise InvalidTreeError("NODE_NOT_FOUND")
    parent = forest.nodes[parent_node_id]
    next_order = _next_order_index(forest, parent_node_id)
    created = [
        ThoughtNode(
            id=new_id(),
            project_id=forest.project_id,
            parent_id=parent.id,
            title=spec.title,
            body=spec.body,
            annotation=spec.annotation,
            order_index=next_order + offset,
            tag=spec.tag,
            kind=spec.kind,
        )
        for offset, spec in enumerate(specs)
    ]
    next_forest = forest.with_nodes(created)
    validate_forest(next_forest)
    return next_forest, created


def backtrack(forest: NodeForest, node_id: str) -> list[str]:
    return forest.branch_of(node_id).node_ids


def prune(forest: NodeForest, node_id: str) -> NodeForest:
    return _set_subtree_state(forest, node_id, status="dead_end", collapsed=True)


def unprune(forest: NodeForest, node_id: str) -> NodeForest:
    return _set_subtree_state(forest, node_id, status="open", collapsed=False)


def set_collapsed(forest: NodeForest, node_id: str, collapsed: bool) -> NodeForest:
    if node_id not in forest.nodes:
        raise InvalidTreeError("NODE_NOT_FOUND")
    node = forest.nodes[node_id].model_copy(update={"collapsed": collapsed})
    next_forest = forest.with_node(node)
    validate_forest(next_forest)
    return next_forest


def set_state(forest: NodeForest, node_id: str, status: NodeStatus) -> NodeForest:
    if node_id not in forest.nodes:
        raise InvalidTreeError("NODE_NOT_FOUND")
    current = forest.nodes[node_id]
    if current.status == "dead_end" and status == "promising":
        raise InvalidTreeError("ILLEGAL_STATE_TRANSITION")
    node = current.model_copy(update={"status": status})
    next_forest = forest.with_node(node)
    validate_forest(next_forest)
    return next_forest


def _set_subtree_state(forest: NodeForest, node_id: str, *, status: NodeStatus, collapsed: bool) -> NodeForest:
    if node_id not in forest.nodes:
        raise InvalidTreeError("NODE_NOT_FOUND")
    update_ids = [node_id, *forest.descendants(node_id)]
    updates = [
        forest.nodes[current_id].model_copy(update={"status": status, "collapsed": collapsed})
        for current_id in update_ids
    ]
    next_forest = forest.with_nodes(updates)
    validate_forest(next_forest)
    return next_forest


def _next_order_index(forest: NodeForest, parent_node_id: str) -> int:
    child_ids = forest.children.get(parent_node_id, [])
    if not child_ids:
        return 0
    return max(forest.nodes[child_id].order_index for child_id in child_ids) + 1


def _next_root_order_index(forest: NodeForest) -> int:
    if not forest.roots:
        return 0
    return max(forest.nodes[root_id].order_index for root_id in forest.roots) + 1
