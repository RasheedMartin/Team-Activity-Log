import { delay, HttpResponse, type DefaultBodyType, type HttpResponseResolver, type PathParams } from "msw";
import type {
  ApiErrorBody,
  Asset,
  ID,
  ImageView,
  Membership,
  OrgRole,
  Organization,
  Post,
  User,
  Workspace,
} from "../api/contract";
import { blockImageIds } from "../lib/blocks";
import { uuidv7 } from "../lib/ids";
import { db, type AssetRow, type MembershipRow, type PostRow, type UserRow } from "./db";
import { readDevSettings } from "./devSettings";
import { SearchEngine } from "./search/engine";

// Shared plumbing for MSW handlers: sessions (httpOnly-cookie semantics), tenancy and role
// checks (what RLS + the service layer do in §B3/B8), and scenario network behavior.

export const SESSION_COOKIE = "tal_session";

export class HttpError extends Error {
  readonly status: number;
  readonly body: ApiErrorBody;
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.body = { code, message, details };
  }
}
export const fail = (status: number, code: string, message: string, details?: unknown): never => {
  throw new HttpError(status, code, message, details);
};

/** Wrap a resolver with scenario latency, random 500s, and error mapping. */
export function route<P extends PathParams = PathParams, B extends DefaultBodyType = DefaultBodyType>(
  fn: HttpResponseResolver<P, B>,
  opts: { flaky?: boolean } = {},
): HttpResponseResolver<P, B> {
  return async (info) => {
    const dev = readDevSettings();
    await delay(dev.slowNetwork ? 800 + Math.random() * 1400 : 30 + Math.random() * 90);
    if (dev.randomErrors && opts.flaky !== false && Math.random() < 0.1) {
      return HttpResponse.json({ code: "internal", message: "Random failure (dev scenario)" }, { status: 500 });
    }
    try {
      const res = await fn(info);
      // Like a real server: commit writes before responding, so a reload never loses them.
      if (info.request.method !== "GET") await db.flush();
      return res;
    } catch (e) {
      if (e instanceof HttpError) return HttpResponse.json(e.body, { status: e.status });
      console.error("[mock] handler error", e);
      return HttpResponse.json({ code: "internal", message: String(e) }, { status: 500 });
    }
  };
}

// ---- auth ----

export function currentUser(cookies: Record<string, string>): UserRow | undefined {
  const sid = cookies[SESSION_COOKIE];
  const s = sid ? db.t.sessions.get(sid) : undefined;
  if (!s || s.revokedAt) return undefined;
  const u = db.t.users.get(s.userId);
  return u && !u.deactivatedAt ? u : undefined;
}
export const requireUser = (cookies: Record<string, string>) =>
  currentUser(cookies) ?? fail(401, "unauthenticated", "Sign in to continue");

export function newSessionCookie(userId: ID) {
  const s = db.t.sessions.put({
    id: uuidv7(),
    userId,
    device: navigator.userAgent.includes("Mac") ? "Chrome on macOS" : "This browser",
    ip: "127.0.0.1",
    createdAt: new Date().toISOString(),
  });
  db.t.users.update(userId, {});
  return `${SESSION_COOKIE}=${s.id}; Path=/; Max-Age=2592000; SameSite=Lax`;
}
export const clearSessionCookie = `${SESSION_COOKIE}=; Path=/; Max-Age=0`;

// ---- tenancy & roles ----

const RANK: Record<OrgRole, number> = { viewer: 0, member: 1, admin: 2, owner: 3 };
export const roleAtLeast = (role: OrgRole, min: OrgRole) => RANK[role] >= RANK[min];

export interface OrgCtx {
  user: UserRow;
  org: Organization;
  membership: MembershipRow;
  role: OrgRole;
}

export function orgCtx(cookies: Record<string, string>, orgId: string, min: OrgRole = "viewer"): OrgCtx {
  const user = requireUser(cookies);
  const org = db.t.orgs.get(orgId) ?? fail(404, "not_found", "Organization not found");
  const membership =
    db.t.memberships.find((m) => m.orgId === org.id && m.userId === user.id && m.status === "active") ??
    fail(404, "not_found", "Organization not found");
  if (!roleAtLeast(membership.role, min)) fail(403, "forbidden", "You don't have permission to do that");
  return { user, org, membership, role: membership.role };
}

/** Workspaces a member can see: all-org workspaces plus explicit memberships. Admins see all. */
export function accessibleWorkspaces(ctx: OrgCtx, includeArchived = false): Workspace[] {
  return db.t.workspaces
    .filter((w) => w.orgId === ctx.org.id && (includeArchived || !w.archived))
    .filter((w) => roleAtLeast(ctx.role, "admin") || w.allOrgMembers || ctx.membership.workspaceIds.includes(w.id));
}

export function workspaceCtx(cookies: Record<string, string>, orgId: string, wsId: string, min: OrgRole = "viewer") {
  const ctx = orgCtx(cookies, orgId, min);
  const ws = accessibleWorkspaces(ctx, true).find((w) => w.id === wsId) ?? fail(404, "not_found", "Workspace not found");
  return { ...ctx, ws };
}

/** Load a post the caller may see (drafts: author only; hidden: author + admins; deleted: admins). */
export function visiblePost(ctx: OrgCtx, postId: string): PostRow {
  const p = db.t.posts.get(postId);
  if (!p || p.orgId !== ctx.org.id) return fail(404, "not_found", "Post not found");
  if (!accessibleWorkspaces(ctx, true).some((w) => w.id === p.workspaceId)) fail(404, "not_found", "Post not found");
  const isAdmin = roleAtLeast(ctx.role, "admin");
  const isAuthor = p.authorId === ctx.user.id || p.coAuthorIds.includes(ctx.user.id);
  if (p.status === "draft" && p.authorId !== ctx.user.id) fail(404, "not_found", "Post not found");
  if (p.visibility === "hidden" && !isAuthor && !isAdmin) fail(404, "not_found", "Post not found");
  if (p.deletedAt && !isAdmin) fail(404, "not_found", "Post not found");
  return p;
}

export function canEditPost(ctx: OrgCtx, p: Post) {
  if (!roleAtLeast(ctx.role, "member")) return false;
  if (p.authorId === ctx.user.id || p.coAuthorIds.includes(ctx.user.id)) return true;
  return p.status === "published" && roleAtLeast(ctx.role, "admin");
}

// ---- views ----

export const publicUser = (u: UserRow): User => ({
  id: u.id,
  name: u.name,
  email: u.email,
  avatarUrl: u.avatarUrl,
  title: u.title,
  bio: u.bio,
  pronouns: u.pronouns,
  timezone: u.timezone,
});

export function membershipView(m: MembershipRow): Membership {
  const u = db.t.users.get(m.userId);
  return {
    orgId: m.orgId,
    user: u ? publicUser(u) : { id: m.userId, name: "Unknown", email: "" },
    role: m.role,
    status: u?.deactivatedAt ? "deactivated" : m.status,
    workspaceIds: m.workspaceIds,
  };
}

// Uploaded blobs get object URLs once per page load (§A3).
const objectUrls = new Map<ID, string>();
export function assetView(a: AssetRow): Asset {
  if (!a.blob) {
    const { blob: _b, orgId: _o, ...rest } = a;
    void _b;
    void _o;
    return rest;
  }
  let url = objectUrls.get(a.id);
  if (!url) {
    url = URL.createObjectURL(a.blob);
    objectUrls.set(a.id, url);
  }
  const { blob: _b, orgId: _o, ...rest } = a;
  void _b;
  void _o;
  return { ...rest, variants: rest.variants.map((v) => ({ ...v, url })) };
}

export function imageView(id: ID): ImageView | undefined {
  const inst = db.t.images.get(id);
  const asset = inst ? db.t.assets.get(inst.assetId) : undefined;
  return inst && asset ? { ...inst, asset: assetView(asset) } : undefined;
}

// ---- search engine over the mock store ----

export const engine = new SearchEngine({
  posts: () => db.t.posts.rows.values(),
  tags: (orgId) => (orgId ? db.t.tags.filter((t) => t.orgId === orgId) : db.t.tags.all()),
  images: (post) =>
    blockImageIds(post.blocks, "content").flatMap((id) => {
      const inst = db.t.images.get(id);
      const asset = inst ? db.t.assets.get(inst.assetId) : undefined;
      return inst && asset ? [{ inst, asset: assetView(asset) }] : [];
    }),
  comments: (postId) => commentsByPost().get(postId) ?? [],
  fileText: (post) =>
    post.blocks.flatMap((b) => {
      if (b.type === "chart") {
        // Like the backend: the chart's name and its sheet's name are searchable with the post.
        const c = db.t.sheetCharts.get(b.chartId);
        const s = c ? db.t.sheets.get(c.sheetId) : undefined;
        return c && s && s.orgId === post.orgId ? [`${c.name}\n${s.name}`] : [];
      }
      const a = b.type === "file" ? db.t.attachments.get(b.attachmentId) : undefined;
      return a && a.orgId === post.orgId ? [`${a.filename}\n${a.text ?? ""}`] : [];
    }),
});

// Comments grouped by post, rebuilt lazily when the comments table changes size or is touched.
let commentIndex: Map<ID, ReturnType<typeof db.t.comments.all>> | null = null;
export function commentsByPost() {
  if (!commentIndex) {
    commentIndex = new Map();
    for (const c of db.t.comments.rows.values()) {
      const arr = commentIndex.get(c.postId);
      if (arr) arr.push(c);
      else commentIndex.set(c.postId, [c]);
    }
  }
  return commentIndex;
}
export function invalidateComments() {
  commentIndex = null;
}

/** Enqueue a post for (re)indexing; with the index-lag scenario it shows up in search ~1.5 s later. */
export function reindex(postId: ID) {
  const p = db.t.posts.get(postId);
  if (p && readDevSettings().indexLag) db.t.posts.update(postId, { indexedAt: Date.now() + 1500 });
  engine.touch(postId);
}

// ---- live events (SSE in production) ----

type Listener = (event: unknown) => void;
const listeners = new Map<ID, Set<Listener>>();
export function subscribe(workspaceId: ID, fn: Listener) {
  let set = listeners.get(workspaceId);
  if (!set) listeners.set(workspaceId, (set = new Set()));
  set.add(fn);
  return () => set!.delete(fn);
}
export function emit(workspaceId: ID, event: unknown) {
  listeners.get(workspaceId)?.forEach((fn) => fn(event));
  db.broadcastEvent(workspaceId, event);
}

// Another tab's writes: refresh the search index and comment grouping like the outbox would.
db.onRemoteEvent((workspaceId, event) => listeners.get(workspaceId)?.forEach((fn) => fn(event)));
db.onRemoteChange((name, ids) => {
  if (name === "posts") ids.forEach((id) => engine.touch(id));
  else if (name === "comments") {
    invalidateComments();
    engine.reset();
  } else if (name === "images" || name === "assets" || name === "tags") engine.reset();
});

export const now = () => new Date().toISOString();
