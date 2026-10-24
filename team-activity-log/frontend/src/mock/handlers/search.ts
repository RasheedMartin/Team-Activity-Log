import { http, HttpResponse } from "msw";
import type { FilterSpec, SuggestResponse } from "../../api/contract";
import { db } from "../db";
import { engine, publicUser, roleAtLeast, route, workspaceCtx } from "../server";

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
      const tagNotebooks = new Map(db.t.collections.filter((c) => c.workspaceId === ctx.ws.id && c.kind === "notebook" && !!c.sourceTagId).map((c) => [c.sourceTagId!, c.id]));
      res.shelves.forEach((sh) => {
        sh.groupName = (sh.tag.groupId && groups.get(sh.tag.groupId)) || "Other";
        sh.notebookId = tagNotebooks.get(sh.tag.id);
      });
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
];
