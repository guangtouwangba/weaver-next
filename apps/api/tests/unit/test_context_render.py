from __future__ import annotations

import ast
from pathlib import Path

from weaver_core.context.render import to_messages
from weaver_core.schemas.node import BranchContext, ContextMessage


API_ROOT = Path(__file__).resolve().parents[2]


def test_to_messages_adds_optional_system_message_and_provenance() -> None:
    context = BranchContext(
        target_node_id="node_1",
        chain=[ContextMessage(node_id="node_1", title="Question", body="Answer", kind="question_answer")],
        excluded_dead_end_ids=[],
        grounding_enabled=False,
        policy_fingerprint="fp",
    )

    messages = to_messages(context, system="Stay on branch.")

    assert [message.role for message in messages] == ["system", "assistant"]
    assert messages[0].content == "Stay on branch."
    assert messages[0].provenance == {"target_node_id": "node_1"}
    assert messages[1].provenance == {"node_id": "node_1"}


def test_to_messages_maps_each_kind_and_appends_user_annotation() -> None:
    context = BranchContext(
        target_node_id="node_3",
        chain=[
            ContextMessage(node_id="node_1", title="User thought", body="Raw note", annotation="Keep this nuance", kind="user_thought"),
            ContextMessage(node_id="node_2", title="AI step", body="Reasoning", kind="ai_reasoning"),
            ContextMessage(node_id="node_3", title="QA", body="Answer", kind="question_answer"),
        ],
        excluded_dead_end_ids=[],
        grounding_enabled=False,
        policy_fingerprint="fp",
    )

    messages = to_messages(context)

    assert [message.role for message in messages] == ["user", "assistant", "assistant"]
    assert "Annotation: Keep this nuance" in messages[0].content
    assert messages[1].content == "AI step\n\nReasoning"


def test_context_render_does_not_import_provider_runtime_or_db() -> None:
    tree = ast.parse((API_ROOT / "weaver_core/context/render.py").read_text(encoding="utf-8"))
    imports: list[str] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            imports.extend(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module:
            imports.append(node.module)

    assert "sqlalchemy" not in imports
    assert "weaver_core.model.fake" not in imports
    assert "weaver_core.model.registry" not in imports
