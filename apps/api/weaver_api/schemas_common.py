from __future__ import annotations

from typing import Generic, TypeVar

from pydantic import BaseModel

from weaver_api.errors import ErrorEnvelope


T = TypeVar("T")


class Page(BaseModel, Generic[T]):
    items: list[T]
    next_cursor: str | None = None


class Created(BaseModel, Generic[T]):
    item: T


class Ok(BaseModel):
    ok: bool = True


__all__ = ["Created", "ErrorEnvelope", "Ok", "Page"]
