from __future__ import annotations

import asyncio

import pytest

from weaver_core.model import (
    BackendDisabledError,
    BackendNotFoundError,
    ChatMessage,
    FakeProvider,
    FakeScript,
    GenerateRequest,
    ProviderRegistry,
    UnknownBackendError,
    default_registry,
)


async def _collect(provider: FakeProvider, request: GenerateRequest):
    return [event async for event in provider.generate(request)]


def test_fake_provider_is_deterministic_and_has_one_terminal_event() -> None:
    request = GenerateRequest(
        purpose="generic_structured",
        system="stay isolated",
        messages=[ChatMessage(role="user", content="branch head", provenance={"node_id": "node_1"})],
        response_schema={"type": "object", "properties": {"title": {"type": "string"}, "ok": {"type": "boolean"}}},
    )

    first = asyncio.run(_collect(FakeProvider(), request))
    second = asyncio.run(_collect(FakeProvider(), request))

    assert first == second
    assert [event.seq for event in first] == list(range(len(first)))
    assert sum(1 for event in first if event.is_terminal) == 1
    assert first[-1].type == "done"
    assert first[-1].structured is not None
    assert set(first[-1].structured) == {"title", "ok"}


def test_fake_provider_supports_scripted_citation_tool_call_and_error_events() -> None:
    provider = FakeProvider(
        FakeScript(
            events=[
                {"type": "citation", "citation": {"source_id": "src_1"}},
                {"type": "tool_call", "tool_call": {"name": "retrieve"}},
                {"type": "error", "error": "SCRIPTED_FAILURE"},
            ]
        )
    )

    events = asyncio.run(_collect(provider, GenerateRequest(purpose="scripted")))

    assert [event.type for event in events] == ["citation", "tool_call", "error"]
    assert [event.seq for event in events] == [0, 1, 2]
    assert events[-1].error == "SCRIPTED_FAILURE"
    assert sum(1 for event in events if event.is_terminal) == 1


def test_registry_defaults_to_fake_under_fake_model_mode(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("WEAVER_MODEL_MODE", "fake")

    provider = default_registry().default_for()

    assert isinstance(provider, FakeProvider)


def test_registry_raises_for_unknown_backend() -> None:
    with pytest.raises(BackendNotFoundError, match="BACKEND_NOT_FOUND"):
        default_registry().get("cli_agent", "missing")


def test_registry_raises_for_unknown_kind_and_disabled_backend() -> None:
    registry = ProviderRegistry()
    registry.register_builder("fake", "weaver", FakeProvider, enabled=False)

    with pytest.raises(UnknownBackendError, match="UNKNOWN_BACKEND"):
        registry.get("strange", "provider")

    with pytest.raises(BackendDisabledError, match="BACKEND_DISABLED"):
        registry.get("fake", "weaver")


def test_fake_provider_generates_structured_fork_proposals() -> None:
    events = asyncio.run(
        _collect(
            FakeProvider(),
            GenerateRequest(
                purpose="fork_proposal",
                messages=[ChatMessage(role="user", content="Only this branch", provenance={"node_id": "node_1"})],
                response_schema={"type": "object", "properties": {"proposals": {"type": "array"}}},
            ),
        )
    )

    assert events[-1].type == "done"
    assert events[-1].structured is not None
    assert len(events[-1].structured["proposals"]) == 2
