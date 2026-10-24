import { http, HttpResponse } from "msw";
import type { Asset, Block, DraftSummary, Post, PostDetail, PostPatch, PostRevision } from "../../api/contract";
import { todayISO } from "../../lib/dates";
import { uuidv7 } from "../../lib/ids";
import { blockImageIds, hasContent as blocksHaveContent } from "../../lib/blocks";
import { createAsset } from "../assets";
import { db, type PostRow } from "../db";
import {
  assetView,
  canEditPost,
  emit,
  fail,
  imageView,
  now,
  orgCtx,
  reindex,
  roleAtLeast,
  route,
  visiblePost,
  workspaceCtx,
  type OrgCtx,
} from "../server";

const imagesOf = (p: Post) => blockImageIds(p.blocks).flatMap((id) => [imageView(id)].filter((x) => !!x));

const detail = (p: PostRow): PostDetail => {
  const { indexedAt: _i, ...post } = p;
  void _i;
  return { post, images: imagesOf(p) as PostDetail["images"] };
};

function postFor(ctx: OrgCtx, id: string, needEdit = true) {
  const p = visiblePost(ctx, id);
  if (needEdit && !canEditPost(ctx, p)) fail(403, "forbidden", "You can't edit this post");
  return p;
}

function checkVersion(p: Post, version: number | undefined) {
  if (version !== undefined && version !== p.version)
    fail(409, "version_conflict", "This post changed in another tab or by someone else. Review and retry.", { current: p });
}

const imageCount = (blocks: Block[]) => blockImageIds(blocks, "content").length;

function snapshotRevision(p: PostRow, editedBy: string) {
  const rev: PostRevision = { revision: p.revision, editedBy, editedAt: now(), title: p.title, blocks: p.blocks };
  db.t.revisions.put({ id: `${p.id}:${p.revision}`, postId: p.id, ...rev });
}

function changed(id: string, post: PostRow) {
  reindex(id);
  emit(post.workspaceId, { type: "post", postId: id });
}

const pendingUploads = new Map<string, { orgId: string; filename: string; mime: string; bytes: number; blob?: Blob; sourceKind: Asset["metadata"]["sourceKind"] }>();
const MAX_UPLOAD = 25 * 1024 * 1024;

export const postHandlers = [
  // ---- drafts & posts ----
  http.post(
    "/v1/orgs/:org/workspaces/:ws/posts",
    route(async ({ cookies, params, request }) => {
      const ctx = workspaceCtx(cookies, params.org as string, params.ws as string, "member");
      if (ctx.ws.archived) fail(409, "archived", "This workspace is archived");
      const body = ((await request.json().catch(() => ({}))) ?? {}) as Partial<Post>;
      const t = now();
      const p = db.t.posts.put({
        id: uuidv7(),
        orgId: ctx.org.id,
        workspaceId: ctx.ws.id,
        title: body.title ?? "",
        workDate: body.workDate ?? todayISO(),
        workDateSource: "user",
        status: "draft",
        visibility: "visible",
        authorId: ctx.user.id,
        coAuthorIds: [],
        tagIds: body.tagIds ?? [],
        blocks: body.blocks ?? [{ id: uuidv7(), type: "text", doc: { type: "doc", content: [{ type: "paragraph" }] } }],
        revision: 0,
        version: 1,
        createdAt: t,
        updatedAt: t,
        counts: { comments: 0, reactions: 0, images: 0 },
        reactions: {},
        collectionIds: [],
      });
      return HttpResponse.json(detail(p), { status: 201 });
    }),
  ),
  http.get(
    "/v1/orgs/:org/posts/:id",
    route(({ cookies, params }) => {
      const ctx = orgCtx(cookies, params.org as string);
      return HttpResponse.json(detail(visiblePost(ctx, params.id as string)));
    }),
  ),
  http.patch(
    "/v1/orgs/:org/posts/:id",
    route(async ({ cookies, params, request }) => {
      const ctx = orgCtx(cookies, params.org as string, "member");
      const p = postFor(ctx, params.id as string);
      const patch = (await request.json()) as PostPatch;
      checkVersion(p, patch.version);
      if (p.deletedAt) fail(409, "deleted", "This post was deleted");
      const { version: _v, ...fields } = patch;
      void _v;
      const blocks = fields.blocks ?? p.blocks;
      let revision = p.revision;
      if (p.status === "published") {
        // Rapid edits by the same person coalesce into one revision (§A5).
        const last = db.t.revisions.get(`${p.id}:${p.revision}`);
        const recent = last && last.editedBy === ctx.user.id && Date.now() - new Date(last.editedAt).getTime() < 5 * 60_000 && p.revision > 1;
        if (!recent) revision = p.revision + 1;
      }
      const next = db.t.posts.put({
        ...p,
        ...fields,
        blocks,
        version: p.version + 1,
        revision,
        updatedAt: now(),
        counts: { ...p.counts, images: imageCount(blocks) },
      });
      if (p.status === "published") snapshotRevision(next, ctx.user.id);
      if (p.status === "published") changed(p.id, next);
      return HttpResponse.json(detail(next));
    }),
  ),
  http.post(
    "/v1/orgs/:org/posts/:id/publish",
    route(async ({ cookies, params, request }) => {
      const ctx = orgCtx(cookies, params.org as string, "member");
      const p = postFor(ctx, params.id as string);
      const { version } = (await request.json().catch(() => ({}))) as { version?: number };
      checkVersion(p, version);
      if (p.status === "published") return HttpResponse.json(detail(p)); // idempotent
      const problems: string[] = [];
      if (!p.title.trim()) problems.push("Add a title");
      const hasContent = blocksHaveContent(p.blocks);
      if (!hasContent) problems.push("Add some text or an image");
      const pending = imagesOf(p).some((i) => i!.asset.processing === "failed");
      if (pending) problems.push("Remove or retry failed uploads");
      if (problems.length) fail(422, "not_publishable", problems.join(". "), { problems });
      const t = now();
      const next = db.t.posts.put({ ...p, status: "published", publishedAt: t, updatedAt: t, revision: 1, version: p.version + 1 });
      snapshotRevision(next, ctx.user.id);
      changed(p.id, next);
      return HttpResponse.json(detail(next));
    }),
  ),
  http.post(
    "/v1/orgs/:org/posts/:id/unpublish",
    route(({ cookies, params }) => {
      const ctx = orgCtx(cookies, params.org as string, "member");
      const p = postFor(ctx, params.id as string);
      if (p.counts.comments > 0 || p.counts.reactions > 0)
        fail(409, "has_activity", "This post has comments or reactions, so it can't go back to draft. Hide it instead.");
      const next = db.t.posts.put({ ...p, status: "draft", publishedAt: undefined, version: p.version + 1, updatedAt: now() });
      changed(p.id, next);
      return HttpResponse.json(detail(next));
    }),
  ),
  http.post(
    "/v1/orgs/:org/posts/:id/hide",
    route(async ({ cookies, params, request }) => {
      const ctx = orgCtx(cookies, params.org as string, "member");
      const p = postFor(ctx, params.id as string);
      if (p.status !== "published") fail(409, "not_published", "Only published posts can be hidden");
      const { reason } = (await request.json().catch(() => ({}))) as { reason?: string };
      const next = db.t.posts.put({ ...p, visibility: "hidden", hiddenReason: reason?.trim() || undefined, hiddenBy: ctx.user.id, hiddenAt: now(), version: p.version + 1 });
      changed(p.id, next);
      return HttpResponse.json(detail(next));
    }),
  ),
  http.post(
    "/v1/orgs/:org/posts/:id/show",
    route(({ cookies, params }) => {
      const ctx = orgCtx(cookies, params.org as string, "member");
      const p = postFor(ctx, params.id as string);
      const next = db.t.posts.put({ ...p, visibility: "visible", hiddenReason: undefined, hiddenBy: undefined, hiddenAt: undefined, version: p.version + 1 });
      changed(p.id, next);
      return HttpResponse.json(detail(next));
    }),
  ),
  http.delete(
    "/v1/orgs/:org/posts/:id",
    route(({ cookies, params }) => {
      const ctx = orgCtx(cookies, params.org as string, "member");
      const p = postFor(ctx, params.id as string);
      if (p.status === "draft") {
        // Discarding a draft is a soft delete too, so "Undo" can bring it back.
        db.t.posts.put({ ...p, deletedAt: now(), version: p.version + 1 });
      } else {
        const next = db.t.posts.put({ ...p, deletedAt: now(), version: p.version + 1 });
        changed(p.id, next);
      }
      return new HttpResponse(null, { status: 204 });
    }),
  ),
  http.post(
    "/v1/orgs/:org/posts/:id/restore",
    route(({ cookies, params }) => {
      const ctx = orgCtx(cookies, params.org as string, "member");
      const p = db.t.posts.get(params.id as string);
      if (!p || p.orgId !== ctx.org.id || !p.deletedAt) fail(404, "not_found", "Nothing to restore");
      // Authors can undo their own delete right away; otherwise restoring is an admin action.
      const recentOwn = p!.authorId === ctx.user.id && Date.now() - new Date(p!.deletedAt!).getTime() < 60_000;
      if (!recentOwn && !roleAtLeast(ctx.role, "admin")) fail(403, "forbidden", "Only admins can restore posts");
      const next = db.t.posts.put({ ...p!, deletedAt: undefined, version: p!.version + 1 });
      changed(p!.id, next);
      return HttpResponse.json(detail(next));
    }),
  ),
  http.get(
    "/v1/orgs/:org/posts/:id/revisions",
    route(({ cookies, params }) => {
      const ctx = orgCtx(cookies, params.org as string);
      const p = visiblePost(ctx, params.id as string);
      const list = db.t.revisions.filter((r) => r.postId === p.id).sort((a, b) => b.revision - a.revision).map(({ id: _id, postId: _p, ...r }) => (void _id, void _p, r));
      return HttpResponse.json(list);
    }),
  ),
  http.get(
    "/v1/orgs/:org/workspaces/:ws/drafts",
    route(({ cookies, params }) => {
      const ctx = workspaceCtx(cookies, params.org as string, params.ws as string);
      const list: DraftSummary[] = db.t.posts
        .filter((p) => p.workspaceId === ctx.ws.id && p.status === "draft" && p.authorId === ctx.user.id && !p.deletedAt)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .map((p) => ({ id: p.id, title: p.title, updatedAt: p.updatedAt, imageCount: imageCount(p.blocks), workspaceId: p.workspaceId }));
      return HttpResponse.json(list);
    }),
  ),
  http.get(
    "/v1/orgs/:org/workspaces/:ws/trash",
    route(({ cookies, params }) => {
      const ctx = workspaceCtx(cookies, params.org as string, params.ws as string, "admin");
      const deleted = db.t.posts.filter((p) => p.workspaceId === ctx.ws.id && !!p.deletedAt && p.status === "published");
      const hidden = db.t.posts.filter((p) => p.workspaceId === ctx.ws.id && !p.deletedAt && p.visibility === "hidden");
      const strip = (p: PostRow) => detail(p).post;
      return HttpResponse.json({ deleted: deleted.map(strip), hidden: hidden.map(strip) });
    }),
  ),

  // ---- uploads (presign → PUT → complete, §B7) ----
  http.post(
    "/v1/orgs/:org/uploads",
    route(async ({ cookies, params, request }) => {
      const ctx = orgCtx(cookies, params.org as string, "member");
      const { filename, mime, bytes, sourceKind } = (await request.json()) as { filename: string; mime: string; bytes: number; sourceKind?: Asset["metadata"]["sourceKind"] };
      if (!/^image\/(png|jpeg|gif|webp|svg\+xml)$/.test(mime)) fail(415, "unsupported_type", "Only PNG, JPEG, GIF, WebP, and SVG images are supported");
      if (bytes > MAX_UPLOAD) fail(413, "too_large", "Images must be under 25 MB");
      const id = uuidv7();
      pendingUploads.set(id, { orgId: ctx.org.id, filename, mime, bytes, sourceKind: sourceKind ?? "upload" });
      return HttpResponse.json({ uploadId: id, uploadUrl: `/v1/mock-storage/${id}` }, { status: 201 });
    }),
  ),
  http.put(
    "/v1/mock-storage/:id",
    route(async ({ params, request }) => {
      const up = pendingUploads.get(params.id as string) ?? fail(404, "not_found", "Upload not found or expired");
      up.blob = await request.blob();
      return new HttpResponse(null, { status: 200 });
    }),
  ),
  http.post(
    "/v1/orgs/:org/uploads/:id/complete",
    route(async ({ cookies, params }) => {
      const ctx = orgCtx(cookies, params.org as string, "member");
      const up = pendingUploads.get(params.id as string);
      if (!up || up.orgId !== ctx.org.id || !up.blob) return fail(409, "incomplete", "Upload didn't finish. Retry.");
      pendingUploads.delete(params.id as string);
      const { asset, created } = await createAsset(ctx.org.id, up.blob, up.filename, up.sourceKind);
      return HttpResponse.json(assetView(asset), { status: created ? 201 : 200 });
    }),
  ),

  // ---- image instances ----
  http.post(
    "/v1/orgs/:org/image-instances",
    route(async ({ cookies, params, request }) => {
      const ctx = orgCtx(cookies, params.org as string, "member");
      const { assetId, postId, commentId } = (await request.json()) as { assetId: string; postId?: string; commentId?: string };
      const asset = db.t.assets.get(assetId);
      if (!asset || asset.orgId !== ctx.org.id) fail(404, "not_found", "Asset not found");
      if (postId) postFor(ctx, postId);
      const inst = db.t.images.put({ id: uuidv7(), assetId, postId, commentId, tags: [], customFields: {} });
      return HttpResponse.json(imageView(inst.id), { status: 201 });
    }),
  ),
  http.get(
    "/v1/orgs/:org/image-instances/:id",
    route(({ cookies, params }) => {
      const ctx = orgCtx(cookies, params.org as string);
      const v = imageView(params.id as string);
      if (!v) fail(404, "not_found", "Image not found");
      if (v!.postId) visiblePost(ctx, v!.postId);
      return HttpResponse.json(v);
    }),
  ),
  http.patch(
    "/v1/orgs/:org/image-instances/:id",
    route(async ({ cookies, params, request }) => {
      const ctx = orgCtx(cookies, params.org as string, "member");
      const inst = db.t.images.get(params.id as string) ?? fail(404, "not_found", "Image not found");
      if (inst.postId) postFor(ctx, inst.postId);
      const body = (await request.json()) as Partial<Pick<typeof inst, "caption" | "altText" | "figureLabel" | "tags" | "customFields" | "assetId">>;
      const keys = (["caption", "altText", "figureLabel", "tags", "customFields", "assetId"] as const).filter((k) => k in body);
      db.t.images.update(inst.id, Object.fromEntries(keys.map((k) => [k, body[k]])));
      if (inst.postId) reindex(inst.postId);
      return HttpResponse.json(imageView(inst.id));
    }),
  ),
  http.put(
    "/v1/orgs/:org/image-instances/:id/annotation",
    route(async ({ cookies, params, request }) => {
      const ctx = orgCtx(cookies, params.org as string, "member");
      const inst = db.t.images.get(params.id as string) ?? fail(404, "not_found", "Image not found");
      if (inst.postId) postFor(ctx, inst.postId);
      const { shapes, version } = (await request.json()) as { shapes: NonNullable<typeof inst.annotation>["shapes"]; version: number };
      const cur = inst.annotation?.version ?? 0;
      if (version !== cur) fail(409, "version_conflict", "Someone else changed these annotations. Reload to see their version.");
      db.t.images.update(inst.id, { annotation: { shapes, version: cur + 1 } });
      if (inst.postId) reindex(inst.postId);
      return HttpResponse.json(imageView(inst.id));
    }),
  ),
];
