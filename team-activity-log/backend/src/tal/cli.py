"""`tal` command line: everything needed to stand the backend up against real credentials.

    tal check                 verify Postgres + Elasticsearch connections and versions
    tal migrate               create/upgrade the Postgres schema (Alembic)
    tal init-search           create the Elasticsearch index + alias (idempotent)
    tal reindex [--org ID] [--new-version N]
                              rebuild search from Postgres (zero-downtime with --new-version)
    tal serve [--port 8000]   run the API (indexer included unless RUN_INDEXER=false)
    tal worker                run only the outbox -> Elasticsearch indexer
"""

from __future__ import annotations

import argparse
import asyncio
import sys
import uuid
from pathlib import Path


def _alembic_cfg():
    """Migrations ship inside the package, so this works from a checkout or an installed image."""
    from alembic.config import Config

    cfg = Config()
    cfg.set_main_option("script_location", str(Path(__file__).resolve().parent / "migrations"))
    return cfg


async def _check() -> int:
    from sqlalchemy import text

    from .config import get_settings
    from .db import dispose, sessionmaker
    from .search.client import close, es

    s = get_settings()
    ok = True
    try:
        async with sessionmaker()() as db:
            v = await db.scalar(text("show server_version"))
            rev = None
            try:
                rev = await db.scalar(text("select version_num from alembic_version"))
            except Exception:  # noqa: BLE001
                await db.rollback()
        print(f"Postgres       ok   version {v}; schema {'at ' + rev if rev else 'NOT migrated (run: tal migrate)'}")
    except Exception as e:  # noqa: BLE001
        ok = False
        print(f"Postgres       FAIL {type(e).__name__}: {e}")
    finally:
        await dispose()
    try:
        info = await es().info()
        from .search.indexer import alias

        has = await es().indices.exists_alias(name=alias())
        print(f"Elasticsearch  ok   version {info['version']['number']}; index {'ready' if has else 'missing (run: tal init-search)'}")
    except Exception as e:  # noqa: BLE001
        ok = False
        print(f"Elasticsearch  FAIL {type(e).__name__}: {e}")
    finally:
        await close()
    try:
        from .storage import check as storage_check

        print(f"Image storage  ok   {await storage_check()}")
    except Exception as e:  # noqa: BLE001
        ok = False
        print(f"Image storage  FAIL {type(e).__name__}: {e}")
    print(f"Environment    {s.env}; dev mode {'on' if s.dev_mode else 'off'}; index prefix '{s.elasticsearch_index_prefix}'")
    return 0 if ok else 1


async def _init_search() -> None:
    from .search.client import close
    from .search.indexer import ensure_index

    print("index:", await ensure_index())
    await close()


async def _reindex(org: str | None, new_version: int | None) -> None:
    from .db import dispose
    from .search.client import close
    from .search.indexer import reindex_all

    n = await reindex_all(uuid.UUID(org) if org else None, new_version=new_version)
    print(f"indexed {n} posts")
    await close()
    await dispose()


async def _worker() -> None:
    from .search.indexer import ensure_index, run_indexer

    await ensure_index()
    await run_indexer(asyncio.Event())


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="tal", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("check")
    sub.add_parser("migrate")
    sub.add_parser("init-search")
    r = sub.add_parser("reindex")
    r.add_argument("--org")
    r.add_argument("--new-version", type=int)
    sv = sub.add_parser("serve")
    sv.add_argument("--host", default="0.0.0.0")
    sv.add_argument("--port", type=int, default=8000)
    sv.add_argument("--reload", action="store_true")
    sub.add_parser("worker")
    a = p.parse_args(argv)

    if a.cmd == "check":
        return asyncio.run(_check())
    if a.cmd == "migrate":
        from alembic import command
        from alembic.script import ScriptDirectory

        cfg = _alembic_cfg()
        command.upgrade(cfg, "head")
        print(f"Database schema is at {ScriptDirectory.from_config(cfg).get_current_head()} (latest).")
        return 0
    if a.cmd == "init-search":
        asyncio.run(_init_search())
        return 0
    if a.cmd == "reindex":
        asyncio.run(_reindex(a.org, a.new_version))
        return 0
    if a.cmd == "serve":
        import uvicorn

        # Behind Railway's (or any) proxy: trust X-Forwarded-* so client IPs and https are right.
        uvicorn.run("tal.main:app", host=a.host, port=a.port, reload=a.reload, proxy_headers=True, forwarded_allow_ips="*")
        return 0
    if a.cmd == "worker":
        asyncio.run(_worker())
        return 0
    return 1


if __name__ == "__main__":
    sys.exit(main())
