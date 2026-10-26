import { http, HttpResponse } from "msw";
import { db } from "../db";
import { fail, requireUser, route } from "../server";
import { meResponse } from "./auth";

// Mirrors backend/src/tal/routes/superadmin.py (mock: the default persona is a super admin and
// "delete all data" is switched off).

const guard = (cookies: Record<string, string>) => {
  const u = requireUser(cookies);
  if (!meResponse(u).superAdmin) fail(404, "not_found", "Not found");
  return u;
};

export const superadminHandlers = [
  http.get(
    "/v1/super/overview",
    route(({ cookies }) => {
      guard(cookies);
      const orgs = db.t.orgs.all().map((o) => ({
        id: o.id,
        name: o.name,
        slug: o.slug,
        plan: "free",
        createdAt: (o as { createdAt?: string }).createdAt ?? new Date().toISOString(),
        members: db.t.memberships.filter((m) => m.orgId === o.id && m.status === "active").length,
        posts: db.t.posts.filter((p) => p.orgId === o.id && !p.deletedAt).length,
        storageBytes: db.t.assets.filter((a) => a.orgId === o.id).reduce((n, a) => n + a.bytes, 0),
      }));
      return HttpResponse.json({
        totals: { users: db.t.users.all().length, orgs: orgs.length, posts: orgs.reduce((n, o) => n + o.posts, 0), storageBytes: orgs.reduce((n, o) => n + o.storageBytes, 0) },
        orgs,
        wipeAllowed: false,
      });
    }),
  ),
  http.delete(
    "/v1/super/orgs/:id",
    route(async ({ cookies, params, request }) => {
      guard(cookies);
      const o = db.t.orgs.get(params.id as string);
      if (!o) fail(404, "not_found", "Organization not found");
      const { confirm } = (await request.json()) as { confirm?: string };
      if (confirm !== o!.slug) fail(422, "confirm", `Type the organization's URL name (${o!.slug}) to confirm`);
      db.t.memberships.filter((m) => m.orgId === o!.id).forEach((m) => db.t.memberships.delete(m.id));
      db.t.workspaces.filter((w) => w.orgId === o!.id).forEach((w) => db.t.workspaces.delete(w.id));
      db.t.posts.filter((p) => p.orgId === o!.id).forEach((p) => db.t.posts.delete(p.id));
      db.t.orgs.delete(o!.id);
      return HttpResponse.json({ deleted: o!.slug });
    }),
  ),
  http.post("/v1/super/wipe", route(({ cookies }) => (guard(cookies), fail(403, "wipe_disabled", "Deleting everything is switched off on this server")))),
];
