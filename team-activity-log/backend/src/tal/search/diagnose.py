"""Plain-language Elasticsearch connection diagnosis (startup logs and `tal check`)."""

from __future__ import annotations

from elasticsearch import ApiError, AuthenticationException, AuthorizationException

from ..config import get_settings
from .client import es


async def identity() -> str:
    """'elastic (superuser)' or a hint about what's wrong. Never includes secrets."""
    s = get_settings()
    mode = "API key" if s.elasticsearch_api_key else f"user '{s.elasticsearch_username}'" if s.elasticsearch_username else "no credentials"
    try:
        who = await es().security.authenticate()
    except AuthenticationException:
        return f"rejected ({mode}): wrong username/password or API key"
    except ApiError as e:
        if e.meta.status in (400, 405) and not (s.elasticsearch_api_key or s.elasticsearch_username):
            return "no login (this cluster has security turned off; fine for local dev only)"
        return f"couldn't check identity ({mode}): HTTP {e.meta.status}"
    name, roles = who.get("username", "?"), [r for r in who.get("roles", []) if r != "anonymous_role"]
    if name == "anonymous_user":
        return f"connected as anonymous ({mode}): set ELASTICSEARCH_USERNAME/ELASTICSEARCH_PASSWORD (or ELASTICSEARCH_API_KEY); check that Railway references resolve"
    return f"{name} ({', '.join(roles) or 'no roles'}) via {mode}"


async def explain(exc: Exception) -> str:
    if isinstance(exc, AuthorizationException):
        return f"Elasticsearch refused (403). Connected as: {await identity()}. That identity needs create/manage rights on '{get_settings().elasticsearch_index_prefix}_*' indexes."
    if isinstance(exc, AuthenticationException):
        return "Elasticsearch rejected the credentials (401): check ELASTICSEARCH_USERNAME/PASSWORD or ELASTICSEARCH_API_KEY."
    return f"Elasticsearch isn't reachable ({type(exc).__name__}): check ELASTICSEARCH_URL (private: http://<service>.railway.internal:9200)."
