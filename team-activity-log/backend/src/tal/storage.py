"""Where image bytes live: Postgres (default, nothing else to configure) or any S3-compatible
bucket (AWS S3, Railway Buckets, Cloudflare R2, MinIO). Keys are org-prefixed (§B7):

    <prefix>/org/<org_id>/assets/<asset_id>/<variant>
"""

from __future__ import annotations

import asyncio
import uuid
from functools import lru_cache

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from . import models as m
from .config import get_settings


@lru_cache
def _s3():
    import boto3
    from botocore.config import Config

    s = get_settings()
    return boto3.client(
        "s3",
        endpoint_url=s.s3_endpoint or None,
        region_name=s.s3_region or None,
        aws_access_key_id=s.s3_access_key_id,
        aws_secret_access_key=s.s3_secret_access_key,
        config=Config(signature_version="s3v4", s3={"addressing_style": s.s3_addressing_style}, retries={"max_attempts": 3}),
    )


def _key(org_id: uuid.UUID, asset_id: uuid.UUID, variant: str) -> str:
    return f"{get_settings().s3_prefix}/org/{org_id}/assets/{asset_id}/{variant}"


async def put(db: AsyncSession, org_id: uuid.UUID, asset_id: uuid.UUID, variant: str, mime: str, data: bytes) -> None:
    if get_settings().storage == "s3":
        await asyncio.to_thread(_s3().put_object, Bucket=get_settings().s3_bucket, Key=_key(org_id, asset_id, variant), Body=data, ContentType=mime)
    else:
        db.add(m.AssetBlob(asset_id=asset_id, variant=variant, mime=mime, data=data))


async def get(db: AsyncSession, asset: m.Asset, variant: str) -> tuple[str, bytes] | None:
    """The variant if it was generated, else the original (small images have no smaller copies)."""
    if get_settings().storage == "s3":
        client = _s3()
        for v in dict.fromkeys([variant, "original"]):
            try:
                obj = await asyncio.to_thread(client.get_object, Bucket=get_settings().s3_bucket, Key=_key(asset.org_id, asset.id, v))
            except client.exceptions.NoSuchKey:
                continue
            body = await asyncio.to_thread(obj["Body"].read)
            return obj.get("ContentType") or asset.mime, body
        return None
    rows = (await db.execute(select(m.AssetBlob).where(m.AssetBlob.asset_id == asset.id, m.AssetBlob.variant.in_([variant, "original"])))).scalars().all()
    by = {r.variant: r for r in rows}
    hit = by.get(variant) or by.get("original")
    return (hit.mime, hit.data) if hit else None


# ---- arbitrary keys (profile photos and other non-asset files) ----


def user_key(*parts: str) -> str:
    return "/".join([get_settings().s3_prefix, *parts])


async def put_key(db: AsyncSession, key: str, mime: str, data: bytes) -> None:
    if get_settings().storage == "s3":
        await asyncio.to_thread(_s3().put_object, Bucket=get_settings().s3_bucket, Key=key, Body=data, ContentType=mime)
        return
    row = await db.get(m.Blob, key)
    if row:
        row.mime, row.data = mime, data
    else:
        db.add(m.Blob(key=key, mime=mime, data=data))


async def get_key(db: AsyncSession, key: str) -> tuple[str, bytes] | None:
    if get_settings().storage == "s3":
        client = _s3()
        try:
            obj = await asyncio.to_thread(client.get_object, Bucket=get_settings().s3_bucket, Key=key)
        except client.exceptions.NoSuchKey:
            return None
        return obj.get("ContentType") or "application/octet-stream", await asyncio.to_thread(obj["Body"].read)
    row = await db.get(m.Blob, key)
    return (row.mime, row.data) if row else None


async def delete_key(db: AsyncSession, key: str) -> None:
    if get_settings().storage == "s3":
        await asyncio.to_thread(_s3().delete_object, Bucket=get_settings().s3_bucket, Key=key)
        return
    row = await db.get(m.Blob, key)
    if row:
        await db.delete(row)


async def check() -> str:
    """For `tal check`: confirm the bucket is reachable with these credentials."""
    s = get_settings()
    if s.storage != "s3":
        return "Postgres (asset_blobs)"
    await asyncio.to_thread(_s3().head_bucket, Bucket=s.s3_bucket)
    return f"S3 bucket '{s.s3_bucket}'"


async def delete_prefix(db: AsyncSession, prefix: str) -> int:
    """Delete every stored object under a key prefix (an org's files, or everything). Returns a count."""
    if get_settings().storage == "s3":
        client, bucket, n = _s3(), get_settings().s3_bucket, 0
        token = None
        while True:
            kw = {"Bucket": bucket, "Prefix": prefix, **({"ContinuationToken": token} if token else {})}
            page = await asyncio.to_thread(client.list_objects_v2, **kw)
            keys = [{"Key": o["Key"]} for o in page.get("Contents", [])]
            for i in range(0, len(keys), 1000):
                await asyncio.to_thread(client.delete_objects, Bucket=bucket, Delete={"Objects": keys[i : i + 1000], "Quiet": True})
            n += len(keys)
            if not page.get("IsTruncated"):
                return n
            token = page.get("NextContinuationToken")
    rows = (await db.execute(select(m.Blob).where(m.Blob.key.like(prefix.replace("%", r"\%") + "%")))).scalars().all()
    for r in rows:
        await db.delete(r)
    return len(rows)
