from __future__ import annotations

from collections import Counter

from weaver_core.schemas.node import NodeForest


class InvalidTreeError(ValueError):
    pass


def validate_forest(forest: NodeForest) -> None:
    for node in forest.nodes.values():
        if node.project_id != forest.project_id:
            raise InvalidTreeError("NODE_PROJECT_MISMATCH")
        if node.parent_id is not None and node.parent_id not in forest.nodes:
            raise InvalidTreeError("MISSING_PARENT")
        if node.parent_id is not None and forest.nodes[node.parent_id].project_id != node.project_id:
            raise InvalidTreeError("PARENT_PROJECT_MISMATCH")

    for parent_id, child_ids in forest.children.items():
        orders = [forest.nodes[child_id].order_index for child_id in child_ids]
        duplicates = [order for order, count in Counter(orders).items() if count > 1]
        if duplicates:
            raise InvalidTreeError(f"DUPLICATE_ORDER_INDEX:{parent_id}:{duplicates[0]}")

    for node_id in forest.nodes:
        forest.branch_of(node_id)
