import { http, HttpResponse } from "msw";
import type { Block, ImportItem, ImportJob, ImportMode } from "../../api/contract";
import { addDays, todayISO } from "../../lib/dates";
import { uuidv7 } from "../../lib/ids";
import { doc, heading, paragraph, bulletList } from "../../lib/prosemirror";
import { db, type ImportJobRow } from "../db";
import { emit, fail, now, orgCtx, reindex, route, workspaceCtx } from "../server";

// Real PPTX parsing is backend work (§B13 B-5). The mock simulates the job lifecycle with
// canned slides so the wizard, review grid, and commit can be built end to end.

interface CannedSlide {
  n: number;
  title: string;
  section: string;
  text: string[];
  images: number;
  date?: string;
  warnings: string[];
}

function cannedSlides(count: number, base: string): CannedSlide[] {
  const sections = ["Cooldown", "Calibration", "Beam test", "Analysis", "Upgrades"];
  return Array.from({ length: count }, (_, i) => {
    const section = sections[Math.floor((i / count) * sections.length)];
    const first = i % Math.ceil(count / sections.length) === 0;
    const guessed = i % 3 !== 2 ? addDays(base, i * 3) : undefined;
    const warnings: string[] = [];
    if (i % 11 === 5) warnings.push("SmartArt rendered as an image");
    if (i % 17 === 8) warnings.push("Animation not preserved");
    if (i % 13 === 3) warnings.push("Image is 48 MP; downscaled for display");
    const untitled = i % 19 === 7;
    if (untitled) warnings.push("No title on this slide");
    return {
      n: i + 1,
      title: untitled ? "" : first ? `${section}: overview` : `${section} — ${["status", "results", "plots", "open issues", "next steps"][i % 5]}`,
      section,
      text: [`${guessed ? `${guessed}: ` : ""}Notes from the ${section.toLowerCase()} work.`, "Gain stable within 1%; see plot.", "Follow up on channel 12 noise."],
      images: i % 4 === 0 ? 0 : 1 + (i % 2),
      date: guessed,
      warnings,
    };
  });
}

function itemsFor(mode: ImportMode, slides: CannedSlide[], defaults: ImportJob["defaults"]): ImportItem[] {
  const fallback = defaults.baseDate ?? todayISO();
  const mk = (group: CannedSlide[], title: string): ImportItem => {
    const dated = defaults.guessDates ? group.find((s) => s.date) : undefined;
    return {
      id: uuidv7(),
      slideNumbers: group.map((s) => s.n),
      proposedTitle: title,
      proposedDate: dated?.date ?? fallback,
      dateSource: dated ? "guessed" : defaults.baseDate ? "user" : "import_fallback",
      imageCount: group.reduce((n, s) => n + s.images, 0),
      warnings: group.flatMap((s) => s.warnings.map((w) => (group.length > 1 ? `Slide ${s.n}: ${w}` : w))),
      included: true,
    };
  };
  if (mode === "whole_deck") return [mk(slides, defaults.collectionName.replace(/\.pptx$/i, ""))];
  if (mode === "by_section") {
    const groups = new Map<string, CannedSlide[]>();
    slides.forEach((s) => groups.set(s.section, [...(groups.get(s.section) ?? []), s]));
    return [...groups.entries()].map(([section, g]) => mk(g, section));
  }
  return slides.map((s) => mk([s], s.title));
}

const view = (j: ImportJobRow): ImportJob => {
  const { userId: _u, orgId: _o, ...rest } = j;
  void _u;
  void _o;
  return rest;
};

function advance(jobId: string, slides: CannedSlide[]) {
  const step = () => {
    const j = db.t.importJobs.get(jobId);
    if (!j || j.status !== "parsing") return;
    if (/corrupt/i.test(j.sourceFilename) && j.progress > 0.3) {
      db.t.importJobs.update(jobId, { status: "failed", error: "The file isn't a valid .pptx (zip directory is damaged). Re-export it from PowerPoint and try again." });
      return;
    }
    const progress = Math.min(1, j.progress + 0.08 + Math.random() * 0.1);
    if (progress >= 1) db.t.importJobs.update(jobId, { progress: 1, status: "review", items: itemsFor(j.mode, slides, j.defaults) });
    else {
      db.t.importJobs.update(jobId, { progress });
      setTimeout(step, 350);
    }
  };
  setTimeout(step, 350);
}

const slideCache = new Map<string, CannedSlide[]>();

export const importHandlers = [
  http.post(
    "/v1/orgs/:org/workspaces/:ws/imports",
    route(async ({ cookies, params, request }) => {
      const ctx = workspaceCtx(cookies, params.org as string, params.ws as string, "member");
      const body = (await request.json()) as { filename: string; bytes: number; mode: ImportMode; defaults: ImportJob["defaults"] };
      if (!/\.pptx$/i.test(body.filename)) fail(415, "unsupported_type", "Choose a .pptx file (PowerPoint 2007 or newer)");
      const slideCount = /800/.test(body.filename) ? 800 : Math.max(8, Math.min(60, Math.round(body.bytes / 400_000)));
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
        slideCount,
        defaults: body.defaults,
        items: [],
      });
      slideCache.set(job.id, cannedSlides(slideCount, addDays(todayISO(), -slideCount * 3 - 400)));
      return HttpResponse.json(view(job), { status: 201 });
    }),
  ),
  http.put(
    "/v1/orgs/:org/imports/:id/upload",
    route(async ({ cookies, params, request }) => {
      const ctx = orgCtx(cookies, params.org as string, "member");
      const j = db.t.importJobs.get(params.id as string);
      if (!j || j.orgId !== ctx.org.id) fail(404, "not_found", "Import not found");
      await request.arrayBuffer(); // held in temp storage only; not retained (§W5.4)
      db.t.importJobs.update(j!.id, { status: "parsing", progress: 0.05 });
      advance(j!.id, slideCache.get(j!.id) ?? cannedSlides(j!.slideCount, todayISO()));
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
      const slides = slideCache.get(j!.id) ?? cannedSlides(j!.slideCount, todayISO());
      const items = body.mode && body.mode !== j!.mode ? itemsFor(body.mode, slides, j!.defaults) : (body.items ?? j!.items);
      return HttpResponse.json(view(db.t.importJobs.update(j!.id, { items, mode: body.mode ?? j!.mode })!));
    }),
  ),
  http.post(
    "/v1/orgs/:org/imports/:id/commit",
    route(({ cookies, params }) => {
      const ctx = orgCtx(cookies, params.org as string, "member");
      const j = db.t.importJobs.get(params.id as string);
      if (!j || j.orgId !== ctx.org.id) fail(404, "not_found", "Import not found");
      if (j!.status === "done") return HttpResponse.json(view(j!)); // idempotent
      if (j!.status !== "review") fail(409, "not_in_review", "Nothing to commit yet");
      const slides = slideCache.get(j!.id) ?? cannedSlides(j!.slideCount, todayISO());
      const assets = db.t.assets.filter((a) => a.orgId === ctx.org.id && !a.blob);
      const coll = db.t.collections.put({ id: uuidv7(), workspaceId: j!.workspaceId, name: j!.defaults.collectionName || j!.sourceFilename, kind: "deck_import", postIds: [], createdBy: ctx.user.id });
      const postIds: string[] = [];
      const sha = j!.id.replace(/-/g, "").padEnd(64, "0");
      const items = j!.items.map((item) => {
        if (!item.included) return item;
        const postId = uuidv7();
        const blocks: Block[] = [];
        item.slideNumbers.forEach((n, idx) => {
          const s = slides[n - 1];
          if (!s) return;
          if (idx > 0) blocks.push({ id: uuidv7(), type: "slide_break", notes: `Speaker notes for slide ${n}` });
          blocks.push({ id: uuidv7(), type: "text", doc: doc(...(item.slideNumbers.length > 1 && s.title ? [heading(s.title)] : []), paragraph(s.text[0]), bulletList(s.text.slice(1))) });
          for (let k = 0; k < s.images && assets.length; k++) {
            const asset = assets[(n * 7 + k) % assets.length];
            const inst = db.t.images.put({ id: uuidv7(), assetId: asset.id, postId, tags: [], customFields: {}, caption: `Slide ${n}` });
            blocks.push({ id: uuidv7(), type: "image", imageInstanceId: inst.id });
          }
        });
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
          blocks,
          revision: 0,
          version: 1,
          createdAt: t,
          updatedAt: t,
          counts: { comments: 0, reactions: 0, images: blocks.filter((b) => b.type === "image").length },
          reactions: {},
          collectionIds: [coll.id],
          source: { kind: "import", importJobId: j!.id, fileName: j!.sourceFilename, fileSha256: sha, slide: item.slideNumbers[0], slideCount: j!.slideCount },
        });
        postIds.push(postId);
        return { ...item, postId };
      });
      db.t.collections.update(coll.id, { postIds });
      const report = { created: postIds.length, skipped: j!.items.filter((i) => !i.included).length, warnings: j!.items.reduce((n, i) => n + i.warnings.length, 0) };
      return HttpResponse.json(view(db.t.importJobs.update(j!.id, { status: "done", items, collectionId: coll.id, report })!));
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
