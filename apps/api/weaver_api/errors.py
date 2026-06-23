from __future__ import annotations

from enum import StrEnum
from typing import Any

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field


class ErrorCode(StrEnum):
    BACKEND_NOT_FOUND = "BACKEND_NOT_FOUND"
    DRAFT_NOT_FOUND = "DRAFT_NOT_FOUND"
    DRAFT_SOURCE_AMBIGUOUS = "DRAFT_SOURCE_AMBIGUOUS"
    EXPORT_NOT_FOUND = "EXPORT_NOT_FOUND"
    INVALID_TREE_OP = "INVALID_TREE_OP"
    ILLEGAL_STATE_TRANSITION = "ILLEGAL_STATE_TRANSITION"
    NODE_NOT_FOUND = "NODE_NOT_FOUND"
    QUICKNOTE_NOT_FOUND = "QUICKNOTE_NOT_FOUND"
    CYCLE_DETECTED = "CYCLE_DETECTED"
    VALIDATION_FAILED = "VALIDATION_FAILED"


STATUS: dict[ErrorCode, int] = {
    ErrorCode.BACKEND_NOT_FOUND: 404,
    ErrorCode.DRAFT_NOT_FOUND: 404,
    ErrorCode.DRAFT_SOURCE_AMBIGUOUS: 422,
    ErrorCode.EXPORT_NOT_FOUND: 404,
    ErrorCode.INVALID_TREE_OP: 422,
    ErrorCode.ILLEGAL_STATE_TRANSITION: 409,
    ErrorCode.NODE_NOT_FOUND: 404,
    ErrorCode.QUICKNOTE_NOT_FOUND: 404,
    ErrorCode.CYCLE_DETECTED: 409,
    ErrorCode.VALIDATION_FAILED: 422,
}


class ErrorBody(BaseModel):
    code: ErrorCode
    message: str
    details: dict[str, Any] = Field(default_factory=dict)


class ErrorEnvelope(BaseModel):
    error: ErrorBody


class WeaverError(Exception):
    def __init__(self, code: ErrorCode, message: str | None = None, details: dict[str, Any] | None = None) -> None:
        self.code = code
        self.message = message or code.value
        self.details = details or {}
        super().__init__(self.message)

    @property
    def status_code(self) -> int:
        return STATUS[self.code]

    def envelope(self) -> ErrorEnvelope:
        return ErrorEnvelope(
            error=ErrorBody(
                code=self.code,
                message=self.message,
                details=self.details,
            )
        )


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(WeaverError)
    async def _weaver_error_handler(_request: Request, exc: WeaverError) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status_code,
            content=exc.envelope().model_dump(mode="json"),
        )
