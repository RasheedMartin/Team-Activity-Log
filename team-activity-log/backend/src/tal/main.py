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
from .ocr import run_ocr, tesseract_available
from .routes import attachments, auth, billing, dev, discussion, health, imports, library, oauth, ocr, orgs, posts, search
from .search import client as es_client
from .search.diagnose import explain, identity
from .search.indexer import ensure_index, run_indexer
from .security import SecurityMiddleware

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
        tasks.append(asyncio.create_task(run_ocr(stop)))
    log.info("OCR: %s", "off (OCR_ENABLED=false)" if not s.ocr_enabled else "Tesseract ready" if tesseract_available() else "waiting: Tesseract isn't installed, so images stay queued")
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
    # API docs only outside production (less surface to probe).
    docs = s.env != "production"
    app = FastAPI(title="Team Activity Log API", version="1.0.0", lifespan=lifespan, docs_url="/v1/docs" if docs else None, redoc_url=None, openapi_url="/v1/openapi.json" if docs else None)
    app.add_middleware(CORSMiddleware, allow_origins=s.cors_origins, allow_credentials=True, allow_methods=["*"], allow_headers=["*"])
    app.add_middleware(SecurityMiddleware)
    app.add_exception_handler(ApiError, api_error_handler)  # type: ignore[arg-type]

    @app.exception_handler(RequestValidationError)
    async def _invalid(_: Request, exc: RequestValidationError):
        # Field locations and messages only: never echo the submitted values back.
        details = [{"loc": e.get("loc"), "msg": e.get("msg")} for e in exc.errors()[:5]]
        return JSONResponse({"code": "invalid", "message": "The request wasn't understood", "details": details}, status_code=422)

    @app.exception_handler(Exception)
    async def _crash(_: Request, exc: Exception):
        log.exception("unhandled error")
        return JSONResponse({"code": "internal", "message": "Something went wrong on our side. Try again in a moment."}, status_code=500)

    for r in (health, auth, oauth, orgs, posts, search, library, discussion, imports, billing, ocr, attachments):
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
