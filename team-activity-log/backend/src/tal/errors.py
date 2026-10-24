"""API errors in the contract's shape: {code, message, details?} (src/api/contract.ts ApiErrorBody)."""

from __future__ import annotations

from typing import Any, NoReturn

from fastapi import Request
from fastapi.responses import JSONResponse


class ApiError(Exception):
    def __init__(self, status: int, code: str, message: str, details: Any = None):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message
        self.details = details


def fail(status: int, code: str, message: str, details: Any = None) -> NoReturn:
    raise ApiError(status, code, message, details)


def not_found(what: str) -> NoReturn:
    fail(404, "not_found", f"{what} not found")


async def api_error_handler(_: Request, exc: ApiError) -> JSONResponse:
    body: dict[str, Any] = {"code": exc.code, "message": exc.message}
    if exc.details is not None:
        body["details"] = exc.details
    return JSONResponse(body, status_code=exc.status)
