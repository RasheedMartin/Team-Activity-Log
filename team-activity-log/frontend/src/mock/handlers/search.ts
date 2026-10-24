import { http, HttpResponse } from "msw";
import type { Collection, FilterSpec, SavedView, SuggestResponse } from "../../api/contract";
import { uuidv7 } from "../../lib/ids";
import { db } from "../db";
import { engine, fail, publicUser, roleAtLeast, route, workspaceCtx } from "../server";

export const searchHandlers = [
  http.post(
    "/v1/orgs/:org/workspaces/:ws/search",
    route(async ({ cookies, params, request }) => {
      const ctx = workspaceCtx(cookies, params.org as string, params.ws as string);
      const spec = (await request.json()) as FilterSpec;
      // Tenant and permission filters are injected server-side, never taken from the client (§B4.1).
      const res = engine.search(spec, {
        orgId: ctx.org.id,
        workspaceIds: [ctx.ws.id],
        me: ctx.user.id,
        canSeeHidden: roleAtLeast(ctx.role, "admin"),
      });
      return HttpResponse.json(res);
    }),
  ),
  http.get(
    "/v1/orgs/:org/workspaces/:ws/explore",
    route(({ cookies, params }) => {
      const ctx = workspaceCtx(cookies, params.org as string, params.ws as string);
      const res = engine.explore({ orgId: ctx.org.id, workspaceIds: [ctx.ws.id], me: ctx.user.id, canSeeHidden: false });
      const groups = new Map(db.t.tagGroups.filter((g) => g.orgId === ctx.org.id).map((g) => [g.id, g.name]));
      res.shelves.forEach((sh) => (sh.groupName = (sh.tag.groupId && groups.get(sh.tag.groupId)) || "Other"));
      return HttpResponse.json(res);
    }),
  ),
  http.get(
    "/v1/orgs/:org/workspaces/:ws/suggest",
    route(({ cookies, params, request }) => {
      const ctx = workspaceCtx(cookies, params.org as string, params.ws as string);
      const q = (new URL(request.url).searchParams.get("q") ?? "").trim().toLowerCase();
      if (!q) return HttpResponse.json({ tags: [], people: [], posts: [] } satisfies SuggestResponse);
      const starts = (s: string) => s.toLowerCase().split(/[\s-]+/).some((w) => w.startsWith(q)) || s.toLowerCase().startsWith(q);
      const tags = db.t.tags.filter((t) => t.orgId === ctx.org.id && starts(t.name)).slice(0, 5).map(({ orgId: _o, ...t }) => (void _o, t));
      const people = db.t.memberships
        .filter((m) => m.orgId === ctx.org.id)
        .map((m) => db.t.users.get(m.userId))
        .filter((u) => !!u && (starts(u.name) || u.email.toLowerCase().startsWith(q)))
        .slice(0, 5)
        .map((u) => publicUser(u!));
      const posts = engine
        .search({ q, limit: 5, sort: "relevance" }, { orgId: ctx.org.id, workspaceIds: [ctx.ws.id], me: ctx.user.id, canSeeHidden: false })
        .hits.map((h) => ({ id: h.post.id, title: h.post.title }));
      return HttpResponse.json({ tags, people, posts } satisfies SuggestResponse);
    }, { flaky: false }),
  ),

  // ---- saved views ----
  http.get(
    "/v1/orgs/:org/workspaces/:ws/saved-views",
    route(({ cookies, params }) => {
      const ctx = workspaceCtx(cookies, params.org as string, params.ws as string);
      return HttpResponse.json(db.t.savedViews.filter((v) => v.workspaceId === ctx.ws.id && (v.shared || v.ownerId === ctx.user.id)));
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
      const v = db.t.savedViews.put({ id: uuidv7(), workspaceId: ctx.ws.id, ownerId: ctx.user.id, name: body.name.trim(), filterSpec, shared: !!body.shared, pinned: body.pinned ?? true });
      return HttpResponse.json(v, { status: 201 });
    }),
  ),
  http.patch(
    "/v1/orgs/:org/workspaces/:ws/saved-views/:id",
    route(async ({ cookies, params, request }) => {
      const ctx = workspaceCtx(cookies, params.org as string, params.ws as string);
      const v = db.t.savedViews.get(params.id as string);
      if (!v || v.workspaceId !== ctx.ws.id) fail(404, "not_found", "View not found");
      if (v!.ownerId !== ctx.user.id && !roleAtLeast(ctx.role, "admin")) fail(403, "forbidden", "Only the owner can change this view");
      const body = (await request.json()) as Partial<Pick<SavedView, "name" | "filterSpec" | "shared" | "pinned">>;
      return HttpResponse.json(db.t.savedViews.update(v!.id, body));
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

  // ---- collections ----
  http.get(
    "/v1/orgs/:org/workspaces/:ws/collections",
    route(({ cookies, params }) => {
      const ctx = workspaceCtx(cookies, params.org as string, params.ws as string);
      return HttpResponse.json(db.t.collections.filter((c) => c.workspaceId === ctx.ws.id));
    }),
  ),
  http.post(
    "/v1/orgs/:org/workspaces/:ws/collections",
    route(async ({ cookies, params, request }) => {
      const ctx = workspaceCtx(cookies, params.org as string, params.ws as string, "member");
      const body = (await request.json()) as Pick<Collection, "name" | "postIds" | "kind">;
      if (!body.name?.trim()) fail(422, "invalid", "Name the collection");
      const c = db.t.collections.put({ id: uuidv7(), workspaceId: ctx.ws.id, name: body.name.trim(), kind: body.kind ?? "manual", postIds: body.postIds ?? [], createdBy: ctx.user.id });
      c.postIds.forEach((pid) => {
        const p = db.t.posts.get(pid);
        if (p) db.t.posts.update(pid, { collectionIds: [...new Set([...(p.collectionIds ?? []), c.id])] });
      });
      return HttpResponse.json(c, { status: 201 });
    }),
  ),
  http.put(
    "/v1/orgs/:org/workspaces/:ws/collections/:id/posts",
    route(async ({ cookies, params, request }) => {
      const ctx = workspaceCtx(cookies, params.org as string, params.ws as string, "member");
      const c = db.t.collections.get(params.id as string);
      if (!c || c.workspaceId !== ctx.ws.id) fail(404, "not_found", "Collection not found");
      const { postIds } = (await request.json()) as { postIds: string[] };
      return HttpResponse.json(db.t.collections.update(c!.id, { postIds }));
    }),
  ),
];
