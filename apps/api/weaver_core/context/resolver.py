from __future__ import annotations

from hashlib import sha256

from weaver_core.schemas.node import BranchContext, ContextMessage, NodeForest


class NodeNotFoundError(ValueError):
    pass


def resolve_branch_context(
    target_node_id: str,
    forest: NodeForest,
    *,
    grounding_enabled: bool = False,
    include_dead_ends: bool = False,
) -> BranchContext:
    if target_node_id not in forest.nodes:
        raise NodeNotFoundError(target_node_id)

    excluded_dead_end_ids = sorted(
        node.id for node in forest.nodes.values() if node.status == "dead_end"
    )
    chain_ids: list[str] = []
    cursor_id: str | None = target_node_id

    while cursor_id:
        node = forest.nodes[cursor_id]
        if include_dead_ends or node.status != "dead_end":
            chain_ids.append(cursor_id)
        cursor_id = node.parent_id if node.parent_id in forest.nodes else None

    chain_ids.reverse()
    chain = [
        ContextMessage(
            node_id=node_id,
            title=forest.nodes[node_id].title,
            body=forest.nodes[node_id].body,
        )
        for node_id in chain_ids
    ]
    fingerprint_input = "|".join(
        [
            target_node_id,
            ",".join(chain_ids),
            ",".join(excluded_dead_end_ids),
            f"grounding={grounding_enabled}",
            f"dead_ends={include_dead_ends}",
        ]
    )
    return BranchContext(
        target_node_id=target_node_id,
        chain=chain,
        excluded_dead_end_ids=excluded_dead_end_ids,
        grounding_enabled=grounding_enabled,
        policy_fingerprint=sha256(fingerprint_input.encode("utf-8")).hexdigest()[:16],
    )

