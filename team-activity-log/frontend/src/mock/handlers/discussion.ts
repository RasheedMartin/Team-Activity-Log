import { http, HttpResponse, sse } from "msw";
import { runAlerts } from "../alerts";
import type { Comment, ID, LiveEvent } from "../../api/contract";
import { uuidv7 } from "../../lib/ids";
import { doc, docText, mentionedIds, paragraph } from "../../lib/prosemirror";
import { db, type CommentRow, type PostRow } from "../db";
import { readDevSettings } from "../devSettings";
import {
  currentUser,
  emit,
  fail,
  invalidateComments,
  now,
  orgCtx,
  reindex,
  roleAtLeast,
  route,
  subscribe,
  visiblePost,
  type OrgCtx,
} from "../server";

const view = (c: CommentRow): Comment => {
  const { workspaceId: _w, ...rest } = c;
  void _w;
  // Tombstones keep their place in the tree but lose their content.
  return c.deletedAt ? { ...rest, doc: null, imageInstanceIds: [], reactions: {} } : rest;
};

function writablePost(ctx: OrgCtx, postId: string) {
  const p = visiblePost(ctx, postId);
  if (p.status !== "published") fail(409, "not_published", "Drafts don't have comments");
  if (p.visibility === "hidden") fail(409, "read_only", "This post is hidden, so its thread is read-only");
  if (p.deletedAt) fail(409, "deleted", "This post was deleted");
  return p;
}

function recount(post: PostRow) {
  const n = db.t.comments.filter((c) => c.postId === post.id && !c.deletedAt).length;
  db.t.posts.update(post.id, { counts: { ...post.counts, comments: n } });
}

function notify(post: PostRow, c: CommentRow, actorId: ID) {
  const targets = new Map<ID, "mention" | "reply">();
  for (const id of mentionedIds(c.doc)) targets.set(id, "mention");
  const parent = c.parentId ? db.t.comments.get(c.parentId) : undefined;
  if (parent && !targets.has(parent.authorId)) targets.set(parent.authorId, "reply");
  else if (!parent && !targets.has(post.authorId)) targets.set(post.authorId, "reply");
  targets.delete(actorId);
  for (const [userId, kind] of targets) {
    db.t.notifications.put({ id: uuidv7(), userId, kind, postId: post.id, commentId: c.id, actorId, workspaceId: post.workspaceId, createdAt: c.createdAt });
  }
  if (targets.size) emit(post.workspaceId, { type: "notification" } satisfies LiveEvent);
}

function addComment(post: PostRow, authorId: ID, body: Partial<Comment>): CommentRow {
  const c = db.t.comments.put({
    id: uuidv7(),
    postId: post.id,
    workspaceId: post.workspaceId,
    parentId: body.parentId,
    authorId,
    doc: body.doc ?? doc(),
    imageInstanceIds: body.imageInstanceIds ?? [],
    anchor: body.anchor,
    isQuestion: !!body.isQuestion,
    resolved: false,
    hidden: false,
    createdAt: now(),
    reactions: {},
    version: 1,
  });
  invalidateComments();
  recount(post);
  reindex(post.id);
  notify(post, c, authorId);
  emit(post.workspaceId, { type: "comment", postId: post.id, commentId: c.id } satisfies LiveEvent);
  return c;
}

export const discussionHandlers = [
  http.get(
    "/v1/orgs/:org/posts/:id/comments",
    route(({ cookies, params }) => {
      const ctx = orgCtx(cookies, params.org as string);
      const p = visiblePost(ctx, params.id as string);
      const isAdmin = roleAtLeast(ctx.role, "admin");
      const list = db.t.comments
        .filter((c) => c.postId === p.id && (!c.hidden || isAdmin || c.authorId === ctx.user.id))
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        .map(view);
      return HttpResponse.json(list);
    }),
  ),
  http.post(
    "/v1/orgs/:org/posts/:id/comments",
    route(async ({ cookies, params, request }) => {
      const ctx = orgCtx(cookies, params.org as string, "member");
      const p = writablePost(ctx, params.id as string);
      const body = (await request.json()) as Partial<Comment>;
      if (body.parentId) {
        const parent = db.t.comments.get(body.parentId);
        if (!parent || parent.postId !== p.id) fail(404, "not_found", "The comment you replied to is gone");
      }
      const c = addComment(p, ctx.user.id, body);
      return HttpResponse.json(view(c), { status: 201 });
    }),
  ),
  http.patch(
    "/v1/orgs/:org/comments/:id",
    route(async ({ cookies, params, request }) => {
      const ctx = orgCtx(cookies, params.org as string, "member");
      const c = db.t.comments.get(params.id as string) ?? fail(404, "not_found", "Comment not found");
      const post = writablePost(ctx, c.postId);
      const body = (await request.json()) as Partial<Comment> & { version?: number };
      const isAdmin = roleAtLeast(ctx.role, "admin");
      if ("hidden" in body) {
        if (!isAdmin) fail(403, "forbidden", "Only admins can hide comments");
        db.t.comments.update(c.id, { hidden: !!body.hidden });
      } else {
        if (c.authorId !== ctx.user.id) fail(403, "forbidden", "You can only edit your own comments");
        if (body.version !== undefined && body.version !== c.version) fail(409, "version_conflict", "This comment changed. Reload and retry.");
        db.t.comments.update(c.id, {
          ...(body.doc !== undefined ? { doc: body.doc, editedAt: now() } : {}),
          ...(body.isQuestion !== undefined ? { isQuestion: body.isQuestion } : {}),
          version: c.version + 1,
        });
      }
      invalidateComments();
      reindex(post.id);
      emit(post.workspaceId, { type: "comment", postId: post.id, commentId: c.id } satisfies LiveEvent);
      return HttpResponse.json(view(db.t.comments.get(c.id)!));
    }),
  ),
  http.delete(
    "/v1/orgs/:org/comments/:id",
    route(({ cookies, params }) => {
      const ctx = orgCtx(cookies, params.org as string, "member");
      const c = db.t.comments.get(params.id as string) ?? fail(404, "not_found", "Comment not found");
      const post = visiblePost(ctx, c.postId);
      if (c.authorId !== ctx.user.id && !roleAtLeast(ctx.role, "admin")) fail(403, "forbidden", "You can only delete your own comments");
      const hasReplies = db.t.comments.find((x) => x.parentId === c.id && !x.deletedAt);
      if (hasReplies) db.t.comments.update(c.id, { deletedAt: now() });
      else db.t.comments.delete(c.id);
      invalidateComments();
      recount(post);
      reindex(post.id);
      emit(post.workspaceId, { type: "comment", postId: post.id, commentId: c.id } satisfies LiveEvent);
      return new HttpResponse(null, { status: 204 });
    }),
  ),
  http.post(
    "/v1/orgs/:org/comments/:id/resolve",
    route(async ({ cookies, params, request }) => {
      const ctx = orgCtx(cookies, params.org as string, "member");
      const c = db.t.comments.get(params.id as string) ?? fail(404, "not_found", "Comment not found");
      const post = writablePost(ctx, c.postId);
      if (!c.isQuestion) fail(409, "not_question", "Only questions can be resolved");
      const { resolved, acceptedAnswerId } = (await request.json()) as { resolved: boolean; acceptedAnswerId?: string };
      db.t.comments.update(c.id, { resolved, acceptedAnswerId: resolved ? acceptedAnswerId : undefined, version: c.version + 1 });
      invalidateComments();
      reindex(post.id);
      emit(post.workspaceId, { type: "comment", postId: post.id, commentId: c.id } satisfies LiveEvent);
      return HttpResponse.json(view(db.t.comments.get(c.id)!));
    }),
  ),
  http.put(
    "/v1/orgs/:org/reactions",
    route(async ({ cookies, params, request }) => {
      // Viewers may react (§A2, open question 4: default yes).
      const ctx = orgCtx(cookies, params.org as string, "viewer");
      const { targetType, targetId, emoji } = (await request.json()) as { targetType: "post" | "comment"; targetId: string; emoji: string };
      if (!emoji || emoji.length > 16) fail(422, "invalid", "Pick an emoji");
      const toggle = (r: Record<string, ID[]>) => {
        const cur = r[emoji] ?? [];
        const next = cur.includes(ctx.user.id) ? cur.filter((x) => x !== ctx.user.id) : [...cur, ctx.user.id];
        const out = { ...r, [emoji]: next };
        if (!next.length) delete out[emoji];
        return out;
      };
      if (targetType === "post") {
        const p = visiblePost(ctx, targetId);
        if (p.status !== "published") fail(409, "not_published", "Drafts can't be reacted to");
        const reactions = toggle(p.reactions ?? {});
        const total = Object.values(reactions).reduce((n, a) => n + a.length, 0);
        db.t.posts.update(p.id, { reactions, counts: { ...p.counts, reactions: total } });
        reindex(p.id);
        emit(p.workspaceId, { type: "reaction", postId: p.id } satisfies LiveEvent);
        return HttpResponse.json({ reactions });
      }
      const c = db.t.comments.get(targetId) ?? fail(404, "not_found", "Comment not found");
      const p = visiblePost(ctx, c.postId);
      const reactions = toggle(c.reactions);
      db.t.comments.update(c.id, { reactions });
      invalidateComments();
      reindex(p.id);
      emit(p.workspaceId, { type: "reaction", postId: p.id } satisfies LiveEvent);
      return HttpResponse.json({ reactions });
    }),
  ),

  // ---- inbox ----
  http.get(
    "/v1/orgs/:org/notifications",
    route(({ cookies, params }) => {
      const ctx = orgCtx(cookies, params.org as string);
      runAlerts(); // the server's background loop, in the mock
      const orgWs = new Set(db.t.workspaces.filter((w) => w.orgId === ctx.org.id).map((w) => w.id));
      const list = db.t.notifications
        .filter((n) => n.userId === ctx.user.id && orgWs.has(n.workspaceId))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, 200)
        .map(({ userId: _u, ...n }) => {
          void _u;
          const c = n.commentId ? db.t.comments.get(n.commentId) : undefined;
          const text = c && !c.deletedAt ? docText(c.doc) : "";
          const viewName = n.savedViewId ? db.t.savedViews.get(n.savedViewId)?.name : undefined;
          return { ...n, postTitle: db.t.posts.get(n.postId)?.title, excerpt: text.length > 140 ? `${text.slice(0, 140)}…` : text, ...(viewName ? { viewName } : {}) };
        });
      return HttpResponse.json(list);
    }, { flaky: false }),
  ),
  http.post(
    "/v1/orgs/:org/notifications/read",
    route(async ({ cookies, params, request }) => {
      const ctx = orgCtx(cookies, params.org as string);
      const { ids } = (await request.json()) as { ids?: string[] };
      const t = now();
      db.t.notifications
        .filter((n) => n.userId === ctx.user.id && !n.readAt && (!ids || ids.includes(n.id)))
        .forEach((n) => db.t.notifications.update(n.id, { readAt: t }));
      return new HttpResponse(null, { status: 204 });
    }),
  ),

  // ---- live events (SSE) ----
  sse("/v1/orgs/:org/workspaces/:ws/events", ({ client, params, cookies }) => {
    if (!currentUser(cookies)) {
      client.close();
      return;
    }
    const wsId = params.ws as string;
    const unsub = subscribe(wsId, (event) => {
      try {
        client.send({ data: JSON.stringify(event) });
      } catch {
        unsub(); // the EventSource closed (navigated away / unmounted)
      }
    });
    startActivity(wsId);
    // MSW keeps the stream open; clean up when the page goes away.
    addEventListener("pagehide", () => unsub(), { once: true });
  }),
];

// ---- simulated teammates (§W3.8 "timers in the mock") ----

const LIVE_LINES = [
  "Just saw this, nice work.",
  "Same behavior on our side yesterday.",
  "Could you share the run number?",
  "That matches the simulation, I think.",
  "Adding this to the agenda for Thursday.",
];
const active = new Set<ID>();
function startActivity(workspaceId: ID) {
  if (active.has(workspaceId)) return;
  active.add(workspaceId);
  const tick = () => {
    setTimeout(tick, 20_000 + Math.random() * 20_000);
    if (!readDevSettings().liveActivity || document.hidden) return;
    const recent = db.t.posts
      .filter((p) => p.workspaceId === workspaceId && p.status === "published" && p.visibility === "visible" && !p.deletedAt)
      .sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""))
      .slice(0, 5);
    const post = recent[Math.floor(Math.random() * recent.length)];
    if (!post) return;
    const ws = db.t.workspaces.get(workspaceId);
    const people = db.t.memberships.filter((m) => m.orgId === ws?.orgId && m.status === "active" && m.role !== "viewer").map((m) => m.userId);
    const me = db.t.sessions.all().filter((s) => !s.revokedAt).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]?.userId;
    const others = people.filter((id) => id !== me);
    const actor = others[Math.floor(Math.random() * others.length)];
    if (!actor) return;
    if (Math.random() < 0.6) {
      const existing = db.t.comments.filter((c) => c.postId === post.id && !c.deletedAt);
      const parent = existing.length && Math.random() < 0.5 ? existing[existing.length - 1] : undefined;
      addComment(post, actor, { doc: doc(paragraph(LIVE_LINES[Math.floor(Math.random() * LIVE_LINES.length)])), parentId: parent?.id });
    } else {
      const reactions = { ...post.reactions };
      reactions["👍"] = [...new Set([...(reactions["👍"] ?? []), actor])];
      db.t.posts.update(post.id, { reactions, counts: { ...post.counts, reactions: Object.values(reactions).flat().length } });
      emit(workspaceId, { type: "reaction", postId: post.id } satisfies LiveEvent);
    }
  };
  setTimeout(tick, 15_000);
}
