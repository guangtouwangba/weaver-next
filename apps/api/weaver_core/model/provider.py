from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Any, Literal, Protocol

from pydantic import BaseModel, Field


TokenEventType = Literal[
    "message",
    "token",
    "progress",
    "citation",
    "tool_call",
    "structured",
    "done",
    "error",
]


class ChatMessage(BaseModel):
    role: Literal["system", "user", "assistant", "tool"]
    content: str
    provenance: dict[str, Any] = Field(default_factory=dict)


class GenerateRequest(BaseModel):
    purpose: str
    system: str = ""
    messages: list[ChatMessage] = Field(default_factory=list)
    response_schema: dict[str, Any] | None = None
    request_id: str | None = None


class TokenEvent(BaseModel):
    type: TokenEventType
    seq: int
    request_id: str
    text: str | None = None
    structured: dict[str, Any] | None = None
    citation: dict[str, Any] | None = None
    tool_call: dict[str, Any] | None = None
    error: str | None = None
    stage: str | None = None

    @property
    def is_terminal(self) -> bool:
        return self.type in {"done", "error"}


class BackendHealth(BaseModel):
    ok: bool
    detail: str | None = None
    latency_ms: int | None = None


class ModelProvider(Protocol):
    async def generate(self, request: GenerateRequest) -> AsyncIterator[TokenEvent]:
        ...

    async def health(self) -> BackendHealth:
        ...
