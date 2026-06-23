from __future__ import annotations

import asyncio

import pytest

from weaver_api.sse import PING_FRAME, encode_ndjson, encode_sse, ndjson_frames, sse_frames
from weaver_core.model.provider import TokenEvent


async def _events(*events: TokenEvent):
    for event in events:
        yield event


async def _collect(async_iterable):
    return [item async for item in async_iterable]


def test_sse_and_ndjson_framing() -> None:
    event = TokenEvent(type="done", seq=0, request_id="req_1", structured={"ok": True})

    assert encode_sse(event).startswith("event: done\ndata: ")
    assert encode_sse(event).endswith("\n\n")
    assert encode_ndjson(event).endswith("\n")
    assert '"request_id": "req_1"' in encode_ndjson(event)


def test_sse_frames_include_ping_and_require_single_terminal() -> None:
    frames = asyncio.run(
        _collect(
            sse_frames(
                _events(
                    TokenEvent(type="message", seq=0, request_id="req_1", text="hello"),
                    TokenEvent(type="done", seq=1, request_id="req_1"),
                )
            )
        )
    )

    assert frames[0] == PING_FRAME
    assert "event: message" in frames[1]
    assert "event: done" in frames[2]


def test_ndjson_frames_reject_missing_or_duplicate_terminal_events() -> None:
    with pytest.raises(RuntimeError, match="TOKEN_EVENT_TERMINAL_VIOLATION"):
        asyncio.run(_collect(ndjson_frames(_events(TokenEvent(type="message", seq=0, request_id="req_1")))))

    with pytest.raises(RuntimeError, match="TOKEN_EVENT_TERMINAL_VIOLATION"):
        asyncio.run(
            _collect(
                ndjson_frames(
                    _events(
                        TokenEvent(type="done", seq=0, request_id="req_1"),
                        TokenEvent(type="error", seq=1, request_id="req_1", error="bad"),
                    )
                )
            )
        )
