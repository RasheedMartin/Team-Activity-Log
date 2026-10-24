import { http, HttpResponse } from "msw";
import type { Block, ImportItem, ImportJob, ImportMode } from "../../api/contract";
import { uuidv7 } from "../../lib/ids";
import { doc, heading } from "../../lib/prosemirror";
import { createAsset } from "../assets";
import { db, type ImportJobRow } from "../db";
import { parsePptx, type ParsedDeck, type ParsedSlide } from "../pptx";
import { emit, fail, now, orgCtx, reindex, route, workspaceCtx } from "../server";

// The import reads the real .pptx in the browser (src/mock/pptx.ts) so decks can be tried for
// real before the backend worker exists; the job lifecycle mirrors §W5.3.

/** Group slides into posts for a mode. */
function groupsFor(mode: ImportMode, deck: ParsedDeck): { title: string; slides: ParsedSlide[]; note?: string }[] {
  const s = deck.slides;
  if (mode === "per_slide") return s.map((x) => ({ title: x.title, slides: [x] }));
  if (mode === "whole_deck") return [{ title: s.find((x) => x.title)?.title ?? "", slides: s }];
  // by_section: PowerPoint Sections if the deck has them, else section-header slides, else per slide.
  const groups: { title: string; slides: ParsedSlide[]; note?: string }[] = [];
  if (deck.hasSections) {
    for (const x of s) {
      const last = groups[groups.length - 1];
      if (last && last.title === (x.section ?? "")) last.slides.push(x);
      else groups.push({ title: x.section ?? "", slides: [x] });
    }
    return groups;
  }
  if (s.some((x) => x.isSectionHeader)) {
    for (const x of s) {
      if (x.isSectionHeader || !groups.length) groups.push({ title: x.title, slides: [x] });
      else groups[groups.length - 1].slides.push(x);
    }
    return groups;
  }
  return s.map((x, i) => ({ title: x.title, slides: [x], note: i === 0 ? "No sections in this deck; each slide is its own post" : undefined }));
}

function itemsFor(mode: ImportMode, deck: ParsedDeck, defaults: ImportJob["defaults"]): ImportItem[] {
  return groupsFor(mode, deck).map((g) => {
    const dated = defaults.guessDates ? g.slides.find((x) => x.date) : undefined;
    return {
      id: uuidv7(),
      slideNumbers: g.slides.map((x) => x.n),
      proposedTitle: g.title,
      proposedDate: dated?.date ?? defaults.baseDate ?? new Date().toISOString().slice(0, 10),
      dateSource: dated ? "guessed" : defaults.baseDate ? "user" : "import_fallback",
      imageCount: g.slides.reduce((n, x) => n + x.images.length, 0),
      warnings: [...(g.note ? [g.note] : []), ...g.slides.flatMap((x) => x.warnings.map((w) => (g.slides.length > 1 ? `Slide ${x.n}: ${w}` : w)))],
      included: true,
    };
  });
}

const view = (j: ImportJobRow): ImportJob => {
  const { userId: _u, orgId: _o, sourceBlob: _b, ...rest } = j;
  void _u;
  void _o;
  void _b;
  return rest;
};

// Parsed decks are kept in memory; after a reload they're re-parsed from the temp blob.
const decks = new Map<string, ParsedDeck>();
async function deckFor(j: ImportJobRow): Promise<ParsedDeck> {
  const cached = decks.get(j.id);
  if (cached) return cached;
  if (!j.sourceBlob) throw new Error("The uploaded file is no longer available. Start the import again.");
  const d = await parsePptx(j.sourceBlob);
  decks.set(j.id, d);
  return d;
}

async function parseJob(jobId: string) {
  const j = db.t.importJobs.get(jobId);
  if (!j?.sourceBlob) return;
  let last = 0;
  try {
    const deck = await parsePptx(j.sourceBlob, (f) => {
      if (f - last < 0.05 && f < 1) return;
      last = f;
      db.t.importJobs.update(jobId, { progress: 0.1 + f * 0.85 });
    });
    decks.set(jobId, deck);
    const cur = db.t.importJobs.get(jobId)!;
    db.t.importJobs.update(jobId, { status: "review", progress: 1, slideCount: deck.slides.length, items: itemsFor(cur.mode, deck, cur.defaults) });
  } catch (e) {
    db.t.importJobs.update(jobId, { status: "failed", error: e instanceof Error ? e.message : String(e) });
  }
  await db.flush();
}

/** Blocks for one post: per slide a break (with presenter notes), heading when several slides,
 *  then text and images in the slide's reading order. */
async function blocksFor(orgId: string, postId: string, slides: ParsedSlide[]): Promise<Block[]> {
  const blocks: Block[] = [];
  for (const [k, sl] of slides.entries()) {
    if (k > 0 || sl.notes) blocks.push({ id: uuidv7(), type: "slide_break", notes: sl.notes || undefined });
    let parts = sl.parts;
    if (slides.length > 1 && sl.title) {
      const [head, ...rest] = parts;
      parts = head?.kind === "text" ? [{ kind: "text", content: [heading(sl.title), ...head.content] }, ...rest] : [{ kind: "text", content: [heading(sl.title)] }, ...parts];
    }
    for (const part of parts) {
      if (part.kind === "text") {
        blocks.push({ id: uuidv7(), type: "text", doc: doc(...part.content) });
        continue;
      }
      const img = sl.images[part.index];
      const { asset } = await createAsset(orgId, img.blob, img.name, "pptx_import"); // deduped by hash within the org
      const inst = db.t.images.put({ id: uuidv7(), assetId: asset.id, postId, tags: [], customFields: {}, caption: `Slide ${sl.n}` });
      blocks.push({ id: uuidv7(), type: "image", imageInstanceId: inst.id });
    }
  }
  return blocks;
}

export const importHandlers = [
  http.post(
    "/v1/orgs/:org/workspaces/:ws/imports",
    route(async ({ cookies, params, request }) => {
      const ctx = workspaceCtx(cookies, params.org as string, params.ws as string, "member");
      const body = (await request.json()) as { filename: string; bytes: number; mode: ImportMode; defaults: ImportJob["defaults"] };
      if (!/\.pptx$/i.test(body.filename)) fail(415, "unsupported_type", "Choose a .pptx file (PowerPoint 2007 or newer)");
      const job = db.t.importJobs.put({
        id: uuidv7(),
        userId: ctx.user.id,
        orgId: ctx.org.id,
        workspaceId: ctx.ws.id,
        status: "uploading",
        progress: 0,
        mode: body.mode,
        sourceFilename: body.filename,
        sourceBytes: body.bytes,
        slideCount: 0,
        defaults: body.defaults,
        items: [],
      });
      return HttpResponse.json(view(job), { status: 201 });
    }),
  ),
  http.put(
    "/v1/orgs/:org/imports/:id/upload",
    route(async ({ cookies, params, request }) => {
      const ctx = orgCtx(cookies, params.org as string, "member");
      const j = db.t.importJobs.get(params.id as string);
      if (!j || j.orgId !== ctx.org.id) fail(404, "not_found", "Import not found");
      // Held in temp storage only until commit; not retained (§W5.4).
      const blob = await request.blob();
      db.t.importJobs.update(j!.id, { status: "parsing", progress: 0.05, sourceBlob: blob, sourceBytes: blob.size });
      void parseJob(j!.id);
      return HttpResponse.json(view(db.t.importJobs.get(j!.id)!));
    }),
  ),
  http.get(
    "/v1/orgs/:org/imports/:id",
    route(({ cookies, params }) => {
      const ctx = orgCtx(cookies, params.org as string);
      const j = db.t.importJobs.get(params.id as string);
      if (!j || j.orgId !== ctx.org.id || j.userId !== ctx.user.id) fail(404, "not_found", "Import not found");
      return HttpResponse.json(view(j!));
    }, { flaky: false }),
  ),
  http.patch(
    "/v1/orgs/:org/imports/:id",
    route(async ({ cookies, params, request }) => {
      const ctx = orgCtx(cookies, params.org as string, "member");
      const j = db.t.importJobs.get(params.id as string);
      if (!j || j.orgId !== ctx.org.id) fail(404, "not_found", "Import not found");
      if (j!.status !== "review") fail(409, "not_in_review", "This import can't be edited now");
      const body = (await request.json()) as { items?: ImportItem[]; mode?: ImportMode };
      const items = body.mode && body.mode !== j!.mode ? itemsFor(body.mode, await deckFor(j!), j!.defaults) : (body.items ?? j!.items);
      return HttpResponse.json(view(db.t.importJobs.update(j!.id, { items, mode: body.mode ?? j!.mode })!));
    }),
  ),
  http.post(
    "/v1/orgs/:org/imports/:id/commit",
    route(async ({ cookies, params }) => {
      const ctx = orgCtx(cookies, params.org as string, "member");
      const j = db.t.importJobs.get(params.id as string);
      if (!j || j.orgId !== ctx.org.id) fail(404, "not_found", "Import not found");
      if (j!.status === "done") return HttpResponse.json(view(j!)); // idempotent
      if (j!.status !== "review") fail(409, "not_in_review", "Nothing to commit yet");
      const deck = await deckFor(j!);
      const bySlide = new Map(deck.slides.map((x) => [x.n, x]));
      const fileSha = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", await j!.sourceBlob!.arrayBuffer())), (b) => b.toString(16).padStart(2, "0")).join("");
      const coll = db.t.collections.put({ id: uuidv7(), workspaceId: j!.workspaceId, name: j!.defaults.collectionName || j!.sourceFilename, kind: "deck_import", postIds: [], createdBy: ctx.user.id, updatedAt: now() });
      const postIds: string[] = [];
      const items: ImportItem[] = [];
      for (const item of j!.items) {
        if (!item.included) {
          items.push(item);
          continue;
        }
        const postId = uuidv7();
        const slides = item.slideNumbers.map((n) => bySlide.get(n)).filter((x): x is ParsedSlide => !!x);
        const blocks = await blocksFor(ctx.org.id, postId, slides);
        const t = now();
        db.t.posts.put({
          id: postId,
          orgId: ctx.org.id,
          workspaceId: j!.workspaceId,
          title: item.proposedTitle || `Slide ${item.slideNumbers[0]}`,
          workDate: item.proposedDate,
          workDateSource: item.dateSource,
          status: "draft",
          visibility: "visible",
          authorId: ctx.user.id,
          coAuthorIds: [],
          tagIds: j!.defaults.tagIds,
          blocks: blocks.length ? blocks : [{ id: uuidv7(), type: "text", doc: doc() }],
          revision: 0,
          version: 1,
          createdAt: t,
          updatedAt: t,
          counts: { comments: 0, reactions: 0, images: blocks.filter((b) => b.type === "image").length },
          reactions: {},
          collectionIds: [coll.id],
          source: { kind: "import", importJobId: j!.id, fileName: j!.sourceFilename, fileSha256: fileSha, slide: item.slideNumbers[0], slideCount: j!.slideCount },
        });
        postIds.push(postId);
        items.push({ ...item, postId });
      }
      db.t.collections.update(coll.id, { postIds });
      const report = { created: postIds.length, skipped: j!.items.filter((i) => !i.included).length, warnings: j!.items.reduce((n, i) => n + i.warnings.length, 0) };
      // The original deck leaves temp storage at commit (§W5.4).
      decks.delete(j!.id);
      return HttpResponse.json(view(db.t.importJobs.update(j!.id, { status: "done", items, collectionId: coll.id, report, sourceBlob: undefined })!));
    }),
  ),
  http.post(
    "/v1/orgs/:org/imports/:id/publish-all",
    route(({ cookies, params }) => {
      const ctx = orgCtx(cookies, params.org as string, "member");
      const j = db.t.importJobs.get(params.id as string);
      if (!j || j.orgId !== ctx.org.id) fail(404, "not_found", "Import not found");
      const t = now();
      j!.items.forEach((i) => {
        const p = i.postId ? db.t.posts.get(i.postId) : undefined;
        if (!p || p.status !== "draft" || p.deletedAt) return;
        db.t.posts.put({ ...p, status: "published", publishedAt: t, updatedAt: t, revision: 1, version: p.version + 1 });
        reindex(p.id);
      });
      emit(j!.workspaceId, { type: "post", postId: j!.id });
      return HttpResponse.json(view(j!));
    }),
  ),
  http.delete(
    "/v1/orgs/:org/imports/:id",
    route(({ cookies, params }) => {
      const ctx = orgCtx(cookies, params.org as string, "member");
      const j = db.t.importJobs.get(params.id as string);
      if (!j || j.orgId !== ctx.org.id) fail(404, "not_found", "Import not found");
      // Delete a whole import: its posts (soft) and the collection.
      j!.items.forEach((i) => {
        const p = i.postId ? db.t.posts.get(i.postId) : undefined;
        if (p) {
          db.t.posts.update(p.id, { deletedAt: now() });
          reindex(p.id);
        }
      });
      if (j!.collectionId) db.t.collections.delete(j!.collectionId);
      db.t.importJobs.update(j!.id, { status: "failed", error: "Import deleted" });
      return new HttpResponse(null, { status: 204 });
    }),
  ),
];
