"""Profile photos: validated by their bytes, re-encoded (which drops EXIF/GPS and anything
embedded), center-cropped to a 256px square, and stored under the user's key in storage (S3 in
production). `users.avatar_url` only ever holds the server's own URL, versioned for caching."""

from __future__ import annotations

import io
import time
import uuid

from PIL import Image, ImageOps, UnidentifiedImageError
from sqlalchemy.ext.asyncio import AsyncSession

from . import models as m
from . import storage
from .errors import fail
from .images import _sniff

MAX_BYTES = 8 * 1024 * 1024
SIZE = 256
RASTER = {"image/png", "image/jpeg", "image/gif", "image/webp"}  # no SVG: it can carry scripts


def key_for(user_id: uuid.UUID) -> str:
    return storage.user_key("users", str(user_id), "avatar")


def process(data: bytes) -> bytes:
    if len(data) > MAX_BYTES:
        fail(413, "too_large", "Profile photos must be under 8 MB")
    if _sniff(data) not in RASTER:
        fail(415, "unsupported_type", "Use a PNG, JPEG, GIF, or WebP image")
    try:
        img = Image.open(io.BytesIO(data))
        img.load()
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError):
        fail(415, "unsupported_type", "This image couldn't be read")
    img = ImageOps.exif_transpose(img).convert("RGB")
    img = ImageOps.fit(img, (SIZE, SIZE), Image.Resampling.LANCZOS)
    out = io.BytesIO()
    img.save(out, "JPEG", quality=88, optimize=True)
    return out.getvalue()


async def set_avatar(db: AsyncSession, user: m.User, data: bytes) -> None:
    await storage.put_key(db, key_for(user.id), "image/jpeg", process(data))
    user.avatar_url = f"/v1/users/{user.id}/avatar?v={int(time.time())}"


async def remove_avatar(db: AsyncSession, user: m.User) -> None:
    if user.avatar_url and user.avatar_url.startswith("/v1/users/"):
        await storage.delete_key(db, key_for(user.id))
    user.avatar_url = None
