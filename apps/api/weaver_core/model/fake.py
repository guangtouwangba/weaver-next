from __future__ import annotations

import hashlib
import json
import os
from collections.abc import AsyncIterator
from typing import Any

from pydantic import BaseModel, Field

from weaver_core.model.provider import BackendHealth, GenerateRequest, TokenEvent


class FakeScript(BaseModel):
    events: list[dict[str, Any]] = Field(default_factory=list)

    @classmethod
    def from_env(cls) -> "FakeScript":
        raw = os.getenv("WEAVER_FAKE_SCRIPT")
        if not raw:
            return cls()
        parsed = json.loads(raw)
        if isinstance(parsed, list):
            return cls(events=parsed)
        if isinstance(parsed, dict):
            return cls(events=list(parsed.get("events", [])))
        raise ValueError("WEAVER_FAKE_SCRIPT must be a JSON list or object")


class FakeProvider:
    def __init__(self, script: FakeScript | None = None) -> None:
        self.script = script or FakeScript.from_env()

    async def health(self) -> BackendHealth:
        return BackendHealth(ok=True, detail="Fake provider ready", latency_ms=0)

    async def generate(self, request: GenerateRequest) -> AsyncIterator[TokenEvent]:
        request_id = request.request_id or _request_id(request)
        terminal_count = 0
        seq = 0

        for scripted in self.script.events:
            event = _scripted_event(scripted, seq=seq, request_id=request_id)
            terminal_count += 1 if event.is_terminal else 0
            yield event
            seq += 1
            if event.is_terminal:
                break

        if terminal_count == 0:
            digest = _digest(request)
            yield TokenEvent(
                type="message",
                seq=seq,
                request_id=request_id,
                text=f"fake:{request.purpose}:{digest[:12]}",
            )
            seq += 1
            yield TokenEvent(
                type="done",
                seq=seq,
                request_id=request_id,
                structured=_structured_output(request, digest),
            )


def _scripted_event(raw: dict[str, Any], *, seq: int, request_id: str) -> TokenEvent:
    payload = dict(raw)
    payload["seq"] = seq
    payload["request_id"] = request_id
    return TokenEvent(**payload)


def _request_id(request: GenerateRequest) -> str:
    return f"fake_{_digest(request)[:16]}"


def _digest(request: GenerateRequest) -> str:
    payload = {
        "purpose": request.purpose,
        "system": request.system,
        "messages": [message.model_dump(mode="json") for message in request.messages],
        "response_schema": request.response_schema,
    }
    encoded = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _structured_output(request: GenerateRequest, digest: str) -> dict[str, Any]:
    if request.purpose == "fork_proposal":
        return {
            "proposals": [
                {
                    "title": "Pressure-test the strongest assumption",
                    "prompt": "What evidence would make this branch false?",
                    "suggested_label": "COUNTERPOINT",
                },
                {
                    "title": "Split timing from willingness",
                    "prompt": "Is the bottleneck reader willingness, available time, or habit formation?",
                    "suggested_label": "DEMAND-SIDE",
                },
            ],
            "digest": digest[:16],
        }
    if request.response_schema and request.response_schema.get("type") == "object":
        properties = request.response_schema.get("properties", {})
        output: dict[str, Any] = {}
        for key, spec in properties.items():
            output[key] = _value_for_schema(key, spec, digest)
        return output
    return {
        "purpose": request.purpose,
        "digest": digest[:16],
    }


def _value_for_schema(key: str, spec: Any, digest: str) -> Any:
    if not isinstance(spec, dict):
        return f"{key}-{digest[:8]}"
    schema_type = spec.get("type")
    if schema_type == "integer":
        return int(digest[:4], 16)
    if schema_type == "number":
        return round(int(digest[:4], 16) / 1000, 3)
    if schema_type == "boolean":
        return int(digest[:2], 16) % 2 == 0
    if schema_type == "array":
        return []
    if schema_type == "object":
        return {}
    return f"{key}-{digest[:8]}"
