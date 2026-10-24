"""Protections every request passes through (pure ASGI, so streaming/SSE responses are untouched).

- Security headers: CSP (only our own scripts run), no framing, no MIME sniffing, strict
  referrer, locked-down browser features, HSTS in production.
- Cross-site request check: state-changing requests must come from our own origin (a second
  layer on top of SameSite cookies).
- Body size cap for JSON: refused before it is read. Upload endpoints have their own caps.
- Rate limits on sign-in-related endpoints (per client IP, and per email for password sign-in).
"""

from __future__ import annotations

import json
import time
from collections import defaultdict, deque
from urllib.parse import urlparse

from starlette.types import ASGIApp, Message, Receive, Scope, Send

from .config import get_settings

MAX_JSON = 2 * 1024 * 1024
RAW_BODY_PATHS = ("/data", "/upload", "/me/avatar", "/v1/dev/load")  # have their own limits

CSP = "; ".join(
    [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",  # MUI injects styles at runtime
        "font-src 'self' https://fonts.gstatic.com",
        "img-src 'self' data: blob:",
        "connect-src 'self'",
        "frame-ancestors 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "object-src 'none'",
    ]
)

# (path suffix, method) -> (max requests, window seconds)
LIMITS: dict[tuple[str, str], tuple[int, int]] = {
    ("/v1/auth/login", "POST"): (10, 60),
    ("/v1/auth/register", "POST"): (5, 600),
    ("/v1/auth/magic-link", "POST"): (5, 600),
    ("/v1/auth/forgot", "POST"): (5, 600),
    ("/v1/auth/google/start", "GET"): (20, 60),
    ("/accept", "POST"): (10, 600),
    ("/reset/", "POST"): (10, 600),
    ("/verify/", "POST"): (20, 600),
    ("/magic/", "POST"): (20, 600),
    ("/me/password", "PUT"): (10, 600),
}
LOGIN_PER_EMAIL = (5, 900)  # wrong-password guesses per account per 15 minutes


class _Window:
    """Sliding-window counters, per process. Fine for one instance; use a shared store
    (Redis / Postgres) before running several API replicas."""

    def __init__(self) -> None:
        self.hits: dict[str, deque[float]] = defaultdict(deque)

    def count(self, key: str, window: int) -> int:
        now = time.monotonic()
        q = self.hits[key]
        while q and q[0] <= now - window:
            q.popleft()
        return len(q)

    def add(self, key: str) -> None:
        self.hits[key].append(time.monotonic())

    def allow(self, key: str, limit: int, window: int) -> bool:
        if self.count(key, window) >= limit:
            return False
        self.add(key)
        if len(self.hits) > 100_000:  # bound memory under a flood of distinct keys
            self.hits.clear()
        return True


_window = _Window()


def _limit_for(path: str, method: str) -> tuple[str, tuple[int, int]] | None:
    for (suffix, m), lim in LIMITS.items():
        if method == m and (path == suffix or (suffix.startswith("/") and suffix in path and path.startswith("/v1/"))):
            return suffix, lim
    return None


async def _json_error(send: Send, status: int, code: str, message: str, extra: list[tuple[bytes, bytes]] | None = None) -> None:
    body = json.dumps({"code": code, "message": message}).encode()
    await send({"type": "http.response.start", "status": status, "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(body)).encode()), *(extra or [])]})
    await send({"type": "http.response.body", "body": body})


class SecurityMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        s = get_settings()
        path: str = scope["path"]
        method: str = scope["method"]
        headers = {k.decode().lower(): v.decode("latin-1") for k, v in scope["headers"]}

        # 1. Cross-site request check for anything that changes state.
        if method in ("POST", "PUT", "PATCH", "DELETE") and path.startswith("/v1/"):
            origin = headers.get("origin")
            if origin and origin != "null":
                allowed = {urlparse(o).netloc for o in [*s.cors_origins, s.public_app_url]}
                if urlparse(origin).netloc not in allowed | {headers.get("host", "")}:
                    await _json_error(send, 403, "cross_site", "This request came from another site and was refused.")
                    return

        # 2. Body size for JSON endpoints (uploads have their own, larger limits).
        if method in ("POST", "PUT", "PATCH") and not any(p in path for p in RAW_BODY_PATHS):
            length = headers.get("content-length")
            if length and length.isdigit() and int(length) > MAX_JSON:
                await _json_error(send, 413, "too_large", "This request is too large.")
                return

        # 3. Rate limits on sign-in-related endpoints.
        hit = _limit_for(path, method) if s.rate_limit else None
        if hit:
            client = scope.get("client") or ("?", 0)
            suffix, (limit, window) = hit
            if not _window.allow(f"{suffix}|{client[0]}", limit, window):
                await _json_error(send, 429, "rate_limited", "Too many attempts. Wait a few minutes and try again.", [(b"retry-after", str(window).encode())])
                return

        # 4. Headers on every response.
        async def send_with_headers(message: Message) -> None:
            if message["type"] == "http.response.start":
                h = list(message.get("headers", []))
                present = {k.lower() for k, _ in h}

                def add(k: str, v: str) -> None:
                    if k.encode() not in present:
                        h.append((k.encode(), v.encode()))

                add("x-content-type-options", "nosniff")
                add("x-frame-options", "DENY")
                add("referrer-policy", "strict-origin-when-cross-origin")
                add("permissions-policy", "camera=(), microphone=(), geolocation=(), payment=()")
                add("cross-origin-opener-policy", "same-origin")
                add("content-security-policy", CSP)
                if s.env == "production":
                    add("strict-transport-security", "max-age=31536000; includeSubDomains")
                if path.startswith("/v1/") and b"cache-control" not in present:
                    add("cache-control", "no-store")  # API responses hold private data
                message["headers"] = h
            await send(message)

        await self.app(scope, receive, send_with_headers)


def login_locked(email: str) -> bool:
    """Per-account guard against password guessing spread across many IPs (failures only)."""
    limit, window = LOGIN_PER_EMAIL
    return get_settings().rate_limit and _window.count(f"login-fail|{email.strip().lower()}", window) >= limit


def record_login_failure(email: str) -> None:
    _window.add(f"login-fail|{email.strip().lower()}")


def reset_limits() -> None:
    _window.hits.clear()
