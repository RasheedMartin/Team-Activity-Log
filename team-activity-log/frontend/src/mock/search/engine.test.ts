import { describe, expect, it } from "vitest";
import type { Asset, Comment, ImageInstance, Post, Tag } from "../../api/contract";
import { doc, paragraph } from "../../lib/prosemirror";
import { SearchEngine, snippet, type EngineImage } from "./engine";
import { toggleFacetValue, setDateFilter } from "../../lib/filterSpec";

const ORG = "org1";
const WS = "ws1";
const NOW = new Date("2026-10-23T12:00:00Z");

const tags: Tag[] = [
  { id: "t-cal", name: "calibration", color: "#000" },
  { id: "t-det", name: "detector-B", color: "#000" },
  { id: "t-noise", name: "noise", color: "#000" },
];

let n = 0;
function post(p: Partial<Post> & { text?: string }): Post {
  n++;
  return {
    id: `p${n}`,
    orgId: ORG,
    workspaceId: WS,
    title: `Post ${n}`,
    workDate: "2026-10-01",
    workDateSource: "user",
    status: "published",
    visibility: "visible",
    authorId: "dana",
    coAuthorIds: [],
    tagIds: [],
    blocks: [{ id: `b${n}`, type: "text", doc: doc(paragraph(p.text ?? "plain body")) }],
    revision: 1,
    version: 1,
    createdAt: "2026-10-01T10:00:00Z",
    updatedAt: "2026-10-01T10:00:00Z",
    publishedAt: "2026-10-01T10:00:00Z",
    counts: { comments: 0, reactions: 0, images: 0 },
    reactions: {},
    collectionIds: [],
    ...p,
  };
}

function engineFor(posts: Post[], images: Record<string, EngineImage[]> = {}, comments: Record<string, Comment[]> = {}) {
  return new SearchEngine({
    posts: () => posts,
    tags: () => tags,
    images: (p) => images[p.id] ?? [],
    comments: (id) => comments[id] ?? [],
  });
}
const ctx = { orgId: ORG, workspaceIds: [WS], me: "dana", canSeeHidden: false, now: NOW };

describe("security filters", () => {
  it("excludes drafts, deleted, other workspaces, other orgs, and hidden by default", () => {
    const posts = [
      post({ title: "visible" }),
      post({ status: "draft" }),
      post({ deletedAt: "2026-10-02T00:00:00Z" }),
      post({ workspaceId: "other" }),
      post({ orgId: "org2" }),
      post({ visibility: "hidden", authorId: "marcus" }),
    ];
    const r = engineFor(posts).search({}, ctx);
    expect(r.hits.map((h) => h.post.title)).toEqual(["visible"]);
  });

  it("includes hidden only when asked and permitted (author or admin)", () => {
    const posts = [post({ visibility: "hidden", authorId: "marcus" }), post({ visibility: "hidden", authorId: "dana" })];
    const spec = { all: [{ field: "visibility" as const, op: "eq" as const, value: "any" }] };
    expect(engineFor(posts).search(spec, ctx).total).toBe(1);
    expect(engineFor(posts).search(spec, { ...ctx, canSeeHidden: true }).total).toBe(2);
  });

  it("honors mock index lag", () => {
    const posts = [post({}), { ...post({}), indexedAt: NOW.getTime() + 1000 }];
    expect(engineFor(posts).search({}, ctx).total).toBe(1);
  });
});

describe("text query", () => {
  const posts = [
    post({ title: "Detector B drift after cooldown", text: "gain drift observed" }),
    post({ title: "Cryostat log", text: "pressure stable, no drift" }),
    post({ title: "Calibration spectrum", text: "Co-60 peaks look clean" }),
  ];
  it("matches by prefix and ranks title hits first", () => {
    const r = engineFor(posts).search({ q: "drif" }, ctx);
    expect(r.hits.map((h) => h.post.title)).toEqual(["Detector B drift after cooldown", "Cryostat log"]);
    expect(r.hits[0].matchedIn).toContain("title");
  });
  it("tolerates typos on longer terms", () => {
    expect(engineFor(posts).search({ q: "calibraton" }, ctx).total).toBe(1);
  });
  it("supports exact phrases and exclusions", () => {
    expect(engineFor(posts).search({ q: '"no drift"' }, ctx).hits.map((h) => h.post.title)).toEqual(["Cryostat log"]);
    expect(engineFor(posts).search({ q: "drift -cryostat" }, ctx).hits.map((h) => h.post.title)).toEqual(["Detector B drift after cooldown"]);
  });
  it("finds text in image OCR and comments", () => {
    const asset = { id: "a1", metadata: { ocrText: "Energy (keV) Counts", ocrState: "ready", sourceKind: "upload", detectedType: "chart" }, variants: [], dominantColors: [], width: 10, height: 10 } as unknown as Asset;
    const inst: ImageInstance = { id: "i1", assetId: "a1", tags: [], customFields: {} };
    const comment = { id: "c1", postId: posts[1].id, authorId: "x", doc: doc(paragraph("check the thermometer")), reactions: {} } as unknown as Comment;
    const e = engineFor(posts, { [posts[2].id]: [{ inst, asset }] }, { [posts[1].id]: [comment] });
    expect(e.search({ q: "kev" }, ctx).hits[0].matchedIn).toContain("image text");
    expect(e.search({ q: "thermometer" }, ctx).hits[0].post.id).toBe(posts[1].id);
  });
});

describe("boolean queries and advanced filters", () => {
  const posts = [
    post({ title: "Detector B drift", text: "gain drift after cooldown", tagIds: ["t-det"] }),
    post({ title: "Pump noise", text: "noise from the vacuum pump", tagIds: ["t-noise"] }),
    post({ title: "Calibration run", text: "drift corrected, pump off", tagIds: ["t-cal"] }),
  ];
  const titles = (q: string, extra = {}) => engineFor(posts).search({ q, ...extra }, ctx).hits.map((h) => h.post.title).sort();
  it("AND / OR / NOT / parentheses", () => {
    expect(titles("drift AND pump")).toEqual(["Calibration run"]);
    expect(titles("gain OR noise")).toEqual(["Detector B drift", "Pump noise"]);
    expect(titles("drift NOT pump")).toEqual(["Detector B drift"]);
    expect(titles("(gain OR vacuum) -cooldown")).toEqual(["Pump noise"]);
  });
  it("field scopes", () => {
    expect(titles("title:pump")).toEqual(["Pump noise"]);
    expect(titles("body:pump")).toEqual(["Calibration run", "Pump noise"]);
    expect(titles('title:"calibration run"')).toEqual(["Calibration run"]);
  });
  it("nested where groups", () => {
    const where = { op: "or" as const, items: [{ field: "tag" as const, op: "in" as const, value: ["t-det"] }, { op: "and" as const, items: [{ field: "tag" as const, op: "in" as const, value: ["t-cal"] }, { op: "not" as const, items: [{ field: "author" as const, op: "in" as const, value: ["marcus"] }] }] }] };
    expect(titles("", { where })).toEqual(["Calibration run", "Detector B drift"]);
  });
});

describe("disjunctive facets (§W4.7)", () => {
  const posts = [
    post({ tagIds: ["t-cal"], authorId: "dana" }),
    post({ tagIds: ["t-cal", "t-det"], authorId: "marcus" }),
    post({ tagIds: ["t-det"], authorId: "dana" }),
    post({ tagIds: ["t-noise"], authorId: "marcus" }),
  ];
  it("tag counts ignore the tag selection but respect other filters", () => {
    let spec = toggleFacetValue({}, "tag", "t-cal", "include");
    let r = engineFor(posts).search(spec, ctx);
    expect(r.total).toBe(2);
    const count = (id: string) => r.facets.tags.find((t) => t.value === id)?.count;
    // Same counts as with no tag selected:
    expect(count("t-cal")).toBe(2);
    expect(count("t-det")).toBe(2);
    expect(count("t-noise")).toBe(1);
    expect(r.facets.tags.find((t) => t.value === "t-cal")?.selected).toBe(true);

    // Add an author filter: tag counts now reflect it; author counts ignore the author selection.
    spec = toggleFacetValue(spec, "author", "dana", "include");
    r = engineFor(posts).search(spec, ctx);
    expect(r.total).toBe(1);
    expect(count("t-det")).toBe(1);
    expect(count("t-noise")).toBe(0);
    expect(r.facets.authors.find((a) => a.value === "marcus")?.count).toBe(1); // marcus has 1 calibration post
  });
  it("supports exclusion and match-all", () => {
    const ex = toggleFacetValue({}, "tag", "t-det", "exclude");
    expect(engineFor(posts).search(ex, ctx).total).toBe(2);
    const all = { all: [{ field: "tag" as const, op: "in_all" as const, value: ["t-cal", "t-det"] }] };
    expect(engineFor(posts).search(all, ctx).total).toBe(1);
  });
  it("zero-count tags are still returned (dimmed, not hidden)", () => {
    const r = engineFor(posts).search(toggleFacetValue({}, "author", "dana", "include"), ctx);
    expect(r.facets.tags.find((t) => t.value === "t-noise")).toMatchObject({ count: 0 });
  });
});

describe("date histogram (§W4.2)", () => {
  const posts = [post({ workDate: "2026-09-01" }), post({ workDate: "2026-09-03" }), post({ workDate: "2026-09-20" }), post({ workDate: "2026-10-01" })];
  it("auto-picks day buckets for ranges ≤ 60 days, with zero-count buckets", () => {
    const r = engineFor(posts).search({}, ctx);
    expect(r.histogram?.interval).toBe("day");
    expect(r.histogram?.buckets).toHaveLength(31);
    expect(r.histogram?.buckets.reduce((s, b) => s + b.count, 0)).toBe(4);
    expect(r.histogram?.buckets.filter((b) => b.count === 0).length).toBe(27);
  });
  it("ignores its own date filter but highlights the selected range", () => {
    const spec = setDateFilter({}, "workDate", { from: "2026-09-01", to: "2026-09-05" });
    const r = engineFor(posts).search(spec, ctx);
    expect(r.total).toBe(2);
    expect(r.histogram?.buckets.reduce((s, b) => s + b.count, 0)).toBe(4);
    expect(r.histogram?.selectedRange).toEqual({ from: "2026-09-01T00:00:00.000Z", to: "2026-09-06T00:00:00.000Z" });
  });
  it("uses calendar weeks (Monday) and months for longer spans", () => {
    const wide = [post({ workDate: "2026-01-07" }), post({ workDate: "2026-10-01" })];
    const r = engineFor(wide).search({}, ctx);
    expect(r.histogram?.interval).toBe("week");
    expect(new Date(r.histogram!.buckets[0].start).getUTCDay()).toBe(1);
    const years = [post({ workDate: "2024-01-07" }), post({ workDate: "2026-10-01" })];
    expect(engineFor(years).search({}, ctx).histogram?.interval).toBe("month");
  });
  it("reports top tags per bucket", () => {
    const tagged = [post({ workDate: "2026-09-01", tagIds: ["t-cal"] }), post({ workDate: "2026-09-01", tagIds: ["t-cal", "t-det"] })];
    const b = engineFor(tagged).search({}, ctx).histogram!.buckets[0];
    expect(b.topTags?.[0]).toEqual({ tagId: "t-cal", count: 2 });
  });
});

describe("relative dates and paging", () => {
  it("resolves presets at query time", () => {
    const posts = [post({ workDate: "2026-10-20" }), post({ workDate: "2026-08-01" })];
    const spec = setDateFilter({}, "workDate", { preset: "last_30_days" });
    expect(engineFor(posts).search(spec, ctx).total).toBe(1);
  });
  it("pages with a stable cursor", () => {
    const posts = Array.from({ length: 45 }, (_, i) => post({ publishedAt: `2026-10-${String((i % 28) + 1).padStart(2, "0")}T00:00:00Z` }));
    const e = engineFor(posts);
    const p1 = e.search({ limit: 20 }, ctx);
    const p2 = e.search({ limit: 20, cursor: p1.nextCursor }, ctx);
    const p3 = e.search({ limit: 20, cursor: p2.nextCursor }, ctx);
    const ids = [...p1.hits, ...p2.hits, ...p3.hits].map((h) => h.post.id);
    expect(new Set(ids).size).toBe(45);
    expect(p3.nextCursor).toBeUndefined();
  });
});

describe("snippet", () => {
  it("escapes HTML and marks matches", () => {
    expect(snippet("a <b> drift here", ["drift"])).toBe("a &lt;b&gt; <mark>drift</mark> here");
    expect(snippet("nothing", ["zzz"])).toBeNull();
  });
});
