import type {
  Condition,
  DateField,
  DateRangeValue,
  FilterField,
  FilterSpec,
  Interval,
  Sort,
  Tag,
  User,
} from "../api/contract";

// One FilterSpec drives the URL, saved views, the mock engine, and the real API (§A7).
// Conventions used by the UI (the engine accepts any valid FilterSpec):
//   include tags      → all: { field: "tag", op: "in" | "in_all", value: ID[] }
//   exclude tags      → none: { field: "tag", op: "in", value: ID[] }
//   people            → all: { field: "author", op: "in", value: ID[] } (none for exclude)
//   date range        → all: { field: <DateField>, op: "between", value: DateRangeValue }
//   flags             → all: { field: "hasImages", op: "eq", value: true }

export const DEFAULT_SORT: Sort = "newest";
export const DATE_FIELDS: DateField[] = ["workDate", "publishedAt", "updatedAt"];
export const isDateField = (f: FilterField): f is DateField =>
  (DATE_FIELDS as string[]).includes(f);

export const emptySpec = (): FilterSpec => ({});

// ---- URL serialization ----

/** Keys that change the result *set* (cursor/limit are transport details, never in the URL). */
export function normalize(spec: FilterSpec): FilterSpec {
  const out: FilterSpec = {};
  if (spec.q?.trim()) out.q = spec.q.trim();
  if (spec.all?.length) out.all = spec.all;
  if (spec.any?.length) out.any = spec.any;
  if (spec.none?.length) out.none = spec.none;
  if (spec.sort && spec.sort !== defaultSortFor(spec)) out.sort = spec.sort;
  if (spec.view && spec.view !== "posts") out.view = spec.view;
  if (spec.histogram && (spec.histogram.field !== "workDate" || spec.histogram.interval !== "auto"))
    out.histogram = spec.histogram;
  return out;
}

export const defaultSortFor = (spec: FilterSpec): Sort => (spec.q?.trim() ? "relevance" : DEFAULT_SORT);
export const effectiveSort = (spec: FilterSpec): Sort => spec.sort ?? defaultSortFor(spec);

export function toSearchParams(spec: FilterSpec): URLSearchParams {
  const n = normalize(spec);
  const p = new URLSearchParams();
  if (n.q) p.set("q", n.q);
  const { q: _q, ...rest } = n;
  void _q;
  if (Object.keys(rest).length) p.set("f", JSON.stringify(rest));
  return p;
}

export function fromSearchParams(p: URLSearchParams): FilterSpec {
  let rest: FilterSpec = {};
  const f = p.get("f");
  if (f) {
    try {
      const parsed = JSON.parse(f);
      if (parsed && typeof parsed === "object") rest = parsed;
    } catch {
      // a hand-edited or truncated URL: ignore the filters, keep the query
    }
  }
  const q = p.get("q") ?? undefined;
  return normalize({ ...rest, q });
}

export const specKey = (spec: FilterSpec) => JSON.stringify(normalize(spec));

// ---- Condition editing ----

type ListKey = "all" | "any" | "none";

function replace(spec: FilterSpec, list: ListKey, field: FilterField, next?: Condition): FilterSpec {
  const kept = (spec[list] ?? []).filter((c) => c.field !== field);
  const arr = next ? [...kept, next] : kept;
  return { ...spec, [list]: arr.length ? arr : undefined, cursor: undefined };
}

export const findCondition = (spec: FilterSpec, list: ListKey, field: FilterField) =>
  spec[list]?.find((c) => c.field === field);

const idsOf = (c?: Condition): string[] => (Array.isArray(c?.value) ? (c!.value as string[]) : []);

export const includedIds = (spec: FilterSpec, field: "tag" | "author") => idsOf(findCondition(spec, "all", field));
export const excludedIds = (spec: FilterSpec, field: "tag" | "author") => idsOf(findCondition(spec, "none", field));
export const tagMatchMode = (spec: FilterSpec): "any" | "all" =>
  findCondition(spec, "all", "tag")?.op === "in_all" ? "all" : "any";

/** Cycle a facet value: click → include (or remove); alt-click → exclude (or remove). */
export function toggleFacetValue(
  spec: FilterSpec,
  field: "tag" | "author",
  id: string,
  mode: "include" | "exclude",
): FilterSpec {
  const inc = includedIds(spec, field);
  const exc = excludedIds(spec, field);
  let nextInc = inc.filter((x) => x !== id);
  let nextExc = exc.filter((x) => x !== id);
  if (mode === "include" && !inc.includes(id)) nextInc = [...nextInc, id];
  if (mode === "exclude" && !exc.includes(id)) nextExc = [...nextExc, id];
  const op = field === "tag" && tagMatchMode(spec) === "all" ? "in_all" : "in";
  let s = replace(spec, "all", field, nextInc.length ? { field, op, value: nextInc } : undefined);
  s = replace(s, "none", field, nextExc.length ? { field, op: "in", value: nextExc } : undefined);
  return s;
}

export function setTagMatchMode(spec: FilterSpec, mode: "any" | "all"): FilterSpec {
  const inc = includedIds(spec, "tag");
  if (!inc.length) return spec;
  return replace(spec, "all", "tag", { field: "tag", op: mode === "all" ? "in_all" : "in", value: inc });
}

export function getDateFilter(spec: FilterSpec): { field: DateField; value: DateRangeValue } | undefined {
  const c = spec.all?.find((c) => isDateField(c.field) && c.op === "between");
  return c ? { field: c.field as DateField, value: c.value as DateRangeValue } : undefined;
}

export function setDateFilter(spec: FilterSpec, field: DateField, value?: DateRangeValue): FilterSpec {
  let s = spec;
  for (const f of DATE_FIELDS) s = replace(s, "all", f);
  return value ? replace(s, "all", field, { field, op: "between", value }) : s;
}

export function setFlag(spec: FilterSpec, field: FilterField, on: boolean, value: unknown = true): FilterSpec {
  return replace(spec, "all", field, on ? { field, op: "eq", value } : undefined);
}
export const hasFlag = (spec: FilterSpec, field: FilterField) => !!findCondition(spec, "all", field);

export function setCondition(spec: FilterSpec, cond: Condition | undefined, field: FilterField): FilterSpec {
  return replace(spec, "all", field, cond);
}

export function removeCondition(spec: FilterSpec, list: ListKey, field: FilterField): FilterSpec {
  return replace(spec, list, field);
}

export const setHistogram = (spec: FilterSpec, field: DateField, interval: Interval): FilterSpec => ({
  ...spec,
  histogram: { field, interval },
});

export const histogramField = (spec: FilterSpec, fallback: DateField = "workDate"): DateField =>
  spec.histogram?.field ?? fallback;

export const isEmptySpec = (spec: FilterSpec) =>
  !spec.q?.trim() && !spec.all?.length && !spec.any?.length && !spec.none?.length;

export const clearFilters = (spec: FilterSpec): FilterSpec => ({
  sort: spec.sort,
  view: spec.view,
  histogram: spec.histogram,
});

// ---- Search-bar operators (§W4.1): typed tokens turn into chips ----

export interface OperatorContext {
  tags: Tag[];
  people: User[];
}

/**
 * Parse `tag:calibration by:dana after:2026-03-01 before:… has:image has:annotation
 * has:comments is:question`. Returns the spec with conditions applied and the leftover text.
 * Unknown values (no such tag) are left in the text so nothing silently disappears.
 */
export function applyOperators(spec: FilterSpec, text: string, ctx: OperatorContext): { spec: FilterSpec; text: string } {
  let s = spec;
  const leftover: string[] = [];
  const tokens = text.match(/-?"[^"]*"|\S+/g) ?? [];
  for (const tok of tokens) {
    const m = /^(tag|by|after|before|has|is):(.+)$/i.exec(tok);
    if (!m) {
      leftover.push(tok);
      continue;
    }
    const [, key, raw] = m;
    const val = raw.toLowerCase();
    const k = key.toLowerCase();
    if (k === "tag") {
      const tag = ctx.tags.find((t) => t.name.toLowerCase() === val);
      if (tag && !includedIds(s, "tag").includes(tag.id)) s = toggleFacetValue(s, "tag", tag.id, "include");
      else if (!tag) leftover.push(tok);
    } else if (k === "by") {
      const person =
        ctx.people.find((u) => u.name.toLowerCase() === val) ??
        ctx.people.find((u) => u.name.toLowerCase().split(" ")[0] === val) ??
        ctx.people.find((u) => u.email.toLowerCase().startsWith(val));
      if (person && !includedIds(s, "author").includes(person.id))
        s = toggleFacetValue(s, "author", person.id, "include");
      else if (!person) leftover.push(tok);
    } else if ((k === "after" || k === "before") && /^\d{4}-\d{2}-\d{2}$/.test(val)) {
      const cur = getDateFilter(s);
      const field = cur?.field ?? histogramField(s);
      const range = cur && !("preset" in cur.value) ? cur.value : {};
      s = setDateFilter(s, field, k === "after" ? { ...range, from: val } : { ...range, to: val });
    } else if (k === "has" && ["image", "images"].includes(val)) s = setFlag(s, "hasImages", true);
    else if (k === "has" && ["annotation", "annotations"].includes(val)) s = setFlag(s, "hasAnnotations", true);
    else if (k === "has" && ["comment", "comments"].includes(val)) s = setFlag(s, "hasComments", true);
    else if (k === "is" && val === "question") s = setFlag(s, "unansweredQuestion", true);
    else leftover.push(tok);
  }
  return { spec: s, text: leftover.join(" ") };
}

// ---- Free-text query parsing (shared by the mock engine; the server does its own) ----

export interface ParsedQuery {
  terms: string[];
  phrases: string[];
  excluded: string[];
}

export function parseQuery(q: string | undefined): ParsedQuery {
  const out: ParsedQuery = { terms: [], phrases: [], excluded: [] };
  if (!q) return out;
  for (const tok of q.match(/-?"[^"]*"|\S+/g) ?? []) {
    const neg = tok.startsWith("-") && tok.length > 1;
    const body = neg ? tok.slice(1) : tok;
    const phrase = body.startsWith('"') ? body.replace(/^"|"$/g, "").trim() : null;
    if (neg) out.excluded.push((phrase ?? body).toLowerCase());
    else if (phrase) out.phrases.push(phrase.toLowerCase());
    else out.terms.push(body.toLowerCase());
  }
  return out;
}
