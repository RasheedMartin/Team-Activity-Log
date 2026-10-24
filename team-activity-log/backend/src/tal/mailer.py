"""Email delivery. Writers queue rows in `emails` inside their own transaction (so a failed send
never breaks registration); this drains them through the configured provider with retries.

Providers are plain HTTPS APIs (no SMTP: some hosts, Railway included, restrict outbound SMTP).
"""

from __future__ import annotations

import asyncio
import datetime as dt
import html
import logging

import httpx
from sqlalchemy import select

from . import models as m
from .config import get_settings
from .db import sessionmaker
from .timeutil import now

log = logging.getLogger("tal.mailer")
MAX_ATTEMPTS = 6
BATCH = 20
_transport: httpx.AsyncBaseTransport | None = None  # tests swap in a fake


def absolute(link: str | None) -> str | None:
    if not link:
        return None
    return link if link.startswith("http") else get_settings().public_app_url.rstrip("/") + link


def render(e: m.Email) -> tuple[str, str]:
    """(html, text). Deliberately plain: renders well everywhere, including dark-mode clients."""
    url = absolute(e.link)
    text = e.body + (f"\n\n{url}\n" if url else "\n") + "\n— Team Activity Log"
    button = (
        f'<p style="margin:24px 0"><a href="{html.escape(url)}" style="background:#3451d1;color:#ffffff;text-decoration:none;'
        f'padding:10px 18px;border-radius:6px;font-weight:600;display:inline-block">{html.escape(_cta(e.subject))}</a></p>'
        f'<p style="color:#5d6672;font-size:13px">Or paste this link into your browser:<br><a href="{html.escape(url)}" style="color:#3451d1">{html.escape(url)}</a></p>'
        if url
        else ""
    )
    body = (
        '<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#1b1f24">'
        '<p style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#3451d1;margin:0 0 16px">Team Activity Log</p>'
        f'<h1 style="font-size:20px;margin:0 0 12px">{html.escape(e.subject)}</h1>'
        f'<p style="font-size:15px;line-height:1.5;margin:0">{html.escape(e.body)}</p>{button}'
        '<p style="color:#8a929c;font-size:12px;margin-top:32px">If you didn\'t expect this email, you can ignore it.</p></div>'
    )
    return body, text


def _cta(subject: str) -> str:
    s = subject.lower()
    if "verify" in s:
        return "Verify email"
    if "sign-in" in s or "sign in" in s:
        return "Sign in"
    if "reset" in s:
        return "Choose a new password"
    if "invited" in s:
        return "Accept invitation"
    return "Open"


async def send(e: m.Email) -> None:
    s = get_settings()
    body_html, body_text = render(e)
    async with httpx.AsyncClient(timeout=20, transport=_transport) as client:
        if s.email_provider == "resend":
            payload = {"from": s.email_from, "to": [e.to], "subject": e.subject, "html": body_html, "text": body_text}
            if s.email_reply_to:
                payload["reply_to"] = s.email_reply_to
            r = await client.post("https://api.resend.com/emails", json=payload, headers={"Authorization": f"Bearer {s.email_api_key}", "Idempotency-Key": str(e.id)})
        elif s.email_provider == "postmark":
            payload = {"From": s.email_from, "To": e.to, "Subject": e.subject, "HtmlBody": body_html, "TextBody": body_text, "MessageStream": "outbound"}
            if s.email_reply_to:
                payload["ReplyTo"] = s.email_reply_to
            r = await client.post("https://api.postmarkapp.com/email", json=payload, headers={"X-Postmark-Server-Token": s.email_api_key or "", "Accept": "application/json"})
        else:
            return
    if r.status_code >= 400:
        # The provider's message is useful ("domain not verified", "invalid from"); it contains no secrets.
        raise RuntimeError(f"{s.email_provider} {r.status_code}: {r.text[:300]}")


async def deliver_once() -> int:
    s = get_settings()
    async with sessionmaker()() as db:
        q = select(m.Email).where(m.Email.status == "pending").order_by(m.Email.sent_at).limit(BATCH).with_for_update(skip_locked=True)
        rows = (await db.execute(q)).scalars().all()
        for e in rows:
            if s.email_provider == "log":
                e.status = "logged"
                continue
            # Back off between retries: 0s, 30s, 2m, 8m, …
            if e.attempts and e.last_error and now() - e.sent_at < dt.timedelta(seconds=30 * 4 ** (e.attempts - 1)):
                continue
            try:
                await send(e)
                e.status, e.delivered_at, e.last_error = "sent", now(), None
            except Exception as exc:  # noqa: BLE001 - recorded on the row, retried
                e.attempts += 1
                e.last_error = str(exc)[:1000]
                if e.attempts >= MAX_ATTEMPTS:
                    e.status = "failed"
                log.warning("email to %s failed (attempt %d): %s", e.to, e.attempts, e.last_error)
        await db.commit()
        return len(rows)


async def run_mailer(stop: asyncio.Event) -> None:
    while not stop.is_set():
        try:
            await deliver_once()
        except Exception:  # noqa: BLE001
            log.exception("mailer loop error")
        try:
            await asyncio.wait_for(stop.wait(), timeout=2)
        except TimeoutError:
            pass
