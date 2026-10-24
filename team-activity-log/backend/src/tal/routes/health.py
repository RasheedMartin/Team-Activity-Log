"""Liveness and readiness. Readiness checks both data stores and index lag (§B12)."""

from __future__ import annotations

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from sqlalchemy import text

from ..db import sessionmaker
from ..search.client import es
from ..search.indexer import alias

router = APIRouter()


@router.get("/health")
async def live():
    return {"status": "ok"}


@router.get("/health/ready")
async def ready():
    out: dict = {"postgres": "down", "elasticsearch": "down"}
    try:
        async with sessionmaker()() as db:
            out["postgres"] = "ok"
            lag = await db.scalar(text("select extract(epoch from now() - min(created_at)) from outbox where processed_at is null"))
            out["indexLagSeconds"] = round(float(lag or 0), 1)
    except Exception as e:  # noqa: BLE001
        out["postgresError"] = type(e).__name__
    try:
        info = await es().info()
        out["elasticsearch"] = "ok"
        out["elasticsearchVersion"] = info["version"]["number"]
        out["indexExists"] = bool(await es().indices.exists_alias(name=alias()))
    except Exception as e:  # noqa: BLE001
        out["elasticsearchError"] = type(e).__name__
    healthy = out["postgres"] == "ok" and out["elasticsearch"] == "ok"
    return JSONResponse(out, status_code=200 if healthy else 503)
