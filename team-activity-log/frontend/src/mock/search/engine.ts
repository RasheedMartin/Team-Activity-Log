import MiniSearch from "minisearch";
import { isFilterGroup } from "../../api/contract";
import type {
  Asset,
  Comment,
  Condition,
  DateField,
  FilterGroup,
  DateRangeValue,
  ExploreResponse,
  ExploreShelf,
  FacetBucket,
  FilterSpec,
  GalleryImage,
  HistogramBucket,
  ID,
  ImageInstance,
  ImageType,
  Post,
  SearchHit,
  SearchResponse,
  Tag,
} from "../../api/contract";
import {
  autoInterval,
  bucketStart,
  nextBucket,
  resolveRange,
  todayISO,
  addDays,
  toISODate,
  type FixedInterval,
} from "../../lib/dates";
import { effectiveSort } from "../../lib/filterSpec";
import { parseBoolean, positiveNeedles, type QueryField, type QueryNode } from "../../lib/query";
import { docText, mentionedIds } from "../../lib/prosemirror";

// Client-side stand-in for the Elasticsearch query in §B4. It implements the same FilterSpec,
// the same disjunctive facet semantics (§W4.7), and the same histogram bucketing (§W4.2), so
// the UI is built on real behavior. It is deliberately structured like the ES query:
// security filters → text query → per-group filters → facets/histogram each excluding their own group.

export interface EngineImage {
  inst: ImageInstance;
  asset: Asset;
}
export interface EngineData {
  posts(): Iterable<Post & { indexedAt?: number }>;
  /** Tags of one org, or of every org when orgId is omitted (index text). */
  tags(orgId?: ID): Tag[];
  images(post: Post): EngineImage[];
  comments(postId: ID): Comment[];
}
export interface EngineContext {
  orgId: ID;
  workspaceIds: ID[];
  me: ID;
  canSeeHidden: boolean;
  now?: Date;
}

interface Derived {
  post: Post;
  title: string;
  summary: string;
  body: string;
  tagText: string;
  commentText: string;
  imageText: string;
  annotationText: string;
  all: string;
  images: EngineImage[];
  imageTypes: Set<ImageType>;
  hasAnnotations: boolean;
  unanswered: boolean;
  resolved: boolean;
  commenters: Set<ID>;
  reactors: Set<ID>;
  mentioned: Set<ID>;
  lastActivity: string;
}

type Group = "text" | "tag" | "author" | "imageType" | "date" | "other";
const FACET_GROUPS: Group[] = ["tag", "author", "imageType", "date", "other"];
export const IMAGE_TYPES: ImageType[] = ["chart", "photo", "screenshot", "diagram", "table"];
const DEFAULT_LIMIT = 30;
const MAX_BUCKETS = 1500;

const lower = (s?: string) => (s ?? "").toLowerCase();
const dateOf = (p: Post, f: DateField) => (f === "workDate" ? p.workDate : (p[f] ?? p.createdAt).slice(0, 10));

export class SearchEngine {
  private readonly data: EngineData;
  private derived = new Map<ID, Derived>();
  private mini: MiniSearch<{ id: ID }> | null = null;
  private tagNames = new Map<ID, string>();
  private dirty = new Set<ID>();

  constructor(data: EngineData) {
    this.data = data;
  }

  /** Mark a post's search document stale (the outbox → indexer path, §B5). */
  touch(postId: ID) {
    this.dirty.add(postId);
  }
  reset() {
    this.derived.clear();
    this.mini = null;
    this.built = false;
    this.dirty.clear();
  }

  private derive(post: Post): Derived {
    const tagText = post.tagIds.map((id) => this.tagNames.get(id) ?? "").join(" ");
    const blocksText = post.blocks
      .filter((b) => b.type === "text" || b.type === "table")
      .map((b) => docText((b as { doc: unknown }).doc))
      .join("\n");
    const images = this.data.images(post);
    const comments = this.data.comments(post.id).filter((c) => !c.deletedAt && !c.hidden);
    const imageText = images
      .map((i) => [i.inst.caption, i.inst.altText, i.inst.figureLabel, i.asset.metadata.ocrText, ...Object.values(i.inst.customFields)].filter(Boolean).join(" "))
      .join("\n");
    const annotationText = images.flatMap((i) => i.inst.annotation?.shapes.map((s) => s.text ?? "") ?? []).join(" ");
    const commentText = comments.map((c) => docText(c.doc)).join("\n");
    const reactors = new Set<ID>(Object.values(post.reactions ?? {}).flat());
    comments.forEach((c) => Object.values(c.reactions).flat().forEach((id) => reactors.add(id)));
    const mentioned = new Set<ID>([...mentionedIds({ type: "doc", content: post.blocks.map((b) => (b as { doc?: unknown }).doc).filter(Boolean) }), ...comments.flatMap((c) => mentionedIds(c.doc))]);
    const questions = comments.filter((c) => c.isQuestion);
    const lastActivity = comments.reduce((m, c) => (c.createdAt > m ? c.createdAt : m), post.updatedAt);
    const d: Derived = {
      post,
      title: post.title,
      summary: post.summary ?? "",
      body: blocksText,
      tagText,
      commentText,
      imageText,
      annotationText,
      all: lower([post.title, post.summary, blocksText, tagText, commentText, imageText, annotationText].join("\n")),
      images,
      imageTypes: new Set(images.map((i) => i.asset.metadata.detectedType).filter((t): t is ImageType => !!t)),
      hasAnnotations: images.some((i) => (i.inst.annotation?.shapes.length ?? 0) > 0),
      unanswered: questions.some((c) => !c.resolved),
      resolved: questions.some((c) => c.resolved),
      commenters: new Set(comments.map((c) => c.authorId)),
      reactors,
      mentioned,
      lastActivity,
    };
    return d;
  }

  private built = false;

  /** Derived docs (filters, facets, histogram) are built eagerly; the full-text index lazily. */
  private ensureIndex() {
    this.tagNames = new Map(this.data.tags().map((t) => [t.id, t.name]));
    if (!this.built) {
      for (const p of this.data.posts()) if (p.status === "published" && !p.deletedAt) this.derived.set(p.id, this.derive(p));
      this.built = true;
      this.dirty.clear();
      return;
    }
    if (!this.dirty.size) return;
    const byId = new Map<ID, Post>();
    for (const p of this.data.posts()) if (this.dirty.has(p.id)) byId.set(p.id, p);
    for (const id of this.dirty) {
      if (this.mini?.has(id)) this.mini.discard(id);
      this.derived.delete(id);
      const p = byId.get(id);
      if (!p || p.status !== "published" || p.deletedAt) continue;
      const d = this.derive(p);
      this.derived.set(id, d);
      this.mini?.add({ id, ...this.fieldsOf(d) });
    }
    this.dirty.clear();
  }

  /** Build everything ahead of the first query (called in idle time after the app renders). */
  warm() {
    this.ensureIndex();
    this.ensureMini();
  }

  /** Full-text index, built on the first text query (the plain feed never needs it). */
  private ensureMini(): MiniSearch<{ id: ID }> {
    if (!this.mini) {
      this.mini = new MiniSearch<{ id: ID }>({
        fields: ["title", "summary", "body", "tagText", "commentText", "imageText", "annotationText"],
        storeFields: [],
        searchOptions: { prefix: true, combineWith: "AND" },
      });
      this.mini.addAll([...this.derived.values()].map((d) => ({ id: d.post.id, ...this.fieldsOf(d) })));
    }
    return this.mini;
  }

  private fieldsOf(d: Derived) {
    return {
      title: d.title,
      summary: d.summary,
      body: d.body,
      tagText: d.tagText,
      commentText: d.commentText,
      imageText: d.imageText,
      annotationText: d.annotationText,
    };
  }

  // ---- condition evaluation ----

  private groupOf(c: Condition): Group {
    if (c.field === "tag") return "tag";
    if (c.field === "author" || c.field === "coAuthor") return "author";
    if (c.field === "image.type") return "imageType";
    if (c.field === "workDate" || c.field === "publishedAt" || c.field === "updatedAt") return "date";
    return "other";
  }

  private matchDate(value: string, c: Condition, now: Date): boolean {
    if (c.op === "between") {
      const r = resolveRange(c.value as DateRangeValue, now);
      return (!r.from || value >= r.from) && (!r.to || value <= r.to);
    }
    if (c.op === "gte") return value >= String(c.value);
    if (c.op === "lte") return value <= String(c.value);
    return value === String(c.value);
  }

  private matchSet(values: string[], c: Condition): boolean {
    const want = Array.isArray(c.value) ? (c.value as string[]) : [String(c.value)];
    if (c.op === "in_all") return want.every((w) => values.includes(w));
    if (c.op === "not_in") return !want.some((w) => values.includes(w));
    return want.some((w) => values.includes(w));
  }

  private matchImage(img: EngineImage, c: Condition, now: Date): boolean {
    const v = c.value;
    const s = lower(String(v ?? ""));
    switch (c.field) {
      case "image.ocrText":
        return lower(img.asset.metadata.ocrText).includes(s);
      case "image.type":
        return this.matchSet([img.asset.metadata.detectedType ?? ""], c);
      case "image.figureLabel":
        return c.op === "eq" ? lower(img.inst.figureLabel) === s : lower(img.inst.figureLabel).includes(s);
      case "image.filename":
        return lower(img.asset.originalFilename).includes(s);
      case "image.capturedAt": {
        const at = img.asset.metadata.exif?.capturedAt?.slice(0, 10);
        return !!at && this.matchDate(at, c, now);
      }
      case "image.minWidth":
        return img.asset.width >= Number(v);
      case "image.minHeight":
        return img.asset.height >= Number(v);
      case "image.custom": {
        const { key, value } = (v ?? {}) as { key?: string; value?: string };
        const actual = key ? img.inst.customFields[key] : undefined;
        return actual !== undefined && (value === undefined || lower(actual) === lower(value));
      }
      case "image.annotationText":
        return lower(img.inst.annotation?.shapes.map((x) => x.text ?? "").join(" ")).includes(s);
      default:
        return true;
    }
  }

  private matchPost(d: Derived, c: Condition, me: ID, now: Date): boolean {
    const p = d.post;
    const truthy = c.value !== false;
    switch (c.field) {
      case "author":
        return this.matchSet([p.authorId, ...p.coAuthorIds], c);
      case "coAuthor":
        return this.matchSet(p.coAuthorIds, c);
      case "tag":
        return this.matchSet(p.tagIds, c);
      case "workDate":
      case "publishedAt":
      case "updatedAt":
        return this.matchDate(dateOf(p, c.field), c, now);
      case "hasImages":
        return d.images.length > 0 === truthy;
      case "hasAnnotations":
        return d.hasAnnotations === truthy;
      case "hasComments":
        return p.counts.comments > 0 === truthy;
      case "unansweredQuestion":
        return d.unanswered === truthy;
      case "resolved":
        return d.resolved === truthy;
      case "mentionsMe":
        return d.mentioned.has(me) === truthy;
      case "iCommented":
        return d.commenters.has(me) === truthy;
      case "iReacted":
        return d.reactors.has(me) === truthy;
      case "mine":
        return (p.authorId === me || p.coAuthorIds.includes(me)) === truthy;
      case "collection":
        return this.matchSet(p.collectionIds ?? [], c);
      case "status":
        return this.matchSet([p.status], c);
      case "visibility":
        return c.value === "any" || this.matchSet([p.visibility], c);
      case "importedFrom":
        return !!p.source && (c.op === "contains" ? lower(p.source.fileName).includes(lower(String(c.value))) : p.source.fileName === c.value);
      case "workDateGuessed":
        return (p.workDateSource !== "user") === truthy;
      default:
        if (c.field.startsWith("image.")) return d.images.some((img) => this.matchImage(img, c, now));
        return true;
    }
  }

  private matchGroup(d: Derived, g: FilterGroup, me: ID, now: Date): boolean {
    const test = (x: Condition | FilterGroup) => (isFilterGroup(x) ? this.matchGroup(d, x, me, now) : this.matchPost(d, x, me, now));
    if (!g.items.length) return true;
    if (g.op === "or") return g.items.some(test);
    if (g.op === "not") return !g.items.some(test);
    return g.items.every(test);
  }

  /** For each group: does the post pass that group's conditions? (all ∧ any ∧ ¬none ∧ where) */
  private groupPasses(d: Derived, spec: FilterSpec, me: ID, now: Date): Record<Group, boolean> {
    const pass: Record<Group, boolean> = { text: true, tag: true, author: true, imageType: true, date: true, other: true };
    // Image-level conditions in `all` must hold for the *same* image (nested semantics, §B4).
    const imageAll = (spec.all ?? []).filter((c) => c.field.startsWith("image.") && c.field !== "image.type");
    const typeAll = (spec.all ?? []).filter((c) => c.field === "image.type");
    if (imageAll.length || typeAll.length) {
      const sameImage = (withType: boolean) =>
        d.images.some((img) => imageAll.every((c) => this.matchImage(img, c, now)) && (!withType || typeAll.every((c) => this.matchImage(img, c, now))));
      if (imageAll.length && !sameImage(false)) pass.other = false;
      if (typeAll.length && !sameImage(true)) pass.imageType = false;
    }
    for (const c of spec.all ?? []) {
      if (c.field.startsWith("image.")) continue;
      const g = this.groupOf(c);
      if (pass[g] && !this.matchPost(d, c, me, now)) pass[g] = false;
    }
    if (spec.any?.length && !spec.any.some((c) => this.matchPost(d, c, me, now))) pass.other = false;
    if (spec.where && pass.other && !this.matchGroup(d, spec.where, me, now)) pass.other = false;
    for (const c of spec.none ?? []) {
      const g = this.groupOf(c);
      if (pass[g] && this.matchPost(d, c, me, now)) pass[g] = false;
    }
    return pass;
  }

  // ---- text (boolean query, src/lib/query.ts) ----

  private static FIELD_MAP: Record<QueryField, (keyof ReturnType<SearchEngine["fieldsOf"]>)[]> = {
    title: ["title"],
    body: ["summary", "body"],
    comment: ["commentText"],
    image: ["imageText", "annotationText"],
    tag: ["tagText"],
  };

  private fieldText(d: Derived, field?: QueryField): string {
    if (!field) return d.all;
    const f = this.fieldsOf(d);
    return lower(SearchEngine.FIELD_MAP[field].map((k) => f[k]).join("\n"));
  }

  /** Evaluate a query AST over the candidate set; returns matching ids with relevance scores. */
  private evalQuery(n: QueryNode, universe: Map<ID, Derived>): Map<ID, number> {
    switch (n.type) {
      case "term": {
        const out = new Map<ID, number>();
        const res = this.ensureMini().search(n.value, {
          fields: n.field ? SearchEngine.FIELD_MAP[n.field] : undefined,
          prefix: !!n.prefix || n.value.length > 2,
          fuzzy: n.value.length > 4 ? 0.2 : false,
          boost: { title: 4, tagText: 3, summary: 2, body: 1, commentText: 0.7, imageText: 0.8, annotationText: 0.8 },
        });
        for (const r of res) if (universe.has(r.id as ID)) out.set(r.id as ID, r.score);
        return out;
      }
      case "phrase": {
        const out = new Map<ID, number>();
        for (const [id, d] of universe) if (this.fieldText(d, n.field).includes(n.value)) out.set(id, 3 + (lower(d.title).includes(n.value) ? 4 : 0));
        return out;
      }
      case "not": {
        const ex = this.evalQuery(n.child, universe);
        const out = new Map<ID, number>();
        for (const id of universe.keys()) if (!ex.has(id)) out.set(id, 0);
        return out;
      }
      case "and": {
        let acc: Map<ID, number> | null = null;
        for (const c of n.children) {
          const m = this.evalQuery(c, acc ? new Map([...acc.keys()].map((id) => [id, universe.get(id)!])) : universe);
          const next = new Map<ID, number>();
          for (const [id, sc] of m) if (!acc || acc.has(id)) next.set(id, (acc?.get(id) ?? 0) + sc);
          acc = next;
          if (!acc.size) break;
        }
        return acc ?? new Map();
      }
      case "or": {
        const out = new Map<ID, number>();
        for (const c of n.children) for (const [id, sc] of this.evalQuery(c, universe)) out.set(id, (out.get(id) ?? 0) + sc);
        return out;
      }
    }
  }

  // ---- main entry ----

  search(spec: FilterSpec, ctx: EngineContext): SearchResponse {
    const t0 = performance.now();
    const now = ctx.now ?? new Date();
    this.ensureIndex();

    // 1. Security filters, always on.
    const wantHidden = (spec.all ?? []).some((c) => c.field === "visibility" && (c.value === "hidden" || c.value === "any"));
    const ws = new Set(ctx.workspaceIds);
    const candidates: Derived[] = [];
    for (const d of this.derived.values()) {
      const p = d.post as Post & { indexedAt?: number };
      if (p.orgId !== ctx.orgId || !ws.has(p.workspaceId)) continue;
      if (p.indexedAt && p.indexedAt > now.getTime()) continue;
      if (p.visibility === "hidden" && !(wantHidden && (ctx.canSeeHidden || p.authorId === ctx.me))) continue;
      candidates.push(d);
    }

    // 2. Text query (boolean AST).
    const { ast } = parseBoolean(spec.q);
    const scores = ast ? this.evalQuery(ast, new Map(candidates.map((d) => [d.post.id, d]))) : null;
    const needles = positiveNeedles(ast);

    // 3. Per-group pass vectors.
    const rows = candidates
      .filter((d) => !scores || scores.has(d.post.id))
      .map((d) => ({ d, pass: this.groupPasses(d, spec, ctx.me, now) }));
    const passesExcept = (pass: Record<Group, boolean>, skip?: Group) => FACET_GROUPS.every((g) => g === skip || pass[g]);

    const hits = rows.filter((r) => passesExcept(r.pass)).map((r) => r.d);

    // 4. Disjunctive facets: each excludes its own group.
    const facets = this.facets(rows, passesExcept, spec, ctx.orgId);

    // 5. Histogram: all filters except the date filter.
    const histogram = this.histogram(rows.filter((r) => passesExcept(r.pass, "date")).map((r) => r.d), spec, now);

    // 6. Sort + page.
    const sort = effectiveSort(spec);
    const by: Record<string, (a: Derived, b: Derived) => number> = {
      relevance: (a, b) => (scores?.get(b.post.id) ?? 0) - (scores?.get(a.post.id) ?? 0) || cmpDesc(a.post.publishedAt, b.post.publishedAt),
      newest: (a, b) => cmpDesc(a.post.publishedAt, b.post.publishedAt),
      oldest: (a, b) => -cmpDesc(a.post.publishedAt, b.post.publishedAt),
      workDate: (a, b) => cmpDesc(a.post.workDate, b.post.workDate) || cmpDesc(a.post.publishedAt, b.post.publishedAt),
      mostDiscussed: (a, b) => b.post.counts.comments - a.post.counts.comments || cmpDesc(a.post.publishedAt, b.post.publishedAt),
      recentActivity: (a, b) => cmpDesc(a.lastActivity, b.lastActivity),
    };
    hits.sort((a, b) => by[sort](a, b) || a.post.id.localeCompare(b.post.id));

    const limit = spec.limit ?? DEFAULT_LIMIT;
    const offset = spec.cursor ? Number(atob(spec.cursor)) || 0 : 0;
    const imageConds = (spec.all ?? []).filter((c) => c.field.startsWith("image."));

    let images: GalleryImage[] | undefined;
    let pageHits: Derived[] = [];
    let nextCursor: string | undefined;
    let total = hits.length;
    if (spec.view === "gallery") {
      const all: GalleryImage[] = [];
      for (const d of hits)
        for (const img of d.images)
          if (imageConds.every((c) => this.matchImage(img, c, now))) all.push(this.galleryImage(d, img));
      images = all.slice(offset, offset + limit);
      nextCursor = offset + limit < all.length ? btoa(String(offset + limit)) : undefined;
      total = all.length;
    } else {
      pageHits = hits.slice(offset, offset + limit);
      nextCursor = offset + limit < hits.length ? btoa(String(offset + limit)) : undefined;
    }

    return {
      hits: pageHits.map((d) => this.hit(d, needles, imageConds, now)),
      images,
      facets,
      histogram,
      total,
      nextCursor,
      tookMs: Math.round(performance.now() - t0),
    };
  }

  /** Discovery shelves: one per tag with posts in scope, ordered by most recent activity. */
  explore(ctx: EngineContext, opts: { perShelf?: number; maxShelves?: number } = {}): ExploreResponse {
    this.ensureIndex();
    const per = opts.perShelf ?? 12;
    const ws = new Set(ctx.workspaceIds);
    const now = (ctx.now ?? new Date()).getTime();
    const visible = [...this.derived.values()]
      .filter((d) => {
        const p = d.post as Post & { indexedAt?: number };
        return p.orgId === ctx.orgId && ws.has(p.workspaceId) && p.visibility === "visible" && !(p.indexedAt && p.indexedAt > now);
      })
      .sort((a, b) => cmpDesc(a.post.publishedAt, b.post.publishedAt));
    const tags = new Map(this.data.tags(ctx.orgId).map((t) => [t.id, t]));
    const byTag = new Map<ID, Derived[]>();
    for (const d of visible) for (const t of d.post.tagIds) if (tags.has(t)) byTag.set(t, [...(byTag.get(t) ?? []), d]);
    const shelves: ExploreShelf[] = [...byTag.entries()].map(([tagId, list]) => {
      const imgs = list.flatMap((d) => d.images.map((img) => this.galleryImage(d, img)));
      return {
        tag: tags.get(tagId)!,
        count: list.length,
        imageCount: imgs.length,
        lastActivity: list[0].lastActivity > (list[0].post.publishedAt ?? "") ? list[0].lastActivity : list[0].post.publishedAt ?? list[0].post.createdAt,
        posts: list.slice(0, per).map((d) => {
          const first = d.images[0];
          const text = (d.summary || d.body).replace(/\s+/g, " ").trim();
          return {
            id: d.post.id,
            title: d.post.title,
            workDate: d.post.workDate,
            authorId: d.post.authorId,
            excerpt: text.length > 240 ? `${text.slice(0, 240)}…` : text,
            imageCount: d.images.length,
            commentCount: d.post.counts.comments,
            thumbUrl: first?.asset.variants.find((v) => v.name === "small")?.url,
            dominantColor: first?.asset.dominantColors[0],
          };
        }),
        images: imgs.slice(0, per),
      };
    });
    shelves.sort((a, b) => b.lastActivity.localeCompare(a.lastActivity));
    const recent = visible.flatMap((d) => d.images.map((img) => this.galleryImage(d, img))).slice(0, 24);
    return { shelves: shelves.slice(0, opts.maxShelves ?? 40), recent };
  }

  private facets(
    rows: { d: Derived; pass: Record<Group, boolean> }[],
    passesExcept: (p: Record<Group, boolean>, skip?: Group) => boolean,
    spec: FilterSpec,
    orgId: ID,
  ): SearchResponse["facets"] {
    const selected = (field: string) =>
      new Set([...(spec.all ?? []), ...(spec.none ?? [])].filter((c) => c.field === field).flatMap((c) => (Array.isArray(c.value) ? (c.value as string[]) : [String(c.value)])));

    const tagCounts = new Map<string, number>();
    const authorCounts = new Map<string, number>();
    const typeCounts = new Map<string, number>();
    for (const { d, pass } of rows) {
      if (passesExcept(pass, "tag")) for (const t of d.post.tagIds) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
      if (passesExcept(pass, "author")) for (const a of new Set([d.post.authorId, ...d.post.coAuthorIds])) authorCounts.set(a, (authorCounts.get(a) ?? 0) + 1);
      if (passesExcept(pass, "imageType")) for (const t of d.imageTypes) typeCounts.set(t, (typeCounts.get(t) ?? 0) + 1);
    }
    const selTags = selected("tag");
    const selAuthors = selected("author");
    const selTypes = selected("image.type");
    const tags: FacetBucket[] = this.data
      .tags(orgId)
      .map((t) => ({ value: t.id, label: t.name, count: tagCounts.get(t.id) ?? 0, selected: selTags.has(t.id) || undefined }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
    const authorIds = new Set([...authorCounts.keys(), ...selAuthors]);
    const authors: FacetBucket[] = [...authorIds]
      .map((id) => ({ value: id, count: authorCounts.get(id) ?? 0, selected: selAuthors.has(id) || undefined }))
      .sort((a, b) => b.count - a.count);
    const imageTypes: FacetBucket[] = IMAGE_TYPES.map((t) => ({ value: t, label: t, count: typeCounts.get(t) ?? 0, selected: selTypes.has(t) || undefined }));
    return { tags, authors, imageTypes };
  }

  private histogram(base: Derived[], spec: FilterSpec, now: Date): SearchResponse["histogram"] {
    const field = spec.histogram?.field ?? "workDate";
    const dateCond = (spec.all ?? []).find((c) => c.field === field && c.op === "between");
    const selected = dateCond ? resolveRange(dateCond.value as DateRangeValue, now) : undefined;

    let from: string | undefined = spec.histogram?.bounds?.from;
    let to: string | undefined = spec.histogram?.bounds?.to;
    if (!from || !to) {
      let min: string | undefined;
      let max: string | undefined;
      for (const d of base) {
        const v = dateOf(d.post, field);
        if (!min || v < min) min = v;
        if (!max || v > max) max = v;
      }
      if (selected?.from && (!min || selected.from < min)) min = selected.from;
      if (selected?.to && (!max || selected.to > max)) max = selected.to;
      from = min ?? addDays(todayISO(now), -29);
      to = max ?? todayISO(now);
      if (to > todayISO(now) && !selected?.to) to = todayISO(now);
    }
    const requested = spec.histogram?.interval ?? "auto";
    let interval: FixedInterval = requested === "auto" ? autoInterval(from, to) : requested;

    // Guard against a forced interval producing an unusable number of bars.
    const order: FixedInterval[] = ["day", "week", "month", "quarter", "year"];
    const countBuckets = (iv: FixedInterval) => {
      let n = 0;
      for (let b = bucketStart(new Date(`${from}T00:00:00Z`), iv); toISODate(b) <= to! && n <= MAX_BUCKETS; b = nextBucket(b, iv)) n++;
      return n;
    };
    while (countBuckets(interval) > MAX_BUCKETS && interval !== "year") interval = order[order.indexOf(interval) + 1];

    const buckets: HistogramBucket[] = [];
    const index = new Map<string, number>();
    for (let b = bucketStart(new Date(`${from}T00:00:00Z`), interval); toISODate(b) <= to; b = nextBucket(b, interval)) {
      index.set(toISODate(b), buckets.length);
      buckets.push({ start: b.toISOString(), end: nextBucket(b, interval).toISOString(), count: 0 });
    }
    const tagTallies: Map<string, number>[] = buckets.map(() => new Map());
    for (const d of base) {
      const v = dateOf(d.post, field);
      if (v < from || v > to) continue;
      const key = toISODate(bucketStart(new Date(`${v}T00:00:00Z`), interval));
      const i = index.get(key);
      if (i === undefined) continue;
      buckets[i].count++;
      for (const t of d.post.tagIds) tagTallies[i].set(t, (tagTallies[i].get(t) ?? 0) + 1);
    }
    buckets.forEach((b, i) => {
      if (!b.count) return;
      b.topTags = [...tagTallies[i].entries()]
        .sort((a, c) => c[1] - a[1])
        .slice(0, 3)
        .map(([tagId, count]) => ({ tagId, count }));
    });
    return {
      field,
      interval,
      buckets,
      selectedRange:
        selected && (selected.from || selected.to)
          ? { from: `${selected.from ?? from}T00:00:00.000Z`, to: `${addDays(selected.to ?? to, 1)}T00:00:00.000Z` }
          : undefined,
    };
  }

  private galleryImage(d: Derived, img: EngineImage): GalleryImage {
    const thumb = img.asset.variants.find((v) => v.name === "small") ?? img.asset.variants[0];
    return {
      imageInstanceId: img.inst.id,
      postId: d.post.id,
      postTitle: d.post.title,
      thumbUrl: thumb?.url ?? "",
      width: img.asset.width,
      height: img.asset.height,
      blurhash: img.asset.blurhash,
      dominantColor: img.asset.dominantColors[0],
      caption: img.inst.caption,
      figureLabel: img.inst.figureLabel,
    };
  }

  private hit(d: Derived, needles: string[], imageConds: Condition[], now: Date): SearchHit {
    const fields: [string, string, string][] = [
      ["title", "title", d.title],
      ["summary", "body", d.summary],
      ["body", "body", d.body],
      ["tags", "tag", d.tagText],
      ["comments", "comment", d.commentText],
      ["images", "image text", d.imageText],
      ["annotations", "annotation", d.annotationText],
    ];
    const highlights: SearchHit["highlights"] = [];
    const matchedIn = new Set<string>();
    if (needles.length) {
      for (const [field, label, text] of fields) {
        const snip = snippet(text, needles, field === "title" ? 400 : 180);
        if (!snip) continue;
        matchedIn.add(label);
        if (field !== "tags") highlights.push({ field, snippet: snip });
      }
    }
    const imgs = d.images.map((i) => {
      const v = i.asset.variants.find((x) => x.name === "thumb") ?? i.asset.variants[0];
      return { imageInstanceId: i.inst.id, thumbUrl: v?.url ?? "", blurhash: i.asset.blurhash, width: i.asset.width, height: i.asset.height, dominantColor: i.asset.dominantColors[0] };
    });
    const imageHits =
      imageConds.length || (needles.length && matchedIn.has("image text"))
        ? d.images
            .filter((i) => (imageConds.length ? imageConds.every((c) => this.matchImage(i, c, now)) : needles.some((n) => lower(`${i.asset.metadata.ocrText} ${i.inst.caption}`).includes(n))))
            .map((i) => ({ imageInstanceId: i.inst.id, thumbUrl: i.asset.variants[0]?.url ?? "" }))
        : undefined;
    return { post: d.post, highlights, matchedIn: [...matchedIn], imageHits, images: imgs };
  }
}

const cmpDesc = (a?: string, b?: string) => (b ?? "").localeCompare(a ?? "");

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A window of `text` around the first match, HTML-escaped, with matches wrapped in <mark>. */
export function snippet(text: string, needles: string[], width = 180): string | null {
  if (!text) return null;
  const re = new RegExp(`(?<![\\p{L}\\p{N}])(${needles.map(escapeRe).join("|")})[\\p{L}\\p{N}]*`, "giu");
  const first = re.exec(text);
  if (!first) return null;
  const start = Math.max(0, first.index - Math.floor(width / 3));
  const end = Math.min(text.length, start + width);
  let slice = text.slice(start, end).replace(/\s+/g, " ");
  slice = escapeHtml(slice);
  const out = slice.replace(new RegExp(`(?<![\\p{L}\\p{N}])(${needles.map((n) => escapeRe(escapeHtml(n))).join("|")})[\\p{L}\\p{N}]*`, "giu"), "<mark>$&</mark>");
  return `${start > 0 ? "…" : ""}${out}${end < text.length ? "…" : ""}`;
}
