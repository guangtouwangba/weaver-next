from __future__ import annotations

from weaver_core.context.policy import ContextPolicy
from weaver_core.schemas.node import BranchContext, ContextMessage, NodeForest


class NodeNotFoundError(ValueError):
    pass


class CycleDetectedError(ValueError):
    pass


def resolve_branch_context(
    target_node_id: str,
    forest: NodeForest,
    *,
    grounding_enabled: bool = False,
    include_dead_ends: bool = False,
    policy: ContextPolicy | None = None,
) -> BranchContext:
    policy = policy or ContextPolicy(
        include_dead_end_ancestors=include_dead_ends,
        grounding_enabled=grounding_enabled,
    )
    if target_node_id not in forest.nodes:
        raise NodeNotFoundError(target_node_id)

    chain_ids: list[str] = []
    excluded_dead_end_ids: list[str] = []
    seen: set[str] = set()
    cursor_id: str | None = target_node_id

    while cursor_id:
        if cursor_id in seen:
            raise CycleDetectedError("CYCLE_DETECTED")
        seen.add(cursor_id)
        node = forest.nodes[cursor_id]
        is_target = node.id == target_node_id
        if policy.include_dead_end_ancestors or node.status != "dead_end" or is_target:
            chain_ids.append(cursor_id)
        elif node.status == "dead_end":
            excluded_dead_end_ids.append(cursor_id)
        cursor_id = node.parent_id if node.parent_id in forest.nodes else None

    chain_ids.reverse()
    excluded_dead_end_ids = [] if policy.include_dead_end_ancestors else sorted(excluded_dead_end_ids)
    chain_ids = policy.apply_depth_window(chain_ids)
    chain = [
        ContextMessage(
            node_id=node_id,
            title=forest.nodes[node_id].title,
            body=forest.nodes[node_id].body,
            annotation=forest.nodes[node_id].annotation,
            kind=forest.nodes[node_id].kind,
            provenance={"node_id": node_id},
        )
        for node_id in chain_ids
    ]
    return BranchContext(
        target_node_id=target_node_id,
        chain=chain,
        excluded_dead_end_ids=excluded_dead_end_ids,
        grounding_enabled=policy.grounding_enabled,
        policy_fingerprint=policy.fingerprint(chain_ids, excluded_dead_end_ids, target_node_id),
    )
