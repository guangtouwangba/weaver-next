from __future__ import annotations

import json
from collections.abc import AsyncIterable, AsyncIterator

from weaver_core.model.provider import TokenEvent


PING_FRAME = ": ping\n\n"


def encode_sse(event: TokenEvent) -> str:
    payload = event.model_dump(mode="json", exclude_none=True)
    return f"event: {event.type}\ndata: {json.dumps(payload, ensure_ascii=False, sort_keys=True)}\n\n"


def encode_ndjson(event: TokenEvent) -> str:
    return json.dumps(event.model_dump(mode="json", exclude_none=True), ensure_ascii=False, sort_keys=True) + "\n"


async def ensure_single_terminal(events: AsyncIterable[TokenEvent]) -> AsyncIterator[TokenEvent]:
    terminal_count = 0
    async for event in events:
        if event.is_terminal:
            terminal_count += 1
            if terminal_count > 1:
                raise RuntimeError("TOKEN_EVENT_TERMINAL_VIOLATION")
        yield event
    if terminal_count != 1:
        raise RuntimeError("TOKEN_EVENT_TERMINAL_VIOLATION")


async def sse_frames(events: AsyncIterable[TokenEvent], *, include_initial_ping: bool = True) -> AsyncIterator[str]:
    if include_initial_ping:
        yield PING_FRAME
    async for event in ensure_single_terminal(events):
        yield encode_sse(event)


async def ndjson_frames(events: AsyncIterable[TokenEvent]) -> AsyncIterator[str]:
    async for event in ensure_single_terminal(events):
        yield encode_ndjson(event)
