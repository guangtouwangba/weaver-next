import pytest

from weaver_core.context.resolver import CycleDetectedError, NodeNotFoundError, resolve_branch_context
from weaver_core.schemas.node import NodeForest, ThoughtNode


def test_resolve_branch_context_only_includes_ancestor_chain() -> None:
    forest = NodeForest.build(
        "project_1",
        [
            ThoughtNode(id="root", project_id="project_1", parent_id=None, title="Root", body="root body"),
            ThoughtNode(id="a", project_id="project_1", parent_id="root", title="A", body="branch A"),
            ThoughtNode(id="a1", project_id="project_1", parent_id="a", title="A1", body="branch A child"),
            ThoughtNode(id="b", project_id="project_1", parent_id="root", title="B", body="sibling B"),
        ],
    )

    context = resolve_branch_context("a1", forest)

    assert [message.node_id for message in context.chain] == ["root", "a", "a1"]
    assert all(message.node_id != "b" for message in context.chain)


def test_resolve_branch_context_is_deterministic_and_tracks_dead_ends() -> None:
    forest = NodeForest.build(
        "project_1",
        [
            ThoughtNode(id="root", project_id="project_1", parent_id=None, title="Root", body="root body"),
            ThoughtNode(id="dead", project_id="project_1", parent_id="root", title="Dead", body="stop", status="dead_end"),
            ThoughtNode(id="live", project_id="project_1", parent_id="root", title="Live", body="continue"),
        ],
    )

    first = resolve_branch_context("live", forest, grounding_enabled=True)
    second = resolve_branch_context("live", forest, grounding_enabled=True)

    assert first == second
    assert first.excluded_dead_end_ids == []
    assert first.policy_fingerprint == second.policy_fingerprint


def test_resolve_branch_context_excludes_only_dead_ends_on_target_chain() -> None:
    forest = NodeForest.build(
        "project_1",
        [
            ThoughtNode(id="root", project_id="project_1", parent_id=None, title="Root", body="root body"),
            ThoughtNode(id="dead_ancestor", project_id="project_1", parent_id="root", title="Dead", body="stop", status="dead_end"),
            ThoughtNode(id="target", project_id="project_1", parent_id="dead_ancestor", title="Target", body="keep going"),
            ThoughtNode(id="dead_sibling", project_id="project_1", parent_id="root", title="Sibling", body="off path", status="dead_end"),
        ],
    )

    context = resolve_branch_context("target", forest)

    assert [message.node_id for message in context.chain] == ["root", "target"]
    assert context.excluded_dead_end_ids == ["dead_ancestor"]


def test_resolve_branch_context_keeps_dead_end_target() -> None:
    forest = NodeForest.build(
        "project_1",
        [
            ThoughtNode(id="root", project_id="project_1", parent_id=None, title="Root", body="root body"),
            ThoughtNode(id="target", project_id="project_1", parent_id="root", title="Target", body="dead head", status="dead_end"),
        ],
    )

    context = resolve_branch_context("target", forest)

    assert [message.node_id for message in context.chain] == ["root", "target"]
    assert context.excluded_dead_end_ids == []


def test_resolve_branch_context_include_dead_ends_empties_excluded_ids() -> None:
    forest = NodeForest.build(
        "project_1",
        [
            ThoughtNode(id="root", project_id="project_1", parent_id=None, title="Root", body="root body"),
            ThoughtNode(id="dead_ancestor", project_id="project_1", parent_id="root", title="Dead", body="stop", status="dead_end"),
            ThoughtNode(id="target", project_id="project_1", parent_id="dead_ancestor", title="Target", body="keep going"),
        ],
    )

    context = resolve_branch_context("target", forest, include_dead_ends=True)

    assert [message.node_id for message in context.chain] == ["root", "dead_ancestor", "target"]
    assert context.excluded_dead_end_ids == []


def test_resolve_branch_context_detects_cycle() -> None:
    forest = NodeForest(
        project_id="project_1",
        nodes={
            "a": ThoughtNode(id="a", project_id="project_1", parent_id="b", title="A", body="a"),
            "b": ThoughtNode(id="b", project_id="project_1", parent_id="a", title="B", body="b"),
        },
        children={"a": ["b"], "b": ["a"]},
        roots=[],
    )

    with pytest.raises(CycleDetectedError, match="CYCLE_DETECTED"):
        resolve_branch_context("a", forest)


def test_resolve_branch_context_ignores_collapsed_view_state() -> None:
    forest = NodeForest.build(
        "project_1",
        [
            ThoughtNode(id="root", project_id="project_1", parent_id=None, title="Root", body="root body", collapsed=True),
            ThoughtNode(id="target", project_id="project_1", parent_id="root", title="Target", body="body", collapsed=True),
        ],
    )

    context = resolve_branch_context("target", forest)

    assert [message.node_id for message in context.chain] == ["root", "target"]


def test_resolve_branch_context_unknown_node() -> None:
    forest = NodeForest.build("project_1", [])

    with pytest.raises(NodeNotFoundError):
        resolve_branch_context("missing", forest)
