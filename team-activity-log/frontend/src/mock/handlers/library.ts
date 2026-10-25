import { http, HttpResponse } from "msw";
import type { Collection, CollectionRole, ID, LibraryItem, LibraryKind, LibraryPage, PinRef, Presentation, SavedView } from "../../api/contract";
import { uuidv7 } from "../../lib/ids";
import { db } from "../db";
import { engine, fail, now, reindex, roleAtLeast, route, workspaceCtx, type OrgCtx } from "../server";
import { membersOf, requireRole, roleIn, setMembers, sharedWith } from "./collectionAccess";
import { backfill } from "../follow";

// Saved views, collections, and notebooks — built for scale (owner request): a paged, searchable
// library; per-user pins for the rail; single-item reads. In Postgres: saved_views, collections,
// and a user_pins(user_id, workspace_id, kind, item_id, position) table.

const pinKey = (userId: ID, wsId: ID) => `pins:${userId}:${wsId}`;
export const getPins = (userId: ID, wsId: ID): PinRef[] => db.meta<PinRef[]>(pinKey(userId, wsId)) ?? [];
export const setPins = (userId: ID, wsId: ID, pins: PinRef[]) => db.setMeta(pinKey(userId, wsId), pins);
const isPinned = (userId: ID, wsId: ID, kind: LibraryKind, id: ID) => getPins(userId, wsId).some((p) => p.kind === kind && p.id === id);
function togglePin(userId: ID, wsId: ID, ref: PinRef, on: boolean) {
  const pins = getPins(userId, wsId).filter((p) => !(p.kind === ref.kind && p.id === ref.id));
  setPins(userId, wsId, on ? [...pins, ref] : pins);
}

// Only imported decks are "collections" now; anything hand-picked (older rows too) is a notebook.
const kindOf = (c: Collection): LibraryKind => (c.kind === "deck_import" ? "collection" : "notebook");
const viewItem = (v: SavedView, me: ID): LibraryItem => ({ kind: "view", id: v.id, name: v.name, ownerId: v.ownerId, shared: v.shared, pinned: isPinned(me, v.workspaceId, "view", v.id), updatedAt: v.updatedAt ?? "1970-01-01T00:00:00Z", filterSpec: v.filterSpec });
/** Like the server (views.visible_to): deleted posts, and others' drafts or hidden posts, drop out
 *  of what a person sees in a collection; membership stays, so restoring or publishing one puts it
 *  back in place. */
const seesPost = (id: ID, me?: ID) => {
  const p = db.t.posts.get(id);
  return !!p && !p.deletedAt && (!me || ((p.status === "published" || p.authorId === me) && (p.visibility === "visible" || p.authorId === me)));
};
const live = (c: Collection, me?: ID): Collection => ({ ...c, postIds: c.postIds.filter((id) => seesPost(id, me)) });

/** A collection as the caller sees it: their visible posts, its members, and their role. */
const view = (c: Collection, ctx: Pick<OrgCtx, "user" | "role">): Collection => {
  // Several imports can extend one deck or notebook: every file it came from, oldest first.
  const sources = db.t.importJobs
    .filter((j) => j.collectionId === c.id && j.status === "done")
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((job) => ({ importJobId: job.id, fileName: job.sourceFilename, fileKind: job.defaults.fileKind ?? "pptx", originalKept: !!job.originalBlob }));
  return { ...live(c, ctx.user.id), visibility: c.visibility ?? "workspace", members: membersOf(c), myRole: roleIn(ctx, c) as CollectionRole, ...(sources.length ? { sources, source: sources[0] } : {}) };
};

const collectionItem = (c: Collection, me: ID): LibraryItem => ({ kind: kindOf(c), id: c.id, name: c.name, ownerId: c.createdBy, shared: c.visibility !== "people", sharedWithMe: sharedWith(c, me), pinned: isPinned(me, c.workspaceId, kindOf(c), c.id), updatedAt: c.updatedAt ?? "1970-01-01T00:00:00Z", postCount: live(c, me).postIds.length, collectionKind: c.kind });
const withPinned = (v: SavedView, me: ID): SavedView => ({ ...v, pinned: isPinned(me, v.workspaceId, "view", v.id) });

/** Everything in a workspace the caller can see, as library items. */
function libraryItems(wsId: ID, me: ID): LibraryItem[] {
  return [
    ...db.t.savedViews.filter((v) => v.workspaceId === wsId && (v.shared || v.ownerId === me)).map((v) => viewItem(v, me)),
    // A collection with nothing the person can see (e.g. all someone else's drafts) isn't listed, except their own.
    ...db.t.collections
      .filter((c) => c.workspaceId === wsId && (c.visibility !== "people" || c.createdBy === me || sharedWith(c, me)) && (c.createdBy === me || sharedWith(c, me) || live(c, me).postIds.length > 0))
      .map((c) => collectionItem(c, me)),
  ];
}

function assertUniqueNotebookName(workspaceId: string, name: string, exceptId?: string) {
  const clash = db.t.collections.find((c) => c.workspaceId === workspaceId && c.kind === "notebook" && c.id !== exceptId && c.name.trim().toLowerCase() === name.trim().toLowerCase());
  if (clash) fail(409, "name_taken", `A notebook named “${clash.name}” already exists`, { existingId: clash.id });
}

function syncPostCollections(c: Collection, before: ID[]) {
  new Set([...before, ...c.postIds]).forEach((pid) => {
    const p = db.t.posts.get(pid);
    if (!p) return;
    const ids = new Set(p.collectionIds ?? []);
    if (c.postIds.includes(pid)) ids.add(c.id);
    else ids.delete(c.id);
    db.t.posts.update(pid, { collectionIds: [...ids] });
    engine.touch(pid);
  });
}

const PAGE = 40;

export const libraryHandlers = [
  // ---- library: search, filter, sort, page ----
  http.get(
    "/v1/orgs/:org/workspaces/:ws/library",
    route(({ cookies, params, request }) => {
      const ctx = workspaceCtx(cookies, params.org as string, params.ws as string);
      const u = new URL(request.url).searchParams;
      const kind = u.get("kind") as LibraryKind | null;
      const q = (u.get("q") ?? "").trim().toLowerCase();
      const mine = u.get("mine") === "1";
      const shared = u.get("shared") === "1";
      const sort = u.get("sort") === "name" ? "name" : "recent";
      const limit = Math.min(200, Number(u.get("limit") ?? PAGE));
      const offset = Number(u.get("cursor") ?? 0);
      const scoped = libraryItems(ctx.ws.id, ctx.user.id).filter((i) => (!q || i.name.toLowerCase().includes(q)) && (!mine || i.ownerId === ctx.user.id) && (!shared || !!i.sharedWithMe));
      const counts: Record<LibraryKind, number> = { view: 0, notebook: 0, collection: 0 };
      scoped.forEach((i) => counts[i.kind]++);
      const list = scoped
        .filter((i) => !kind || i.kind === kind)
        .sort((a, b) => (sort === "name" ? a.name.localeCompare(b.name) : b.updatedAt.localeCompare(a.updatedAt)) || a.id.localeCompare(b.id));
      const page: LibraryPage = { items: list.slice(offset, offset + limit), total: list.length, counts, nextCursor: offset + limit < list.length ? String(offset + limit) : undefined };
      return HttpResponse.json(page);
    }),
  ),

  // ---- pins (per user, ordered) ----
  http.get(
    "/v1/orgs/:org/workspaces/:ws/pins",
    route(({ cookies, params }) => {
      const ctx = workspaceCtx(cookies, params.org as string, params.ws as string);
      const all = new Map(libraryItems(ctx.ws.id, ctx.user.id).map((i) => [`${i.kind}:${i.id}`, i]));
      // Pins to items that were deleted (or are no longer visible) drop out silently.
      return HttpResponse.json(getPins(ctx.user.id, ctx.ws.id).map((p) => all.get(`${p.kind}:${p.id}`)).filter((i): i is LibraryItem => !!i));
    }, { flaky: false }),
  ),
  http.put(
    "/v1/orgs/:org/workspaces/:ws/pins",
    route(async ({ cookies, params, request }) => {
      const ctx = workspaceCtx(cookies, params.org as string, params.ws as string);
      const { items } = (await request.json()) as { items: PinRef[] };
      const valid = new Set(libraryItems(ctx.ws.id, ctx.user.id).map((i) => `${i.kind}:${i.id}`));
      setPins(ctx.user.id, ctx.ws.id, (items ?? []).filter((p) => valid.has(`${p.kind}:${p.id}`)).slice(0, 50));
      return new HttpResponse(null, { status: 204 });
    }),
  ),

  // ---- saved views ----
  http.get(
    "/v1/orgs/:org/workspaces/:ws/saved-views/:id",
    route(({ cookies, params }) => {
      const ctx = workspaceCtx(cookies, params.org as string, params.ws as string);
      const v = db.t.savedViews.get(params.id as string);
      if (!v || v.workspaceId !== ctx.ws.id || (!v.shared && v.ownerId !== ctx.user.id)) fail(404, "not_found", "View not found");
      return HttpResponse.json(withPinned(v!, ctx.user.id));
    }),
  ),
  http.post(
    "/v1/orgs/:org/workspaces/:ws/saved-views",
    route(async ({ cookies, params, request }) => {
      const ctx = workspaceCtx(cookies, params.org as string, params.ws as string);
      const body = (await request.json()) as Pick<SavedView, "name" | "filterSpec" | "shared" | "pinned">;
      if (!body.name?.trim()) fail(422, "invalid", "Name the view");
      const { cursor: _c, limit: _l, ...filterSpec } = body.filterSpec;
      void _c;
      void _l;
      const v = db.t.savedViews.put({ id: uuidv7(), workspaceId: ctx.ws.id, ownerId: ctx.user.id, name: body.name.trim(), filterSpec, shared: !!body.shared, pinned: false, updatedAt: now() });
      if (body.pinned ?? true) togglePin(ctx.user.id, ctx.ws.id, { kind: "view", id: v.id }, true);
      return HttpResponse.json(withPinned(v, ctx.user.id), { status: 201 });
    }),
  ),
  http.patch(
    "/v1/orgs/:org/workspaces/:ws/saved-views/:id",
    route(async ({ cookies, params, request }) => {
      const ctx = workspaceCtx(cookies, params.org as string, params.ws as string);
      const v = db.t.savedViews.get(params.id as string);
      if (!v || v.workspaceId !== ctx.ws.id || (!v.shared && v.ownerId !== ctx.user.id)) fail(404, "not_found", "View not found");
      const body = (await request.json()) as Partial<Pick<SavedView, "name" | "filterSpec" | "shared" | "pinned">>;
      // Pinning is personal, so anyone who can see a view may pin it; editing it needs ownership.
      if (body.pinned !== undefined) togglePin(ctx.user.id, ctx.ws.id, { kind: "view", id: v!.id }, body.pinned);
      const { pinned: _p, ...edits } = body;
      void _p;
      if (Object.keys(edits).length) {
        if (v!.ownerId !== ctx.user.id && !roleAtLeast(ctx.role, "admin")) fail(403, "forbidden", "Only the owner can change this view");
        if (edits.name !== undefined && !edits.name.trim()) fail(422, "invalid", "Name can't be empty");
        db.t.savedViews.update(v!.id, { ...edits, ...(edits.name ? { name: edits.name.trim() } : {}), updatedAt: now() });
      }
      return HttpResponse.json(withPinned(db.t.savedViews.get(v!.id)!, ctx.user.id));
    }),
  ),
  http.delete(
    "/v1/orgs/:org/workspaces/:ws/saved-views/:id",
    route(({ cookies, params }) => {
      const ctx = workspaceCtx(cookies, params.org as string, params.ws as string);
      const v = db.t.savedViews.get(params.id as string);
      if (!v || v.workspaceId !== ctx.ws.id) fail(404, "not_found", "View not found");
      if (v!.ownerId !== ctx.user.id && !roleAtLeast(ctx.role, "admin")) fail(403, "forbidden", "Only the owner can delete this view");
      db.t.savedViews.delete(v!.id);
      return new HttpResponse(null, { status: 204 });
    }),
  ),

  // ---- collections & notebooks ----
  http.get(
    "/v1/orgs/:org/workspaces/:ws/collections/:id",
    route(({ cookies, params }) => {
      const ctx = workspaceCtx(cookies, params.org as string, params.ws as string);
      const c = db.t.collections.get(params.id as string);
      if (!c || c.workspaceId !== ctx.ws.id) fail(404, "not_found", "Collection not found");
      const seen = view(c!, ctx);
      if (roleIn(ctx, c!) === "none" || (!seen.postIds.length && seen.myRole === "viewer" && !sharedWith(c!, ctx.user.id))) fail(404, "not_found", "Collection not found");
      return HttpResponse.json(seen);
    }),
  ),
  http.get(
    "/v1/orgs/:org/workspaces/:ws/collections/:id/entries",
    route(({ cookies, params }) => {
      const ctx = workspaceCtx(cookies, params.org as string, params.ws as string);
      const c = db.t.collections.get(params.id as string);
      if (!c || c.workspaceId !== ctx.ws.id) fail(404, "not_found", "Collection not found");
      // In collection order; posts the caller can't see (others' drafts, deleted, hidden) are skipped.
      const entries = c!.postIds
        .map((id) => db.t.posts.get(id))
        .filter((p) => !!p && !p.deletedAt && (p.status === "published" || p.authorId === ctx.user.id) && (p.visibility === "visible" || p.authorId === ctx.user.id || roleAtLeast(ctx.role, "admin")))
        .map((p) => ({ id: p!.id, title: p!.title, workDate: p!.workDate, authorId: p!.authorId, status: p!.status }));
      return HttpResponse.json(entries);
    }),
  ),
  http.post(
    "/v1/orgs/:org/workspaces/:ws/collections",
    route(async ({ cookies, params, request }) => {
      const ctx = workspaceCtx(cookies, params.org as string, params.ws as string, "member");
      const body = (await request.json()) as Pick<Collection, "name" | "postIds" | "kind" | "sourceTagId">;
      if (!body.name?.trim()) fail(422, "invalid", "Name the collection");
      if (body.kind === "notebook") {
        // One notebook per tag (survives renames), and notebook names are unique.
        const byTag = body.sourceTagId ? db.t.collections.find((c) => c.workspaceId === ctx.ws.id && c.kind === "notebook" && c.sourceTagId === body.sourceTagId) : undefined;
        if (byTag) fail(409, "exists", `This tag already has a notebook: “${byTag.name}”`, { existingId: byTag.id });
        assertUniqueNotebookName(ctx.ws.id, body.name);
      }
      const c = db.t.collections.put({ id: uuidv7(), workspaceId: ctx.ws.id, name: body.name.trim(), kind: "notebook", followsTag: !!body.sourceTagId || undefined, postIds: body.postIds ?? [], createdBy: ctx.user.id, updatedAt: now(), sourceTagId: body.sourceTagId });
      syncPostCollections(c, []);
      return HttpResponse.json(view(c, ctx), { status: 201 });
    }),
  ),
  http.patch(
    "/v1/orgs/:org/workspaces/:ws/collections/:id",
    route(async ({ cookies, params, request }) => {
      const ctx = workspaceCtx(cookies, params.org as string, params.ws as string);
      const c = db.t.collections.get(params.id as string);
      if (!c || c.workspaceId !== ctx.ws.id) fail(404, "not_found", "Collection not found");
      const { name, pinned, presentation, followTagId } = (await request.json()) as { name?: string; pinned?: boolean; presentation?: Presentation | null; followTagId?: string | null };
      if (followTagId !== undefined) {
        requireRole(ctx, c!, "editor");
        if (followTagId) {
          const clash = db.t.collections.find((x) => x.workspaceId === ctx.ws.id && x.kind === "notebook" && x.sourceTagId === followTagId && x.id !== c!.id);
          if (clash) fail(409, "exists", `“${clash.name}” already follows this tag`, { existingId: clash.id });
          backfill(db.t.collections.update(c!.id, { sourceTagId: followTagId, followsTag: true, updatedAt: now() })!);
        } else db.t.collections.update(c!.id, { followsTag: false, updatedAt: now() });
      }
      if (pinned !== undefined) togglePin(ctx.user.id, ctx.ws.id, { kind: kindOf(c!), id: c!.id }, pinned);
      if (name !== undefined) {
        requireRole(ctx, c!, "editor");
        if (!name.trim()) fail(422, "invalid", "Name can't be empty");
        if (c!.kind === "notebook") assertUniqueNotebookName(ctx.ws.id, name, c!.id);
        db.t.collections.update(c!.id, { name: name.trim(), updatedAt: now() });
      }
      if (presentation !== undefined) {
        requireRole(ctx, c!, "editor");
        db.t.collections.update(c!.id, { presentation: presentation ?? undefined, updatedAt: now() });
      }
      return HttpResponse.json(view(db.t.collections.get(c!.id)!, ctx));
    }),
  ),
  http.put(
    "/v1/orgs/:org/workspaces/:ws/collections/:id/posts",
    route(async ({ cookies, params, request }) => {
      const ctx = workspaceCtx(cookies, params.org as string, params.ws as string, "member");
      const c = db.t.collections.get(params.id as string);
      if (!c || c.workspaceId !== ctx.ws.id) fail(404, "not_found", "Collection not found");
      requireRole(ctx, c!, "editor");
      const { postIds: arranged } = (await request.json()) as { postIds: string[] };
      const before = c!.postIds;
      // Keep members this person can't see (others' drafts, deleted posts) after the ones they arranged.
      const postIds = [...arranged, ...before.filter((id) => !seesPost(id, ctx.user.id) && !arranged.includes(id))];
      const next = db.t.collections.update(c!.id, { postIds, updatedAt: now() })!;
      syncPostCollections(next, before);
      return HttpResponse.json(view(next, ctx));
    }),
  ),
  http.delete(
    "/v1/orgs/:org/workspaces/:ws/collections/:id",
    route(({ cookies, params, request }) => {
      const ctx = workspaceCtx(cookies, params.org as string, params.ws as string, "member");
      const c = db.t.collections.get(params.id as string);
      if (!c || c.workspaceId !== ctx.ws.id) fail(404, "not_found", "Collection not found");
      requireRole(ctx, c!, "owner");
      // Removes the grouping; with deleteMyPosts the caller's own posts go to the recycle bin too.
      const deletedPostIds: string[] = [];
      if (new URL(request.url).searchParams.get("deleteMyPosts") === "true") {
        const t = now();
        for (const id of c!.postIds) {
          const p = db.t.posts.get(id);
          if (p && p.authorId === ctx.user.id && !p.deletedAt) {
            db.t.posts.put({ ...p, deletedAt: t, version: p.version + 1, updatedAt: t });
            reindex(p.id);
            deletedPostIds.push(p.id);
          }
        }
      }
      syncPostCollections({ ...c!, postIds: [] }, c!.postIds);
      db.t.collections.delete(c!.id);
      return HttpResponse.json({ deletedPostIds });
    }),
  ),
  http.put(
    "/v1/orgs/:org/workspaces/:ws/collections/:id/members",
    route(async ({ cookies, params, request }) => {
      const ctx = workspaceCtx(cookies, params.org as string, params.ws as string, "member");
      const c = db.t.collections.get(params.id as string);
      if (!c || c.workspaceId !== ctx.ws.id) fail(404, "not_found", "Collection not found");
      requireRole(ctx, c!, "owner");
      const { members = [], visibility } = (await request.json()) as { members?: { userId: ID; role: CollectionRole }[]; visibility?: Collection["visibility"] };
      if (visibility) db.t.collections.update(c!.id, { visibility });
      if (members.some((x) => !["viewer", "editor", "owner"].includes(x.role))) fail(422, "invalid", "Each member needs a person and a role (viewer, editor, owner)");
      setMembers(c!, members);
      return HttpResponse.json(view(db.t.collections.get(c!.id)!, ctx)); // re-read: visibility may have changed
    }),
  ),
];
