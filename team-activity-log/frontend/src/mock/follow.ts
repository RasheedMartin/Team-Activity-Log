import type { Collection, Post } from "../api/contract";
import { db } from "./db";
import { reindex } from "./server";

// Mirrors backend/src/tal/follow.py: notebooks following a tag get newly published posts with it.

function append(c: Collection, ids: string[]) {
  const fresh = ids.filter((id) => !c.postIds.includes(id));
  if (!fresh.length) return;
  db.t.collections.update(c.id, { postIds: [...c.postIds, ...fresh] });
  fresh.forEach(reindex);
}

export function postPublished(p: Post) {
  if (p.status !== "published" || p.deletedAt || !p.tagIds.length) return;
  db.t.collections.filter((c) => c.workspaceId === p.workspaceId && c.kind === "notebook" && !!c.followsTag && !!c.sourceTagId && p.tagIds.includes(c.sourceTagId)).forEach((c) => append(c, [p.id]));
}

export function backfill(c: Collection) {
  if (!c.followsTag || !c.sourceTagId) return;
  const ids = db.t.posts
    .filter((p) => p.workspaceId === c.workspaceId && p.status === "published" && !p.deletedAt && p.tagIds.includes(c.sourceTagId!))
    .sort((a, b) => a.workDate.localeCompare(b.workDate))
    .map((p) => p.id);
  append(c, ids);
}
