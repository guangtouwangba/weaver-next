"""Model provider protocols and registry."""

from weaver_core.model.fake import FakeProvider, FakeScript
from weaver_core.model.provider import BackendHealth, ChatMessage, GenerateRequest, ModelProvider, TokenEvent
from weaver_core.model.registry import BackendDisabledError, BackendNotFoundError, ProviderRegistry, UnknownBackendError, default_registry

__all__ = [
    "BackendDisabledError",
    "BackendHealth",
    "BackendNotFoundError",
    "ChatMessage",
    "FakeProvider",
    "FakeScript",
    "GenerateRequest",
    "ModelProvider",
    "ProviderRegistry",
    "TokenEvent",
    "UnknownBackendError",
    "default_registry",
]
