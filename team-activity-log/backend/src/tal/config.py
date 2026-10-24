"""Settings, read from the environment (or a .env file next to the backend).

The only things a deployment *must* provide are where Postgres and Elasticsearch are:

    DATABASE_URL=postgresql://user:password@host:5432/dbname
    ELASTICSEARCH_URL=https://my-deployment.es.us-east-1.aws.elastic.cloud:443
    ELASTICSEARCH_API_KEY=...            # or ELASTICSEARCH_USERNAME / ELASTICSEARCH_PASSWORD
                                         # or ELASTICSEARCH_CLOUD_ID instead of the URL

Everything else has a safe default. See .env.example for the full list.
"""

from __future__ import annotations

import os
from functools import lru_cache
from typing import Literal
from urllib.parse import quote

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # ---- Postgres (system of record) ----
    database_url: str | None = Field(
        default=None,
        description="Any libpq-style URL. postgres:// and postgresql:// both work; the async driver is added for you.",
    )
    # Or the parts (Railway, Heroku and libpq all use these names); special characters are escaped for you.
    pghost: str | None = None
    pgport: int = 5432
    pguser: str | None = None
    pgpassword: str | None = None
    pgdatabase: str | None = None
    database_pool_size: int = 10
    database_ssl: Literal["disable", "prefer", "require", "verify-full"] | None = Field(
        default=None, description="Override TLS mode. Hosted providers usually need 'require'; omit to use the URL's sslmode."
    )

    # ---- Elasticsearch (search; rebuildable from Postgres) ----
    elasticsearch_url: str | None = "http://localhost:9200"
    elasticsearch_cloud_id: str | None = None
    elasticsearch_api_key: str | None = None
    elasticsearch_username: str | None = None
    elasticsearch_password: str | None = None
    elasticsearch_ca_certs: str | None = Field(default=None, description="Path to a CA bundle for self-signed clusters.")
    elasticsearch_verify_certs: bool = True
    elasticsearch_index_prefix: str = Field(default="tal", description="Lets several environments share one cluster.")
    elasticsearch_refresh: Literal["false", "true", "wait_for"] = Field(
        default="false", description="Refresh policy on index writes. 'wait_for' makes writes searchable before returning (tests)."
    )

    # ---- Image storage: Postgres by default; any S3-compatible bucket when STORAGE=s3 ----
    storage: Literal["postgres", "s3"] = "postgres"
    s3_endpoint: str | None = Field(default=None, description="e.g. https://storage.railway.app or an R2/MinIO URL; omit for AWS S3.")
    s3_bucket: str | None = None
    s3_access_key_id: str | None = None
    s3_secret_access_key: str | None = None
    s3_region: str | None = "auto"
    s3_addressing_style: Literal["auto", "virtual", "path"] = "auto"
    s3_prefix: str = Field(default="tal", description="Key prefix, so several environments can share a bucket.")

    # ---- App ----
    env: Literal["development", "test", "production"] = "development"
    dev_mode: bool = Field(default=False, description="Enables /v1/dev/* (persona sign-in, scenario loading). Never in production.")
    dev_allow_reset: bool = Field(default=False, description="Lets /v1/dev/load wipe every table to load a demo scenario. Local/test databases only.")
    cors_origins: list[str] = ["http://localhost:5173", "http://127.0.0.1:5173"]
    session_cookie: str = "tal_session"
    session_days: int = 30
    cookie_secure: bool | None = Field(default=None, description="Defaults to true in production.")
    public_app_url: str = Field(default="http://localhost:5173", description="Base for links in emails.")
    run_indexer: bool = Field(default=True, description="Run the outbox → Elasticsearch indexer inside the API process.")
    max_upload_bytes: int = 25 * 1024 * 1024
    max_import_bytes: int = 200 * 1024 * 1024
    log_level: str = "INFO"
    frontend_dist: str | None = Field(default=None, description="Path to a built frontend (npm run build) to serve from the same origin.")

    @model_validator(mode="after")
    def _check(self) -> Settings:
        if self.env == "production" and self.dev_mode:
            raise ValueError("DEV_MODE must be off in production")
        if not (self.elasticsearch_url or self.elasticsearch_cloud_id):
            raise ValueError("Set ELASTICSEARCH_URL or ELASTICSEARCH_CLOUD_ID")
        if self.storage == "s3" and not (self.s3_bucket and self.s3_access_key_id and self.s3_secret_access_key):
            raise ValueError("STORAGE=s3 needs S3_BUCKET, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY")
        return self

    @property
    def secure_cookies(self) -> bool:
        return self.cookie_secure if self.cookie_secure is not None else self.env == "production"

    @property
    def resolved_database_url(self) -> str:
        if self.database_url:
            return self.database_url
        if self.pghost:
            auth = quote(self.pguser or "postgres", safe="") + (":" + quote(self.pgpassword, safe="") if self.pgpassword else "")
            return f"postgresql://{auth}@{self.pghost}:{self.pgport}/{quote(self.pgdatabase or 'postgres', safe='')}"
        return "postgresql://tal:tal@localhost:5433/tal"  # local dev default (backend/README.md)

    @property
    def async_database_url(self) -> str:
        """The URL for SQLAlchemy's asyncpg driver (accepts the forms providers hand out)."""
        url = self.resolved_database_url
        for prefix in ("postgres://", "postgresql://", "postgresql+psycopg://", "postgresql+psycopg2://"):
            if url.startswith(prefix):
                url = "postgresql+asyncpg://" + url[len(prefix) :]
                break
        # asyncpg spells libpq's sslmode as ssl.
        return url.replace("sslmode=", "ssl=")

    def index(self, name: str) -> str:
        return f"{self.elasticsearch_index_prefix}_{name}"


@lru_cache
def get_settings() -> Settings:
    # TAL_ENV_FILE picks another env file, e.g. TAL_ENV_FILE=.env.railway tal check
    return Settings(_env_file=os.environ.get("TAL_ENV_FILE", ".env"))  # type: ignore[call-arg]
