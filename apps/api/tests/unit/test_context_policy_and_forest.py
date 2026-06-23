from __future__ import annotations

import ast
from pathlib import Path

from weaver_core.context.policy import ContextPolicy
from weaver_core.context.resolver import resolve_branch_context
from weaver_core.schemas.node import Branch, ContextMessage, NodeForest, ThoughtNode


API_ROOT = Path(__file__).resolve().parents[2]


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


def test_context_policy_fingerprint_is_stable_and_depth_windowed() -> None:
    policy = ContextPolicy(max_depth=2, grounding_enabled=True)
    first = resolve_branch_context("a1", _forest(), policy=policy)
    second = resolve_branch_context("a1", _forest(), policy=policy)

    assert first == second
    assert [message.node_id for message in first.chain] == ["a", "a1"]
    assert first.policy_fingerprint == second.policy_fingerprint
    assert first.grounding_enabled is True


def test_branch_helpers_ordering_depth_descendants_and_immutable_update() -> None:
    forest = _forest()
    branch = forest.branch_of("a1")
    updated = forest.with_node(ThoughtNode(id="c", project_id="project_1", parent_id="root", title="C", body="c", order_index=2))

    assert branch == Branch(head_node_id="a1", node_ids=["root", "a", "a1"], depth=2)
    assert forest.descendants("root") == ["a", "a1", "b"]
    assert "c" not in forest.nodes
    assert updated.children["root"] == ["a", "b", "c"]


def test_context_schema_round_trip_and_enum_fields() -> None:
    message = ContextMessage(
        node_id="node_1",
        title="Title",
        body="Body",
        kind="question_answer",
        role="assistant",
        provenance={"node_id": "node_1"},
    )

    assert ContextMessage.model_validate(message.model_dump()) == message


def test_context_modules_do_not_import_db_model_clock_or_rng() -> None:
    forbidden = {"sqlalchemy", "random", "datetime", "weaver_core.model"}
    for relative in ["weaver_core/context/resolver.py", "weaver_core/context/policy.py"]:
        tree = ast.parse((API_ROOT / relative).read_text(encoding="utf-8"))
        imports: list[str] = []
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                imports.extend(alias.name for alias in node.names)
            elif isinstance(node, ast.ImportFrom) and node.module:
                imports.append(node.module)
        assert not any(name in forbidden or any(name.startswith(f"{item}.") for item in forbidden) for name in imports)
