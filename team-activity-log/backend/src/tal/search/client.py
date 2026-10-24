"""The Elasticsearch client, built from settings (URL or Cloud ID; API key or user/password)."""

from __future__ import annotations

from elasticsearch import AsyncElasticsearch

from ..config import get_settings

_client: AsyncElasticsearch | None = None


def es() -> AsyncElasticsearch:
    global _client
    if _client is None:
        s = get_settings()
        kwargs: dict = {"request_timeout": 30, "retry_on_timeout": True, "max_retries": 2}
        if s.elasticsearch_cloud_id:
            kwargs["cloud_id"] = s.elasticsearch_cloud_id
        else:
            kwargs["hosts"] = [s.elasticsearch_url]
        if s.elasticsearch_api_key:
            kwargs["api_key"] = s.elasticsearch_api_key
        elif s.elasticsearch_username:
            kwargs["basic_auth"] = (s.elasticsearch_username, s.elasticsearch_password or "")
        if s.elasticsearch_ca_certs:
            kwargs["ca_certs"] = s.elasticsearch_ca_certs
        if not s.elasticsearch_verify_certs:
            kwargs["verify_certs"] = False
            kwargs["ssl_show_warn"] = False
        _client = AsyncElasticsearch(**kwargs)
    return _client


async def close() -> None:
    global _client
    if _client is not None:
        await _client.close()
        _client = None
