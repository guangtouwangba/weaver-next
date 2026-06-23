from __future__ import annotations

import os
from collections.abc import Callable

from weaver_core.model.fake import FakeProvider
from weaver_core.model.provider import ModelProvider


ProviderBuilder = Callable[[], ModelProvider]


class BackendNotFoundError(ValueError):
    pass


class BackendDisabledError(ValueError):
    pass


class UnknownBackendError(ValueError):
    pass


class ProviderRegistry:
    def __init__(self) -> None:
        self._builders: dict[tuple[str, str], ProviderBuilder] = {}
        self._disabled: set[tuple[str, str]] = set()

    def register_builder(self, kind: str, provider: str, builder: ProviderBuilder, *, enabled: bool = True) -> None:
        self._builders[(kind, provider)] = builder
        if enabled:
            self._disabled.discard((kind, provider))
        else:
            self._disabled.add((kind, provider))

    def get(self, kind: str, provider: str) -> ModelProvider:
        if kind not in {"api_sdk", "cli_agent", "fake"}:
            raise UnknownBackendError("UNKNOWN_BACKEND")
        if (kind, provider) in self._disabled:
            raise BackendDisabledError("BACKEND_DISABLED")
        builder = self._builders.get((kind, provider))
        if not builder:
            raise BackendNotFoundError("BACKEND_NOT_FOUND")
        return builder()

    def default_for(self, kind: str | None = None, provider: str | None = None) -> ModelProvider:
        if kind and provider:
            return self.get(kind, provider)
        if os.getenv("WEAVER_MODEL_MODE", "fake") == "fake":
            return FakeProvider()
        raise BackendNotFoundError("NO_DEFAULT_BACKEND")


def default_registry() -> ProviderRegistry:
    registry = ProviderRegistry()
    registry.register_builder("fake", "weaver", FakeProvider)
    return registry
