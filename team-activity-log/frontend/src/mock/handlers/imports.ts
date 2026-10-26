import { http, HttpResponse } from "msw";
import type { Block, ImportItem, ImportJob, ImportMode, ImportPost, ImportSummary, SlideDesign, SlideDesignMode } from "../../api/contract";
import { blockImageIds } from "../../lib/blocks";
import { uuidv7 } from "../../lib/ids";
import { doc, heading } from "../../lib/prosemirror";
import { createAsset } from "../assets";
import { db, type ImportJobRow } from "../db";
import { parseDocx, parsePdf } from "../docs";
import { requireRole } from "./collectionAccess";
import { deckLook, parsePptx, type ParsedDeck, type ParsedSlide } from "../pptx";

// What can be imported (mirrors routes/imports.py): slides → decks; PDF and Word → notebooks.
type FileKind = "pptx" | "pdf" | "docx";
const kindOfName = (name: string): FileKind | undefined => (/\.pptx$/i.test(name) ? "pptx" : /\.pdf$/i.test(name) ? "pdf" : /\.docx$/i.test(name) ? "docx" : undefined);
const fileKind = (j: { defaults: ImportJob["defaults"] }): FileKind => j.defaults.fileKind ?? "pptx";
const parse = (kind: FileKind, blob: Blob, onProgress?: (f: number) => void) => (kind === "pdf" ? parsePdf(blob, onProgress) : kind === "docx" ? parseDocx(blob, onProgress) : parsePptx(blob, onProgress));
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
  const d = await parse(fileKind(j), j.sourceBlob);
  decks.set(j.id, d);
  return d;
}

async function parseJob(jobId: string) {
  const j = db.t.importJobs.get(jobId);
  if (!j?.sourceBlob) return;
  let last = 0;
  try {
    const deck = await parse(fileKind(j), j.sourceBlob, (f) => {
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

const keepsDesign = (sl: ParsedSlide, mode: SlideDesignMode) => !!sl.design?.elements.length && (mode === "slides" || (mode === "auto" && sl.rich));

/** The slide as a designed-slide block: its pictures become image instances of the post. */
async function designBlock(orgId: string, postId: string, sl: ParsedSlide): Promise<Block> {
  const elements = [];
  for (const e of sl.design!.elements) {
    if (e.kind !== "image") {
      elements.push(e);
      continue;
    }
    const img = sl.designImages[e.image as number];
    const { asset } = await createAsset(orgId, img.blob, img.name, "pptx_import");
    const inst = db.t.images.put({ id: uuidv7(), assetId: asset.id, postId, tags: [], customFields: {}, caption: e.decorative ? undefined : `Slide ${sl.n}` });
    const { image: _i, ...rest } = e;
    void _i;
    elements.push({ ...rest, imageInstanceId: inst.id });
  }
  return { id: uuidv7(), type: "slide", design: { ...sl.design!, elements } as unknown as SlideDesign, ...(sl.notes ? { notes: sl.notes } : {}) };
}

/** Blocks for one post: per slide a designed-slide block when its layout is kept, otherwise a
 *  break (with presenter notes), heading when several slides, then text and images in the slide's
 *  reading order. */
async function blocksFor(orgId: string, postId: string, slides: ParsedSlide[], designMode: SlideDesignMode = "auto", unit = "Slide"): Promise<Block[]> {
  const blocks: Block[] = [];
  for (const [k, sl] of slides.entries()) {
    if (keepsDesign(sl, designMode)) {
      blocks.push(await designBlock(orgId, postId, sl));
      continue;
    }
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
      const known = (img as { text?: string }).text;
      const { asset } = await createAsset(orgId, img.blob, img.name, unit === "Slide" ? "pptx_import" : "document_import", known); // deduped by hash within the org
      const inst = db.t.images.put({ id: uuidv7(), assetId: asset.id, postId, tags: [], customFields: {}, caption: `${unit} ${sl.n}` });
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
      if (!kindOfName(body.filename)) fail(415, "unsupported_type", "Choose a PowerPoint (.pptx), PDF, or Word (.docx) file");
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
        defaults: { ...body.defaults, fileKind: kindOfName(body.filename) },
        items: [],
        createdAt: now(),
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
      const sourceSha256 = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer())), (b) => b.toString(16).padStart(2, "0")).join("");
      db.t.importJobs.update(j!.id, { status: "parsing", progress: 0.05, sourceBlob: blob, sourceBytes: blob.size, sourceSha256 });
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
      // The same file imported before in this workspace (mirrors routes/imports.py _duplicate_of).
      const prior = j!.sourceSha256 && (j!.status === "parsing" || j!.status === "review")
        ? db.t.importJobs.filter((x) => x.workspaceId === j!.workspaceId && x.sourceSha256 === j!.sourceSha256 && x.status === "done" && x.id !== j!.id && !!x.collectionId).sort((a, b) => a.id.localeCompare(b.id))[0]
        : undefined;
      const coll = prior?.collectionId ? db.t.collections.get(prior.collectionId) : undefined;
      if (!prior || !coll) return HttpResponse.json(view(j!));
      const mine = prior.userId === ctx.user.id;
      const published = coll.postIds.some((id) => { const p = db.t.posts.get(id); return p && !p.deletedAt && p.status === "published"; });
      const sharedWithMe = (coll.members ?? []).some((x) => x.userId === ctx.user.id);
      const canOpen = mine || ((coll.visibility !== "people" || sharedWithMe) && published);
      return HttpResponse.json({
        ...view(j!),
        duplicateOf: { jobId: prior.id, by: mine ? "you" : (db.t.users.get(prior.userId)?.name ?? "someone"), at: prior.createdAt ?? now(), collectionId: canOpen ? coll.id : null, private: !mine && coll.visibility === "people" && !sharedWithMe, reviewing: !mine && !published },
      });
    }, { flaky: false }),
  ),
  http.get(
    "/v1/orgs/:org/workspaces/:ws/imports",
    route(({ cookies, params }) => {
      const ctx = workspaceCtx(cookies, params.org as string, params.ws as string, "member");
      const list: ImportSummary[] = db.t.importJobs
        .filter((j) => j.workspaceId === ctx.ws.id && j.userId === ctx.user.id && j.status !== "failed")
        .map((j) => ({ ...j, createdAt: j.createdAt ?? new Date(parseInt(j.id.replace(/-/g, "").slice(0, 12), 16)).toISOString() }))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, 30)
        .map((j) => {
          const posts = db.t.posts.filter((p) => p.source?.importJobId === j.id && !p.deletedAt);
          return { id: j.id, sourceFilename: j.sourceFilename, status: j.status, slideCount: j.slideCount, createdAt: j.createdAt, collectionId: j.collectionId, fileKind: fileKind(j), drafts: posts.filter((p) => p.status === "draft").length, published: posts.filter((p) => p.status === "published").length };
        });
      return HttpResponse.json(list);
    }),
  ),
  http.get(
    "/v1/orgs/:org/imports/:id/posts",
    route(({ cookies, params }) => {
      const ctx = orgCtx(cookies, params.org as string);
      const j = db.t.importJobs.get(params.id as string);
      if (!j || j.orgId !== ctx.org.id || j.userId !== ctx.user.id) fail(404, "not_found", "Import not found");
      const list: ImportPost[] = db.t.posts
        .filter((p) => p.source?.importJobId === j!.id && !p.deletedAt)
        .map((p) => ({
          id: p.id,
          title: p.title,
          status: (p.status === "published" ? "published" : "draft") as ImportPost["status"],
          updatedAt: p.updatedAt,
          imageCount: p.counts.images,
          workspaceId: p.workspaceId,
          source: { importJobId: p.source!.importJobId, fileName: p.source!.fileName, slide: p.source!.slide, slideCount: p.source!.slideCount },
        }))
        .sort((a, b) => (a.source.slide ?? 0) - (b.source.slide ?? 0));
      return HttpResponse.json(list);
    }),
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
    route(async ({ cookies, params, request }) => {
      const visibility = ((await request.json().catch(() => ({}))) as { visibility?: string }).visibility === "people" ? "people" : "workspace";
      const ctx = orgCtx(cookies, params.org as string, "member");
      const j = db.t.importJobs.get(params.id as string);
      if (!j || j.orgId !== ctx.org.id) fail(404, "not_found", "Import not found");
      if (j!.status === "done") return HttpResponse.json(view(j!)); // idempotent
      if (j!.status !== "review") fail(409, "not_in_review", "Nothing to commit yet");
      const deck = await deckFor(j!);
      const look = deckLook(deck.slides);
      const presentation = Object.keys(look).length ? { theme: { ...look, name: "From the deck" }, deck: { ...look, name: "From the deck" } } : undefined;
      const bySlide = new Map(deck.slides.map((x) => [x.n, x]));
      const fileSha = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", await j!.sourceBlob!.arrayBuffer())), (b) => b.toString(16).padStart(2, "0")).join("");
      const kind = fileKind(j!);
      let name = j!.defaults.collectionName || j!.sourceFilename;
      if (kind !== "pptx") {
        // Documents become notebooks, whose names are unique in a workspace.
        const taken = new Set(db.t.collections.filter((c) => c.workspaceId === j!.workspaceId && c.kind === "notebook").map((c) => c.name.toLowerCase()));
        for (let k = 2; taken.has(name.toLowerCase()); k++) name = `${j!.defaults.collectionName || j!.sourceFilename} (${k})`;
      }
      // Owner request: add to an existing deck or notebook (one you can edit, of the right kind).
      const target = j!.defaults.intoId ? db.t.collections.get(j!.defaults.intoId) : undefined;
      if (j!.defaults.intoId) {
        if (!target || target.workspaceId !== j!.workspaceId || !(kind === "pptx" ? ["deck_import", "deck"] : ["notebook"]).includes(target.kind)) fail(422, "invalid", "That deck or notebook can't take this import");
        requireRole(ctx, target!, "editor");
      }
      const coll = target ?? db.t.collections.put({ id: uuidv7(), workspaceId: j!.workspaceId, name, kind: kind === "pptx" ? "deck_import" : "notebook", postIds: [], createdBy: ctx.user.id, updatedAt: now(), visibility });
      const before = target ? [...target.postIds] : [];
      const postIds: string[] = [];
      const items: ImportItem[] = [];
      for (const item of j!.items) {
        if (!item.included) {
          items.push(item);
          continue;
        }
        const postId = uuidv7();
        const slides = item.slideNumbers.map((n) => bySlide.get(n)).filter((x): x is ParsedSlide => !!x);
        const blocks = await blocksFor(ctx.org.id, postId, slides, j!.defaults.slideDesign ?? "auto", kind === "pptx" ? "Slide" : kind === "pdf" ? "Page" : "Part");
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
          counts: { comments: 0, reactions: 0, images: blockImageIds(blocks, "content").length },
          presentation,
          reactions: {},
          collectionIds: [coll.id],
          source: { kind: "import", importJobId: j!.id, fileName: j!.sourceFilename, fileSha256: fileSha, slide: item.slideNumbers[0], slideCount: j!.slideCount },
        });
        postIds.push(postId);
        items.push({ ...item, postId });
      }
      db.t.collections.update(coll.id, { postIds: [...before, ...postIds], updatedAt: now() });
      const report = { created: postIds.length, skipped: j!.items.filter((i) => !i.included).length, warnings: j!.items.reduce((n, i) => n + i.warnings.length, 0) };
      // The original deck leaves temp storage at commit (§W5.4).
      decks.delete(j!.id);
      return HttpResponse.json(view(db.t.importJobs.update(j!.id, { status: "done", items, collectionId: coll.id, report, sourceBlob: undefined, originalBlob: j!.sourceBlob, defaults: { ...j!.defaults, originalKept: true } })!));
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
      if (j!.collectionId) {
        // The deck/notebook goes only if this import was all it held (others may have extended it).
        const mine = new Set(j!.items.map((i) => i.postId).filter(Boolean));
        const c = db.t.collections.get(j!.collectionId);
        const others = db.t.importJobs.filter((x) => x.collectionId === j!.collectionId && x.id !== j!.id && x.status === "done").length > 0;
        if (c && !others && c.postIds.every((id) => mine.has(id))) db.t.collections.delete(c.id);
      }
      db.t.importJobs.update(j!.id, { status: "failed", error: "Import deleted" });
      return new HttpResponse(null, { status: 204 });
    }),
  ),
  http.get(
    "/v1/orgs/:org/imports/:id/original",
    route(({ cookies, params }) => {
      const ctx = orgCtx(cookies, params.org as string);
      const j = db.t.importJobs.get(params.id as string);
      if (!j || j.orgId !== ctx.org.id || !j.originalBlob) fail(404, "not_found", "The original file isn't available");
      return new HttpResponse(j!.originalBlob, { headers: { "Content-Type": j!.originalBlob!.type || "application/octet-stream", "Content-Disposition": `attachment; filename="${j!.sourceFilename.replace(/"/g, "")}"` } });
    }),
  ),
];
