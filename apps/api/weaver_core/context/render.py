from __future__ import annotations

from weaver_core.model.provider import ChatMessage
from weaver_core.schemas.node import BranchContext, ContextMessage


def to_messages(context: BranchContext, system: str | None = None) -> list[ChatMessage]:
    messages: list[ChatMessage] = []
    if system:
        messages.append(ChatMessage(role="system", content=system, provenance={"target_node_id": context.target_node_id}))
    messages.extend(_message_for_context_item(item) for item in context.chain)
    return messages


def _message_for_context_item(item: ContextMessage) -> ChatMessage:
    role = item.role
    if item.kind in {"question_answer", "ai_reasoning"}:
        role = "assistant"
    elif item.kind == "user_thought":
        role = "user"

    content = f"{item.title}\n\n{item.body}".strip()
    if item.kind == "user_thought" and item.annotation:
        content = f"{content}\n\nAnnotation: {item.annotation}".strip()

    provenance = {"node_id": item.node_id, **item.provenance}
    return ChatMessage(role=role, content=content, provenance=provenance)
