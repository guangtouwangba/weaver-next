from __future__ import annotations

from collections.abc import Callable, Iterator
from datetime import datetime, timedelta, timezone

import pytest


@pytest.fixture(autouse=True)
def fake_model_mode(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("WEAVER_MODEL_MODE", "fake")
    monkeypatch.setenv("MODEL_MODE", "fake")


@pytest.fixture
def id_factory() -> Callable[[], str]:
    counter = 0

    def next_id() -> str:
        nonlocal counter
        counter += 1
        return f"test_ulid_{counter:04d}"

    return next_id


@pytest.fixture
def clock() -> Iterator[Callable[[], datetime]]:
    current = datetime(2026, 6, 23, 0, 0, 0, tzinfo=timezone.utc)

    def now() -> datetime:
        nonlocal current
        value = current
        current += timedelta(seconds=1)
        return value

    yield now
