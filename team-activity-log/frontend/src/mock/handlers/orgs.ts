import { http, HttpResponse } from "msw";
import type { Invite, OrgRole, Tag, Workspace } from "../../api/contract";
import { addDays, todayISO } from "../../lib/dates";
import { uuidv7 } from "../../lib/ids";
import { db, type InviteRow } from "../db";
import { TAG_COLORS } from "../seed";
import {
  accessibleWorkspaces,
  currentUser,
  fail,
  membershipView,
  newSessionCookie,
  now,
  orgCtx,
  publicUser,
  requireUser,
  roleAtLeast,
  route,
} from "../server";
import { meResponse, sendEmail } from "./auth";

const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
const RESERVED = new Set(["admin", "api", "app", "dev", "me", "new", "o", "register", "settings", "v1"]);
const slugTaken = (slug: string) => RESERVED.has(slug) || !!db.t.orgs.find((o) => o.slug === slug);

function inviteView(i: InviteRow): Invite {
  const { token: _t, name: _n, ...rest } = i;
  void _t;
  void _n;
  const expired = i.status === "pending" && i.expiresAt < now();
  return { ...rest, status: expired ? "expired" : i.status };
}

function issueInvite(orgId: string, email: string, role: OrgRole, workspaceIds: string[], invitedBy: string, name?: string) {
  const token = uuidv7().replace(/-/g, "");
  const inv = db.t.invites.put({ id: uuidv7(), orgId, email: email.trim().toLowerCase(), name, role, workspaceIds, status: "pending", token, expiresAt: `${addDays(todayISO(), 7)}T00:00:00Z`, invitedBy, createdAt: now() });
  const org = db.t.orgs.get(orgId);
  sendEmail(inv.email, `You're invited to ${org?.name}`, `${db.t.users.get(invitedBy)?.name} invited you to join ${org?.name} as ${role}.`, `/accept-invite/${token}`);
  return inv;
}

export const orgHandlers = [
  http.get(
    "/v1/orgs/slug-available",
    route(({ request }) => {
      const slug = slugify(new URL(request.url).searchParams.get("slug") ?? "");
      return HttpResponse.json({ slug, available: !!slug && !slugTaken(slug) });
    }, { flaky: false }),
  ),
  http.post(
    "/v1/orgs",
    route(async ({ cookies, request }) => {
      const u = requireUser(cookies);
      const { name, slug: rawSlug, workspaceName } = (await request.json()) as { name: string; slug: string; workspaceName?: string };
      const slug = slugify(rawSlug || name);
      if (!name?.trim()) fail(422, "invalid", "Name your organization");
      if (!slug || slugTaken(slug)) fail(409, "slug_taken", "That URL is taken, try another");
      const org = db.t.orgs.put({ id: uuidv7(), name: name.trim(), slug });
      const wsName = workspaceName?.trim() || "General";
      const ws = db.t.workspaces.put({ id: uuidv7(), orgId: org.id, name: wsName, slug: slugify(wsName) || "general", archived: false, allOrgMembers: true });
      db.t.memberships.put({ id: uuidv7(), orgId: org.id, userId: u.id, role: "owner", status: "active", workspaceIds: [ws.id] });
      for (const [g, names] of [["Status", ["in-progress", "blocked", "done"]], ["Topic", ["calibration", "analysis", "hardware"]]] as const) {
        const group = db.t.tagGroups.put({ id: uuidv7(), orgId: org.id, name: g });
        names.forEach((n, i) => db.t.tags.put({ id: uuidv7(), orgId: org.id, name: n, color: TAG_COLORS[(i * 3 + g.length) % TAG_COLORS.length], groupId: group.id }));
      }
      db.setMeta(`lastWs:${u.id}`, ws.id);
      return HttpResponse.json(meResponse(u), { status: 201 });
    }),
  ),
  http.patch(
    "/v1/orgs/:org",
    route(async ({ cookies, params, request }) => {
      const ctx = orgCtx(cookies, params.org as string, "owner");
      const { name } = (await request.json()) as { name?: string };
      if (name?.trim()) db.t.orgs.update(ctx.org.id, { name: name.trim() });
      return HttpResponse.json(db.t.orgs.get(ctx.org.id));
    }),
  ),

  // ---- people & members ----
  http.get(
    "/v1/orgs/:org/people",
    route(({ cookies, params }) => {
      const ctx = orgCtx(cookies, params.org as string);
      const users = db.t.memberships.filter((m) => m.orgId === ctx.org.id && m.status !== "invited").map((m) => db.t.users.get(m.userId)).filter((u) => !!u);
      return HttpResponse.json(users.map((u) => publicUser(u!)));
    }),
  ),
  http.get(
    "/v1/orgs/:org/members",
    route(({ cookies, params }) => {
      const ctx = orgCtx(cookies, params.org as string);
      return HttpResponse.json(db.t.memberships.filter((m) => m.orgId === ctx.org.id).map(membershipView));
    }),
  ),
  http.patch(
    "/v1/orgs/:org/members/:userId",
    route(async ({ cookies, params, request }) => {
      const ctx = orgCtx(cookies, params.org as string, "admin");
      const m = db.t.memberships.find((x) => x.orgId === ctx.org.id && x.userId === params.userId) ?? fail(404, "not_found", "Member not found");
      const body = (await request.json()) as { role?: OrgRole; status?: "active" | "deactivated"; workspaceIds?: string[] };
      const owners = db.t.memberships.filter((x) => x.orgId === ctx.org.id && x.role === "owner" && x.status === "active");
      if (m.role === "owner" && ctx.role !== "owner") fail(403, "forbidden", "Only an owner can change another owner");
      if (body.role === "owner" && ctx.role !== "owner") fail(403, "forbidden", "Only an owner can grant ownership");
      const losingOwner = m.role === "owner" && ((body.role && body.role !== "owner") || body.status === "deactivated");
      if (losingOwner && owners.length <= 1) fail(409, "last_owner", "The last owner can't be removed. Transfer ownership first.");
      db.t.memberships.update(m.id, {
        ...(body.role ? { role: body.role } : {}),
        ...(body.status ? { status: body.status } : {}),
        ...(body.workspaceIds ? { workspaceIds: body.workspaceIds } : {}),
      });
      if (body.status === "deactivated") db.t.sessions.filter((s) => s.userId === m.userId).forEach((s) => db.t.sessions.update(s.id, { revokedAt: now() }));
      return HttpResponse.json(membershipView(db.t.memberships.get(m.id)!));
    }),
  ),
  http.delete(
    "/v1/orgs/:org/members/:userId",
    route(({ cookies, params }) => {
      const ctx = orgCtx(cookies, params.org as string, "admin");
      const m = db.t.memberships.find((x) => x.orgId === ctx.org.id && x.userId === params.userId) ?? fail(404, "not_found", "Member not found");
      if (m.role === "owner") fail(409, "last_owner", "Transfer ownership before removing an owner");
      db.t.memberships.delete(m.id);
      return new HttpResponse(null, { status: 204 });
    }),
  ),
  http.post(
    "/v1/orgs/:org/transfer",
    route(async ({ cookies, params, request }) => {
      const ctx = orgCtx(cookies, params.org as string, "owner");
      const { userId } = (await request.json()) as { userId: string };
      const target = db.t.memberships.find((x) => x.orgId === ctx.org.id && x.userId === userId && x.status === "active") ?? fail(404, "not_found", "Member not found");
      db.t.memberships.update(target.id, { role: "owner" });
      db.t.memberships.update(ctx.membership.id, { role: "admin" });
      return new HttpResponse(null, { status: 204 });
    }),
  ),

  // ---- invites ----
  http.get(
    "/v1/orgs/:org/invites",
    route(({ cookies, params }) => {
      const ctx = orgCtx(cookies, params.org as string, "admin");
      return HttpResponse.json(db.t.invites.filter((i) => i.orgId === ctx.org.id && i.status !== "accepted").map(inviteView).sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
    }),
  ),
  http.post(
    "/v1/orgs/:org/invites",
    route(async ({ cookies, params, request }) => {
      const ctx = orgCtx(cookies, params.org as string, "admin");
      const { invites } = (await request.json()) as { invites: { email: string; name?: string; role: OrgRole; workspaceIds: string[] }[] };
      const results = invites.map((i) => {
        if (!/^\S+@\S+\.\S+$/.test(i.email)) return { email: i.email, error: "Invalid email" };
        if (i.role === "owner") return { email: i.email, error: "Invite as admin, then transfer ownership" };
        const existingUser = db.t.users.find((u) => u.email.toLowerCase() === i.email.toLowerCase());
        if (existingUser && db.t.memberships.find((m) => m.orgId === ctx.org.id && m.userId === existingUser.id)) return { email: i.email, error: "Already a member" };
        db.t.invites.filter((x) => x.orgId === ctx.org.id && x.email === i.email.toLowerCase() && x.status === "pending").forEach((x) => db.t.invites.update(x.id, { status: "revoked" }));
        return { email: i.email, invite: inviteView(issueInvite(ctx.org.id, i.email, i.role, i.workspaceIds, ctx.user.id, i.name)) };
      });
      return HttpResponse.json(results, { status: 201 });
    }),
  ),
  http.post(
    "/v1/orgs/:org/invites/:id/resend",
    route(({ cookies, params }) => {
      const ctx = orgCtx(cookies, params.org as string, "admin");
      const inv = db.t.invites.get(params.id as string);
      if (!inv || inv.orgId !== ctx.org.id) fail(404, "not_found", "Invite not found");
      db.t.invites.update(inv!.id, { status: "revoked" });
      return HttpResponse.json(inviteView(issueInvite(ctx.org.id, inv!.email, inv!.role, inv!.workspaceIds, ctx.user.id, inv!.name)));
    }),
  ),
  http.delete(
    "/v1/orgs/:org/invites/:id",
    route(({ cookies, params }) => {
      const ctx = orgCtx(cookies, params.org as string, "admin");
      const inv = db.t.invites.get(params.id as string);
      if (!inv || inv.orgId !== ctx.org.id) fail(404, "not_found", "Invite not found");
      db.t.invites.update(inv!.id, { status: "revoked" });
      return new HttpResponse(null, { status: 204 });
    }),
  ),
  http.get(
    "/v1/orgs/:org/invite-links",
    route(({ cookies, params }) => {
      const ctx = orgCtx(cookies, params.org as string, "admin");
      return HttpResponse.json(db.t.inviteLinks.filter((l) => l.orgId === ctx.org.id && l.expiresAt > now()));
    }),
  ),
  http.post(
    "/v1/orgs/:org/invite-links",
    route(async ({ cookies, params, request }) => {
      const ctx = orgCtx(cookies, params.org as string, "admin");
      const { roleCap, days } = (await request.json()) as { roleCap: OrgRole; days: number };
      const link = db.t.inviteLinks.put({ id: uuidv7(), orgId: ctx.org.id, token: `link-${uuidv7().slice(-12)}`, roleCap: roleCap === "owner" ? "admin" : roleCap, expiresAt: `${addDays(todayISO(), days || 7)}T00:00:00Z` });
      return HttpResponse.json(link, { status: 201 });
    }),
  ),
  http.delete(
    "/v1/orgs/:org/invite-links/:id",
    route(({ cookies, params }) => {
      const ctx = orgCtx(cookies, params.org as string, "admin");
      const l = db.t.inviteLinks.get(params.id as string);
      if (l?.orgId === ctx.org.id) db.t.inviteLinks.delete(l.id);
      return new HttpResponse(null, { status: 204 });
    }),
  ),

  // Public: look up an invite token (for the accept screen).
  http.get(
    "/v1/invites/:token",
    route(({ params }) => {
      const token = params.token as string;
      const inv = db.t.invites.find((i) => i.token === token);
      const link = db.t.inviteLinks.find((l) => l.token === token);
      if (link) {
        const org = db.t.orgs.get(link.orgId)!;
        return HttpResponse.json({ kind: "link", org, role: link.roleCap, status: link.expiresAt < now() ? "expired" : "pending" });
      }
      if (!inv) fail(404, "invalid_token", "This invite link isn't valid");
      const view = inviteView(inv!);
      const org = db.t.orgs.get(inv!.orgId)!;
      const hasAccount = !!db.t.users.find((u) => u.email.toLowerCase() === inv!.email);
      return HttpResponse.json({ kind: "invite", org, email: inv!.email, name: inv!.name, role: inv!.role, status: view.status, hasAccount });
    }),
  ),
  http.post(
    "/v1/invites/:token/accept",
    route(async ({ cookies, params, request }) => {
      const token = params.token as string;
      const body = (await request.json()) as { name?: string; password?: string; email?: string };
      const inv = db.t.invites.find((i) => i.token === token);
      const link = db.t.inviteLinks.find((l) => l.token === token);
      if (!inv && !link) fail(404, "invalid_token", "This invite link isn't valid");
      if (inv && inviteView(inv).status !== "pending") fail(410, "invite_unusable", `This invite is ${inviteView(inv).status}. Ask an admin for a new one.`);
      if (link && link.expiresAt < now()) fail(410, "invite_unusable", "This invite link has expired");
      const orgId = inv?.orgId ?? link!.orgId;
      const email = inv?.email ?? body.email?.trim().toLowerCase() ?? "";

      let user = currentUser(cookies);
      if (user && inv && user.email.toLowerCase() !== inv.email) fail(409, "wrong_account", `This invite is for ${inv.email}. Sign out and try again.`);
      if (!user) {
        const existing = db.t.users.find((u) => u.email.toLowerCase() === email);
        if (existing) {
          if (existing.password !== body.password) fail(401, "bad_credentials", "Sign in with your existing password to accept");
          user = existing;
        } else {
          if (!body.name?.trim()) fail(422, "invalid", "Enter your name");
          if ((body.password ?? "").length < 8) fail(422, "weak_password", "Use at least 8 characters");
          if (!/^\S+@\S+\.\S+$/.test(email)) fail(422, "invalid", "Enter a valid email");
          user = db.t.users.put({ id: uuidv7(), name: body.name!.trim(), email, password: body.password!, verified: true, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone });
        }
      }
      const existingM = db.t.memberships.find((m) => m.orgId === orgId && m.userId === user!.id);
      const role = inv?.role ?? link!.roleCap;
      const wsIds = inv?.workspaceIds ?? [];
      if (existingM) db.t.memberships.update(existingM.id, { status: "active", workspaceIds: [...new Set([...existingM.workspaceIds, ...wsIds])] });
      else db.t.memberships.put({ id: uuidv7(), orgId, userId: user.id, role, status: "active", workspaceIds: wsIds });
      if (inv) db.t.invites.update(inv.id, { status: "accepted" });
      const firstWs = wsIds[0] ?? db.t.workspaces.find((w) => w.orgId === orgId && w.allOrgMembers && !w.archived)?.id;
      if (firstWs) db.setMeta(`lastWs:${user.id}`, firstWs);
      return HttpResponse.json(meResponse(user), { headers: { "Set-Cookie": newSessionCookie(user.id) } });
    }),
  ),

  // ---- workspaces ----
  http.get(
    "/v1/orgs/:org/workspaces",
    route(({ cookies, params }) => {
      const ctx = orgCtx(cookies, params.org as string);
      return HttpResponse.json(accessibleWorkspaces(ctx, roleAtLeast(ctx.role, "admin")));
    }),
  ),
  http.post(
    "/v1/orgs/:org/workspaces",
    route(async ({ cookies, params, request }) => {
      const ctx = orgCtx(cookies, params.org as string, "admin");
      const body = (await request.json()) as { name: string; description?: string; allOrgMembers: boolean; memberIds?: string[] };
      if (!body.name?.trim()) fail(422, "invalid", "Name the workspace");
      let slug = slugify(body.name) || "workspace";
      let n = 2;
      while (db.t.workspaces.find((w) => w.orgId === ctx.org.id && w.slug === slug)) slug = `${slugify(body.name)}-${n++}`;
      const ws: Workspace = db.t.workspaces.put({ id: uuidv7(), orgId: ctx.org.id, name: body.name.trim(), slug, description: body.description, archived: false, allOrgMembers: body.allOrgMembers });
      const memberIds = new Set([...(body.memberIds ?? []), ctx.user.id]);
      db.t.memberships.filter((m) => m.orgId === ctx.org.id && memberIds.has(m.userId)).forEach((m) => db.t.memberships.update(m.id, { workspaceIds: [...m.workspaceIds, ws.id] }));
      return HttpResponse.json(ws, { status: 201 });
    }),
  ),
  http.patch(
    "/v1/orgs/:org/workspaces/:ws",
    route(async ({ cookies, params, request }) => {
      const ctx = orgCtx(cookies, params.org as string, "admin");
      const ws = db.t.workspaces.get(params.ws as string);
      if (!ws || ws.orgId !== ctx.org.id) fail(404, "not_found", "Workspace not found");
      const body = (await request.json()) as Partial<Pick<Workspace, "name" | "description" | "archived" | "allOrgMembers">> & { memberIds?: string[] };
      const { memberIds, ...patch } = body;
      if (memberIds) {
        const set = new Set(memberIds);
        db.t.memberships
          .filter((m) => m.orgId === ctx.org.id)
          .forEach((m) => {
            const has = m.workspaceIds.includes(ws!.id);
            if (set.has(m.userId) && !has) db.t.memberships.update(m.id, { workspaceIds: [...m.workspaceIds, ws!.id] });
            if (!set.has(m.userId) && has) db.t.memberships.update(m.id, { workspaceIds: m.workspaceIds.filter((x) => x !== ws!.id) });
          });
      }
      return HttpResponse.json(db.t.workspaces.update(ws!.id, patch));
    }),
  ),

  // ---- plan & usage (the mock has no limits: every org behaves like Team) ----
  http.get(
    "/v1/orgs/:org/plan",
    route(({ cookies, params }) => {
      const ctx = orgCtx(cookies, params.org as string, "admin");
      const members = db.t.memberships.filter((m) => m.orgId === ctx.org.id && m.status === "active").length;
      const storageBytes = db.t.assets.filter((a) => a.orgId === ctx.org.id).reduce((n, a) => n + a.bytes, 0);
      return HttpResponse.json({
        plan: "team",
        name: "Team",
        limits: { members: null, workspaces: null, privateWorkspaces: true, storageBytes: 10 * 1024 ** 3 * Math.max(1, members), importsPerMonth: null },
        usage: {
          members,
          pendingInvites: db.t.invites.filter((i) => i.orgId === ctx.org.id && i.status === "pending" && i.expiresAt > now()).length,
          workspaces: db.t.workspaces.filter((w) => w.orgId === ctx.org.id && !w.archived).length,
          storageBytes,
          importsThisMonth: db.t.importJobs.filter((j) => j.orgId === ctx.org.id && j.status !== "failed").length,
        },
      });
    }),
  ),

  // ---- tags (Postgres-owned) ----
  http.get(
    "/v1/orgs/:org/tags",
    route(({ cookies, params }) => {
      const ctx = orgCtx(cookies, params.org as string);
      const strip = <T extends { orgId: string }>({ orgId: _o, ...rest }: T) => (void _o, rest);
      return HttpResponse.json({
        tags: db.t.tags.filter((t) => t.orgId === ctx.org.id).map(strip).sort((a, b) => a.name.localeCompare(b.name)),
        groups: db.t.tagGroups.filter((g) => g.orgId === ctx.org.id).map(strip),
      });
    }),
  ),
  http.post(
    "/v1/orgs/:org/tags",
    route(async ({ cookies, params, request }) => {
      const ctx = orgCtx(cookies, params.org as string, "member");
      const { name, groupId } = (await request.json()) as { name: string; groupId?: string };
      const clean = name?.trim().toLowerCase().replace(/\s+/g, "-");
      if (!clean) fail(422, "invalid", "Tag name can't be empty");
      const existing = db.t.tags.find((t) => t.orgId === ctx.org.id && t.name.toLowerCase() === clean);
      if (existing) return HttpResponse.json(existing);
      const count = db.t.tags.filter((t) => t.orgId === ctx.org.id).length;
      const tag: Tag = db.t.tags.put({ id: uuidv7(), orgId: ctx.org.id, name: clean, color: TAG_COLORS[count % TAG_COLORS.length], groupId });
      return HttpResponse.json(tag, { status: 201 });
    }),
  ),
];
