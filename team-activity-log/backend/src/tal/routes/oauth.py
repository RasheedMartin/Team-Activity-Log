"""Sign in with Google (OpenID Connect, authorization-code flow with PKCE).

    GET /v1/auth/providers          which buttons the UI should show
    GET /v1/auth/google/start       -> Google (state + PKCE kept in a short-lived httpOnly cookie)
    GET /v1/auth/google/callback    <- Google: exchange the code, validate the ID token, sign in

The ID token comes straight from Google's token endpoint over TLS, which OpenID Connect Core
§3.1.3.7 accepts in place of a signature check; audience, issuer, expiry, and a verified email
are still validated. Errors land back on /signin?error=<code> with a readable message there.
"""

from __future__ import annotations

import base64
import datetime as dt
import hashlib
import json
import secrets
import time
from urllib.parse import urlencode, urlparse

import httpx
from fastapi import APIRouter, Depends, Request
from fastapi.responses import RedirectResponse
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from .. import avatars
from .. import models as m
from ..config import get_settings
from ..context import start_session
from ..db import get_db
from ..ids import uuid7
from ..timeutil import now

router = APIRouter()

AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_URL = "https://oauth2.googleapis.com/token"
ISSUERS = {"https://accounts.google.com", "accounts.google.com"}
COOKIE = "tal_oauth"
COOKIE_PATH = "/v1/auth/google"
_transport: httpx.AsyncBaseTransport | None = None  # tests swap in a fake Google


def _redirect_uri() -> str:
    return get_settings().public_app_url.rstrip("/") + "/v1/auth/google/callback"


def _safe_next(n: str | None) -> str:
    """Only same-site paths: never an open redirect."""
    return n if n and n.startswith("/") and not n.startswith("//") and "\\" not in n else "/"


def _fail(code: str) -> RedirectResponse:
    r = RedirectResponse(f"/signin?error={code}", status_code=303)
    r.delete_cookie(COOKIE, path=COOKIE_PATH)
    return r


def _b64url(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


def decode_id_token(token: str) -> dict:
    payload = token.split(".")[1]
    return json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))


async def _copy_google_photo(db: AsyncSession, user: m.User, url: str) -> None:
    """Keep a copy in our storage rather than hotlinking Google (privacy, and a tight CSP).
    Best effort: a failure here never blocks sign-in."""
    if urlparse(url).scheme != "https" or not (urlparse(url).hostname or "").endswith(".googleusercontent.com"):
        return
    try:
        async with httpx.AsyncClient(timeout=5, transport=_transport, follow_redirects=False) as client:
            r = await client.get(url)
        if r.status_code == 200 and len(r.content) <= avatars.MAX_BYTES:
            await avatars.set_avatar(db, user, r.content)
    except Exception:  # noqa: BLE001
        return


@router.get("/auth/providers")
async def providers():
    s = get_settings()
    # Public settings the sign-in pages and homepage need.
    return {"google": s.google_enabled, "pricing": s.pricing_public, "signupCode": bool(s.signup_code)}


@router.get("/auth/google/start")
async def google_start(next: str | None = None):
    s = get_settings()
    if not s.google_enabled:
        return _fail("google_unavailable")
    state, verifier = secrets.token_urlsafe(24), secrets.token_urlsafe(48)
    params = {
        "client_id": s.google_client_id,
        "redirect_uri": _redirect_uri(),
        "response_type": "code",
        "scope": "openid email profile",
        "state": state,
        "code_challenge": _b64url(hashlib.sha256(verifier.encode()).digest()),
        "code_challenge_method": "S256",
        "prompt": "select_account",
    }
    r = RedirectResponse(f"{AUTH_URL}?{urlencode(params)}", status_code=303)
    cookie = base64.urlsafe_b64encode(json.dumps({"state": state, "verifier": verifier, "next": _safe_next(next)}).encode()).decode()
    r.set_cookie(COOKIE, cookie, max_age=600, httponly=True, samesite="lax", secure=s.secure_cookies, path=COOKIE_PATH)
    return r


@router.get("/auth/google/callback")
async def google_callback(request: Request, code: str | None = None, state: str | None = None, error: str | None = None, db: AsyncSession = Depends(get_db, scope="function")):
    s = get_settings()
    if error:
        return _fail("google_cancelled" if error == "access_denied" else "google_failed")
    try:
        saved = json.loads(base64.urlsafe_b64decode(request.cookies.get(COOKIE, "")))
    except (ValueError, TypeError):
        saved = {}
    if not code or not state or not saved.get("state") or not secrets.compare_digest(state, saved["state"]):
        return _fail("google_expired")

    async with httpx.AsyncClient(timeout=15, transport=_transport) as client:
        r = await client.post(
            TOKEN_URL,
            data={
                "code": code,
                "client_id": s.google_client_id,
                "client_secret": s.google_client_secret,
                "redirect_uri": _redirect_uri(),
                "grant_type": "authorization_code",
                "code_verifier": saved.get("verifier", ""),
            },
        )
    if r.status_code != 200 or "id_token" not in r.json():
        return _fail("google_failed")
    try:
        claims = decode_id_token(r.json()["id_token"])
    except (ValueError, IndexError):
        return _fail("google_failed")
    if claims.get("aud") != s.google_client_id or claims.get("iss") not in ISSUERS or int(claims.get("exp", 0)) < time.time():
        return _fail("google_failed")
    email = str(claims.get("email") or "").strip()
    if not email or claims.get("email_verified") not in (True, "true"):
        return _fail("google_unverified")
    sub = str(claims["sub"])

    ident = (await db.execute(select(m.Identity).where(m.Identity.provider == "google", m.Identity.subject == sub))).scalar_one_or_none()
    user = await db.get(m.User, ident.user_id) if ident else None
    if not user:
        # Same verified email as an existing account: link, don't duplicate.
        user = (await db.execute(select(m.User).where(func.lower(m.User.email) == email.lower()))).scalar_one_or_none()
    if user and user.deactivated_at:
        return _fail("deactivated")
    if not user and get_settings().signup_code:
        return _fail("signup_code")  # new accounts need the code: register with email first
    if not user:
        user = m.User(id=uuid7(), email=email, name=str(claims.get("name") or email.split("@")[0]), email_verified_at=now(), timezone="UTC")
        db.add(user)
        await db.flush()
    if not user.email_verified_at:
        user.email_verified_at = now()  # Google vouched for this address
    if not user.avatar_url and claims.get("picture"):
        await _copy_google_photo(db, user, str(claims["picture"]))
    if not ident:
        ident = m.Identity(id=uuid7(), user_id=user.id, provider="google", subject=sub, email=email)
        db.add(ident)
    ident.last_used_at = now()

    out = RedirectResponse(_safe_next(saved.get("next")), status_code=303)
    out.delete_cookie(COOKIE, path=COOKIE_PATH)
    await start_session(db, request, out, user.id)
    return out


__all__ = ["router", "decode_id_token", "dt"]
