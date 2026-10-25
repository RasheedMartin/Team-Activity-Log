"""Small request helpers shared by routes."""

from __future__ import annotations

from fastapi import Request

from .errors import fail


async def read_limited(request: Request, limit: int, message: str) -> bytes:
    """Read a raw body, refusing it as soon as it passes `limit` (never buffers an oversized upload)."""
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > limit:
        fail(413, "too_large", message)
    chunks, total = [], 0
    async for chunk in request.stream():
        total += len(chunk)
        if total > limit:
            fail(413, "too_large", message)
        chunks.append(chunk)
    return b"".join(chunks)
