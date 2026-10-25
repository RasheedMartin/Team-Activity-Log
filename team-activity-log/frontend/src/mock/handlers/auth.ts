import { http, HttpResponse } from "msw";
import type { DevEmail, MeResponse, Session, UserPreferences } from "../../api/contract";
import { uuidv7 } from "../../lib/ids";
import { db, type UserRow } from "../db";
import {
  accessibleWorkspaces,
  clearSessionCookie,
  fail,
  newSessionCookie,
  now,
  publicUser,
  requireUser,
  route,
  SESSION_COOKIE,
} from "../server";

const DEFAULT_PREFS: Omit<UserPreferences, "timezone"> = {
  theme: "system",
  density: "compact",
  histogramDateField: "workDate",
  shortcuts: true,
  digest: "off",
  reducedMotion: false,
};

export function meResponse(u: UserRow): MeResponse {
  const prefs = db.t.prefs.get(u.id) ?? { id: u.id, ...DEFAULT_PREFS, timezone: u.timezone ?? "UTC" };
  const { id: _id, ...preferences } = prefs;
  void _id;
  const orgs = db.t.memberships
    .filter((m) => m.userId === u.id && m.status === "active")
    .flatMap((m) => {
      const org = db.t.orgs.get(m.orgId);
      if (!org) return [];
      return [{ org, role: m.role, workspaces: accessibleWorkspaces({ user: u, org, membership: m, role: m.role }, true) }];
    });
  return { user: publicUser(u), preferences, orgs, lastWorkspaceId: db.meta<string>(`lastWs:${u.id}`) };
}

export function sendEmail(to: string, subject: string, body: string, link?: string) {
  const e: DevEmail = { id: uuidv7(), to, subject, body, link, sentAt: now() };
  db.t.emails.put(e);
}

const withSession = (u: UserRow, status = 200) =>
  HttpResponse.json(meResponse(u), { status, headers: { "Set-Cookie": newSessionCookie(u.id) } });

const findByEmail = (email: string) => db.t.users.find((u) => u.email.toLowerCase() === email.trim().toLowerCase());

export const authHandlers = [
  http.post(
    "/v1/auth/register",
    route(async ({ request }) => {
      const { name, email, password } = (await request.json()) as { name: string; email: string; password: string };
      if (!name?.trim() || !/^\S+@\S+\.\S+$/.test(email ?? "")) fail(422, "invalid", "Enter your name and a valid email");
      if ((password ?? "").length < 8) fail(422, "weak_password", "Use at least 8 characters");
      if (findByEmail(email)) fail(409, "email_taken", "An account with this email already exists. Sign in instead.");
      const u = db.t.users.put({ id: uuidv7(), name: name.trim(), email: email.trim(), password, verified: false, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone });
      db.t.prefs.put({ id: u.id, ...DEFAULT_PREFS, timezone: u.timezone ?? "UTC" });
      const token = uuidv7();
      db.setMeta(`verify:${token}`, u.id);
      sendEmail(u.email, "Verify your email", `Hi ${u.name}, confirm your address to finish creating your account.`, `/verify/${token}`);
      return withSession(u, 201);
    }),
  ),
  http.post(
    "/v1/auth/verify/:token",
    route(({ params }) => {
      const userId = db.meta<string>(`verify:${params.token}`) ?? fail(404, "invalid_token", "This verification link is invalid or was already used");
      db.t.users.update(userId, { verified: true });
      db.t.meta.delete(`verify:${params.token}`);
      return withSession(db.t.users.get(userId)!);
    }),
  ),
  http.post(
    "/v1/auth/login",
    route(async ({ request }) => {
      const { email, password } = (await request.json()) as { email: string; password: string };
      const u = findByEmail(email ?? "");
      if (!u || u.password !== password) fail(401, "bad_credentials", "Email or password is incorrect");
      if (u!.deactivatedAt) fail(403, "deactivated", "This account has been deactivated");
      return withSession(u!);
    }),
  ),
  http.post(
    "/v1/auth/magic-link",
    route(async ({ request }) => {
      const { email } = (await request.json()) as { email: string };
      const u = findByEmail(email ?? "");
      // Same response whether or not the account exists (no account enumeration).
      if (u) {
        const token = uuidv7();
        db.setMeta(`magic:${token}`, u.id);
        sendEmail(u.email, "Your sign-in link", "Click to sign in. The link works once.", `/magic/${token}`);
      }
      return new HttpResponse(null, { status: 204 });
    }),
  ),
  http.post(
    "/v1/auth/magic/:token",
    route(({ params }) => {
      const userId = db.meta<string>(`magic:${params.token}`) ?? fail(404, "invalid_token", "This sign-in link is invalid or was already used");
      db.t.meta.delete(`magic:${params.token}`);
      return withSession(db.t.users.get(userId)!);
    }),
  ),
  http.post(
    "/v1/auth/forgot",
    route(async ({ request }) => {
      const { email } = (await request.json()) as { email: string };
      const u = findByEmail(email ?? "");
      if (u) {
        const token = uuidv7();
        db.setMeta(`reset:${token}`, u.id);
        sendEmail(u.email, "Reset your password", "Use this link to choose a new password.", `/reset/${token}`);
      }
      return new HttpResponse(null, { status: 204 });
    }),
  ),
  http.post(
    "/v1/auth/reset/:token",
    route(async ({ params, request }) => {
      const { password } = (await request.json()) as { password: string };
      const userId = db.meta<string>(`reset:${params.token}`) ?? fail(404, "invalid_token", "This reset link is invalid or expired");
      if ((password ?? "").length < 8) fail(422, "weak_password", "Use at least 8 characters");
      db.t.users.update(userId, { password });
      db.t.meta.delete(`reset:${params.token}`);
      return withSession(db.t.users.get(userId)!);
    }),
  ),
  http.post(
    "/v1/auth/logout",
    route(({ cookies }) => {
      const sid = cookies[SESSION_COOKIE];
      if (sid) db.t.sessions.update(sid, { revokedAt: now() });
      return new HttpResponse(null, { status: 204, headers: { "Set-Cookie": clearSessionCookie } });
    }, { flaky: false }),
  ),

  // ---- me / user panel ----
  http.get(
    "/v1/me",
    route(({ cookies }) => HttpResponse.json(meResponse(requireUser(cookies))), { flaky: false }),
  ),
  http.patch(
    "/v1/me",
    route(async ({ cookies, request }) => {
      const u = requireUser(cookies);
      const body = (await request.json()) as Partial<Pick<UserRow, "name" | "title" | "bio" | "pronouns" | "timezone" | "avatarUrl">>;
      if (body.name !== undefined && !body.name.trim()) fail(422, "invalid", "Name can't be empty");
      const allowed = (["name", "title", "bio", "pronouns", "timezone"] as const).filter((k) => k in body);
      db.t.users.update(u.id, Object.fromEntries(allowed.map((k) => [k, body[k]])));
      return HttpResponse.json(meResponse(db.t.users.get(u.id)!));
    }),
  ),
  // Profile photo: the real server crops/re-encodes into storage; the mock keeps a data URL.
  http.put(
    "/v1/me/avatar",
    route(async ({ cookies, request }) => {
      const u = requireUser(cookies);
      const blob = await request.blob();
      if (!/^image\/(png|jpeg|gif|webp)$/.test(blob.type)) fail(415, "unsupported_type", "Use a PNG, JPEG, GIF, or WebP image");
      if (blob.size > 8 * 1024 * 1024) fail(413, "too_large", "Profile photos must be under 8 MB");
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let bin = "";
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      db.t.users.update(u.id, { avatarUrl: `data:${blob.type};base64,${btoa(bin)}` });
      return HttpResponse.json(meResponse(db.t.users.get(u.id)!));
    }),
  ),
  http.delete(
    "/v1/me/avatar",
    route(({ cookies }) => {
      const u = requireUser(cookies);
      db.t.users.update(u.id, { avatarUrl: undefined });
      return HttpResponse.json(meResponse(db.t.users.get(u.id)!));
    }),
  ),
  http.put(
    "/v1/me/preferences",
    route(async ({ cookies, request }) => {
      const u = requireUser(cookies);
      const prefs = (await request.json()) as UserPreferences;
      db.t.prefs.put({ ...prefs, id: u.id });
      return HttpResponse.json(meResponse(u));
    }),
  ),
  http.put(
    "/v1/me/password",
    route(async ({ cookies, request }) => {
      const u = requireUser(cookies);
      const { current, next } = (await request.json()) as { current: string; next: string };
      if (u.password !== current) fail(422, "bad_credentials", "Current password is incorrect");
      if ((next ?? "").length < 8) fail(422, "weak_password", "Use at least 8 characters");
      db.t.users.update(u.id, { password: next });
      return new HttpResponse(null, { status: 204 });
    }),
  ),
  http.post(
    "/v1/me/last-workspace",
    route(async ({ cookies, request }) => {
      const u = requireUser(cookies);
      const { workspaceId } = (await request.json()) as { workspaceId: string };
      db.setMeta(`lastWs:${u.id}`, workspaceId);
      return new HttpResponse(null, { status: 204 });
    }, { flaky: false }),
  ),
  http.get(
    "/v1/me/sessions",
    route(({ cookies }) => {
      const u = requireUser(cookies);
      const sid = cookies[SESSION_COOKIE];
      const list: Session[] = db.t.sessions
        .filter((s) => s.userId === u.id && !s.revokedAt)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map((s) => ({ id: s.id, device: s.device, ip: s.ip, createdAt: s.createdAt, current: s.id === sid }));
      return HttpResponse.json(list);
    }),
  ),
  http.delete(
    "/v1/me/sessions",
    route(({ cookies }) => {
      const u = requireUser(cookies);
      const sid = cookies[SESSION_COOKIE];
      db.t.sessions.filter((s) => s.userId === u.id && s.id !== sid && !s.revokedAt).forEach((s) => db.t.sessions.update(s.id, { revokedAt: now() }));
      return new HttpResponse(null, { status: 204 });
    }),
  ),
  http.delete(
    "/v1/me/sessions/:id",
    route(({ cookies, params }) => {
      const u = requireUser(cookies);
      const s = db.t.sessions.get(params.id as string);
      if (!s || s.userId !== u.id) fail(404, "not_found", "Session not found");
      db.t.sessions.update(s!.id, { revokedAt: now() });
      return new HttpResponse(null, { status: 204 });
    }),
  ),
  http.post(
    "/v1/me/export",
    route(({ cookies }) => {
      const u = requireUser(cookies);
      sendEmail(u.email, "Your data export is ready", "Your posts, comments, and images are packaged as JSON + image files.", "/me/data");
      return HttpResponse.json({ status: "queued" }, { status: 202 });
    }),
  ),
  http.delete(
    "/v1/me",
    route(({ cookies }) => {
      const u = requireUser(cookies);
      const owned = db.t.memberships.filter((m) => m.userId === u.id && m.role === "owner" && m.status === "active");
      for (const m of owned) {
        const otherOwners = db.t.memberships.filter((x) => x.orgId === m.orgId && x.role === "owner" && x.userId !== u.id && x.status === "active");
        if (!otherOwners.length) fail(409, "last_owner", `Transfer ownership of ${db.t.orgs.get(m.orgId)?.name} before deleting your account`);
      }
      db.t.users.update(u.id, { deactivatedAt: now() });
      return new HttpResponse(null, { status: 204, headers: { "Set-Cookie": clearSessionCookie } });
    }),
  ),

  // The mock has no OAuth provider; the live server reports what's configured.
  http.get("/v1/auth/providers", route(() => HttpResponse.json({ google: false, pricing: false, signupCode: false }), { flaky: false })),

  // ---- dev only ----
  http.get(
    "/v1/dev/personas",
    route(() => {
      const list = db.t.users
        .filter((u) => !u.deactivatedAt)
        .map((u) => {
          const roles = db.t.memberships.filter((m) => m.userId === u.id).map((m) => `${m.role} @ ${db.t.orgs.get(m.orgId)?.name}`);
          return { user: publicUser(u), roles };
        });
      return HttpResponse.json(list);
    }, { flaky: false }),
  ),
  http.post(
    "/v1/dev/sign-in-as",
    route(async ({ request }) => {
      const { userId } = (await request.json()) as { userId: string };
      const u = db.t.users.get(userId) ?? fail(404, "not_found", "No such persona");
      return withSession(u);
    }, { flaky: false }),
  ),
  http.get(
    "/v1/dev/emails",
    route(() => HttpResponse.json(db.t.emails.all().sort((a, b) => b.sentAt.localeCompare(a.sentAt))), { flaky: false }),
  ),
];
