"""The API app. Run: `tal serve` (or `uvicorn tal.main:app`)."""

from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from . import db, events
from .config import get_settings
from .errors import ApiError, api_error_handler
from .mailer import run_mailer
from .routes import auth, dev, discussion, health, imports, library, oauth, orgs, posts, search
from .search import client as es_client
from .search.diagnose import explain, identity
from .search.indexer import ensure_index, run_indexer

log = logging.getLogger("tal")


@asynccontextmanager
async def lifespan(app: FastAPI):
    s = get_settings()
    logging.basicConfig(level=s.log_level)
    logging.getLogger("elastic_transport.transport").setLevel(logging.WARNING)
    stop = asyncio.Event()
    tasks: list[asyncio.Task] = []
    try:
        await ensure_index()
        log.info("Elasticsearch ready; connected as %s", await identity())
    except Exception as e:  # noqa: BLE001 - the app still serves everything but search
        log.error("%s Search returns 503 until this is fixed; everything else works.", await explain(e))
    await events.start_listener()
    if s.run_indexer:
        tasks.append(asyncio.create_task(run_indexer(stop)))
        tasks.append(asyncio.create_task(run_mailer(stop)))
    log.info("Email: %s; Google sign-in: %s", s.email_provider if s.email_provider != "log" else "not sent (EMAIL_PROVIDER=log)", "on" if s.google_enabled else "off")
    yield
    stop.set()
    for t in tasks:
        await t
    await events.stop_listener()
    await es_client.close()
    await db.dispose()


def create_app() -> FastAPI:
    s = get_settings()
    app = FastAPI(title="Team Activity Log API", version="1.0.0", lifespan=lifespan, docs_url="/v1/docs", openapi_url="/v1/openapi.json")
    app.add_middleware(CORSMiddleware, allow_origins=s.cors_origins, allow_credentials=True, allow_methods=["*"], allow_headers=["*"])
    app.add_exception_handler(ApiError, api_error_handler)  # type: ignore[arg-type]

    @app.exception_handler(RequestValidationError)
    async def _invalid(_: Request, exc: RequestValidationError):
        return JSONResponse({"code": "invalid", "message": "The request wasn't understood", "details": exc.errors()[:5]}, status_code=422)

    for r in (health, auth, oauth, orgs, posts, search, library, discussion, imports):
        app.include_router(r.router, prefix="/v1")
    if s.dev_mode:
        app.include_router(dev.router, prefix="/v1")

    # Optional: serve the built frontend from the same origin (cookies stay first-party).
    dist = Path(s.frontend_dist) if s.frontend_dist else None
    if dist and dist.is_dir():
        app.mount("/assets", StaticFiles(directory=dist / "assets"), name="assets")

        @app.get("/{path:path}", include_in_schema=False)
        async def spa(path: str):
            if path.startswith("v1/"):
                return JSONResponse({"code": "not_found", "message": "Not found"}, status_code=404)
            f = dist / path
            return FileResponse(f if path and f.is_file() and dist in f.resolve().parents else dist / "index.html")

    return app


app = create_app()
