from __future__ import annotations

from datetime import datetime
from typing import Protocol

from pydantic import BaseModel, Field

from weaver_core.schemas.node import ThoughtNode


class ProjectRecord(BaseModel):
    id: str
    title: str
    status: str = "thinking"
    voice_default: str | None = None
    default_backend_id: str | None = None
    created_at: datetime
    updated_at: datetime
    deleted_at: datetime | None = None


class QuickNoteRecord(BaseModel):
    id: str
    text: str
    project_id: str | None = None
    promoted_node_id: str | None = None
    created_at: datetime
    updated_at: datetime
    deleted_at: datetime | None = None


class BackendRecord(BaseModel):
    id: str
    name: str
    kind: str
    provider: str
    model: str
    enabled: bool = True
    is_default: bool = False
    api_key_ref: str | None = None
    permissions: dict[str, bool] = Field(default_factory=dict)
    created_at: datetime
    updated_at: datetime


class IdempotencyRecord(BaseModel):
    key: str
    fingerprint: str
    result: dict
    expires_at: datetime
    created_at: datetime


class ProjectRepo(Protocol):
    def create(self, title: str) -> ProjectRecord:
        ...

    def get(self, project_id: str) -> ProjectRecord | None:
        ...


class NodeRepo(Protocol):
    def create(self, node: ThoughtNode) -> ThoughtNode:
        ...

    def list_for_project(self, project_id: str) -> list[ThoughtNode]:
        ...


class QuickNoteRepo(Protocol):
    def create(self, text: str, project_id: str | None = None) -> QuickNoteRecord:
        ...

    def get(self, quicknote_id: str) -> QuickNoteRecord | None:
        ...


class BackendRepo(Protocol):
    def create(self, name: str, kind: str, provider: str, model: str) -> BackendRecord:
        ...

    def get(self, backend_id: str) -> BackendRecord | None:
        ...


class IdempotencyRepo(Protocol):
    def put(self, record: IdempotencyRecord) -> None:
        ...

    def get(self, key: str) -> IdempotencyRecord | None:
        ...
