from __future__ import annotations

import pytest

from weaver_core.schemas.node import NodeForest, ThoughtNode
from weaver_core.tree import InvalidTreeError, NodeSpec, add_root, backtrack, fork, prune, set_collapsed, set_state, unprune
from weaver_core.tree.validate import validate_forest


def _ids():
    counter = 0

    def next_id() -> str:
        nonlocal counter
        counter += 1
        return f"new_{counter}"

    return next_id


def _forest() -> NodeForest:
    return NodeForest.build(
        "project_1",
        [
            ThoughtNode(id="root", project_id="project_1", parent_id=None, title="Root", body="root"),
            ThoughtNode(id="a", project_id="project_1", parent_id="root", title="A", body="a", order_index=0),
            ThoughtNode(id="b", project_id="project_1", parent_id="root", title="B", body="b", order_index=1),
            ThoughtNode(id="a1", project_id="project_1", parent_id="a", title="A1", body="a1"),
        ],
    )


def test_fork_inserts_dense_siblings_without_mutating_input() -> None:
    forest = _forest()
    next_forest, created = fork(
        forest,
        "root",
        [NodeSpec(title="C", body="c"), NodeSpec(title="D", body="d")],
        new_id=_ids(),
    )

    assert [node.id for node in created] == ["new_1", "new_2"]
    assert [node.order_index for node in created] == [2, 3]
    assert forest.children["root"] == ["a", "b"]
    assert next_forest.children["root"] == ["a", "b", "new_1", "new_2"]


def test_add_root_supports_multi_root_and_determinism() -> None:
    forest = _forest()
    next_forest, created = add_root(forest, NodeSpec(title="Second root", body="root 2"), new_id=_ids())

    assert created.parent_id is None
    assert created.order_index == 1
    assert next_forest.roots == ["root", "new_1"]


def test_missing_parent_and_invalid_forest_raise() -> None:
    with pytest.raises(InvalidTreeError, match="NODE_NOT_FOUND"):
        fork(_forest(), "missing", [NodeSpec(title="X", body="x")], new_id=_ids())

    invalid = NodeForest.build(
        "project_1",
        [
            ThoughtNode(id="root", project_id="project_1", parent_id=None, title="Root", body="root"),
            ThoughtNode(id="a", project_id="project_1", parent_id="root", title="A", body="a", order_index=0),
            ThoughtNode(id="b", project_id="project_1", parent_id="root", title="B", body="b", order_index=0),
        ],
    )
    with pytest.raises(InvalidTreeError, match="DUPLICATE_ORDER_INDEX"):
        validate_forest(invalid)


def test_backtrack_returns_branch_without_mutation() -> None:
    forest = _forest()
    before = forest.model_dump()

    assert backtrack(forest, "a1") == ["root", "a", "a1"]
    assert forest.model_dump() == before


def test_prune_unprune_and_fold_are_pure_subtree_updates() -> None:
    forest = _forest()
    pruned = prune(forest, "a")
    unpruned = unprune(pruned, "a")
    folded = set_collapsed(forest, "a", True)

    assert forest.nodes["a"].status == "open"
    assert pruned.nodes["a"].status == "dead_end"
    assert pruned.nodes["a1"].status == "dead_end"
    assert pruned.nodes["a"].collapsed is True
    assert unpruned.nodes["a"].status == "open"
    assert unpruned.nodes["a1"].collapsed is False
    assert folded.nodes["a"].collapsed is True


def test_illegal_state_transition() -> None:
    dead = prune(_forest(), "a")

    with pytest.raises(InvalidTreeError, match="ILLEGAL_STATE_TRANSITION"):
        set_state(dead, "a", "promising")
