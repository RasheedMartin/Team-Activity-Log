import type { Collection, Condition, ConditionOp, DateRangeValue, FilterField, FilterGroup, ID, Tag, User } from "../../api/contract";
import { isFilterGroup } from "../../api/contract";
import { formatRange, PRESET_LABELS, resolveRange } from "../../lib/dates";
import { isDateField } from "../../lib/filterSpec";

// One catalog of filterable fields (§W4.6) drives the Add-filter menu, chips, and the
// advanced builder, so labels and value types never drift apart.

export type FieldKind = "flag" | "tags" | "people" | "date" | "text" | "number" | "imageType" | "collection" | "keyValue" | "visibility";

export interface FieldDef {
  field: FilterField;
  label: string;
  group: "Content" | "Discussion" | "People & tags" | "Dates" | "Image" | "Provenance" | "Status";
  kind: FieldKind;
  ops: ConditionOp[];
  /** Only for authors/admins (e.g. include hidden). */
  admin?: boolean;
}

export const FIELDS: FieldDef[] = [
  { field: "tag", label: "Tag", group: "People & tags", kind: "tags", ops: ["in", "in_all", "not_in"] },
  { field: "author", label: "Author", group: "People & tags", kind: "people", ops: ["in", "not_in"] },
  { field: "coAuthor", label: "Co-author", group: "People & tags", kind: "people", ops: ["in", "not_in"] },
  { field: "workDate", label: "Work date", group: "Dates", kind: "date", ops: ["between"] },
  { field: "publishedAt", label: "Published", group: "Dates", kind: "date", ops: ["between"] },
  { field: "updatedAt", label: "Updated", group: "Dates", kind: "date", ops: ["between"] },
  { field: "hasImages", label: "Has images", group: "Content", kind: "flag", ops: ["eq"] },
  { field: "hasAnnotations", label: "Has annotations", group: "Content", kind: "flag", ops: ["eq"] },
  { field: "hasComments", label: "Has comments", group: "Content", kind: "flag", ops: ["eq"] },
  { field: "unansweredQuestion", label: "Unanswered question", group: "Discussion", kind: "flag", ops: ["eq"] },
  { field: "resolved", label: "Resolved thread", group: "Discussion", kind: "flag", ops: ["eq"] },
  { field: "mine", label: "Mine", group: "Discussion", kind: "flag", ops: ["eq"] },
  { field: "iCommented", label: "I commented", group: "Discussion", kind: "flag", ops: ["eq"] },
  { field: "iReacted", label: "I reacted", group: "Discussion", kind: "flag", ops: ["eq"] },
  { field: "mentionsMe", label: "Mentions me", group: "Discussion", kind: "flag", ops: ["eq"] },
  { field: "collection", label: "In collection", group: "Provenance", kind: "collection", ops: ["in", "not_in"] },
  { field: "importedFrom", label: "Imported from file", group: "Provenance", kind: "text", ops: ["contains"] },
  { field: "workDateGuessed", label: "Date was guessed", group: "Provenance", kind: "flag", ops: ["eq"] },
  { field: "visibility", label: "Include hidden", group: "Status", kind: "visibility", ops: ["eq"], admin: true },
  { field: "image.ocrText", label: "Text in image contains", group: "Image", kind: "text", ops: ["contains"] },
  { field: "image.type", label: "Image type", group: "Image", kind: "imageType", ops: ["in", "not_in"] },
  { field: "image.figureLabel", label: "Figure label", group: "Image", kind: "text", ops: ["contains", "eq"] },
  { field: "image.filename", label: "Filename contains", group: "Image", kind: "text", ops: ["contains"] },
  { field: "image.capturedAt", label: "Photo taken", group: "Image", kind: "date", ops: ["between"] },
  { field: "image.minWidth", label: "Min width (px)", group: "Image", kind: "number", ops: ["gte"] },
  { field: "image.minHeight", label: "Min height (px)", group: "Image", kind: "number", ops: ["gte"] },
  { field: "image.custom", label: "Image field", group: "Image", kind: "keyValue", ops: ["eq"] },
  { field: "image.annotationText", label: "Annotation text contains", group: "Image", kind: "text", ops: ["contains"] },
];
export const fieldDef = (f: FilterField) => FIELDS.find((d) => d.field === f);

export const OP_LABEL: Partial<Record<ConditionOp, string>> = {
  in: "is any of",
  in_all: "is all of",
  not_in: "is none of",
  eq: "is",
  contains: "contains",
  between: "between",
  gte: "at least",
  lte: "at most",
};

export const IMAGE_TYPE_LABELS: Record<string, string> = { chart: "Chart / plot", photo: "Photo", screenshot: "Screenshot", diagram: "Diagram", table: "Table image" };

export function defaultCondition(def: FieldDef): Condition {
  switch (def.kind) {
    case "flag":
      return { field: def.field, op: "eq", value: true };
    case "visibility":
      return { field: def.field, op: "eq", value: "any" };
    case "date":
      return { field: def.field, op: "between", value: { preset: "last_30_days" } };
    case "number":
      return { field: def.field, op: "gte", value: 1000 };
    case "keyValue":
      return { field: def.field, op: "eq", value: { key: "", value: "" } };
    case "text":
      return { field: def.field, op: "contains", value: "" };
    default:
      return { field: def.field, op: def.ops[0], value: [] };
  }
}

export interface DescribeCtx {
  tags: Map<ID, Tag>;
  people: Map<ID, User>;
  collections: Map<ID, Collection>;
  meId: ID;
}

const list = (ids: string[], name: (id: string) => string) => (ids.length <= 2 ? ids.map(name).join(", ") : `${ids.slice(0, 2).map(name).join(", ")} +${ids.length - 2}`);

export function describeDate(v: DateRangeValue) {
  if ("preset" in v) return PRESET_LABELS[v.preset];
  const r = resolveRange(v);
  return formatRange(r.from, r.to);
}

/** Human label for one condition, e.g. "Tag: calibration, noise" or "Not by Dana". */
export function describeCondition(c: Condition, ctx: DescribeCtx, negated = false): string {
  const def = fieldDef(c.field);
  const label = def?.label ?? c.field;
  const ids = Array.isArray(c.value) ? (c.value as string[]) : [];
  const neg = negated || c.op === "not_in";
  switch (def?.kind) {
    case "tags":
      return `${neg ? "Not tagged" : "Tag"}${c.op === "in_all" ? " (all)" : ""}: ${list(ids, (id) => ctx.tags.get(id)?.name ?? "?")}`;
    case "people":
      return `${neg ? "Not by" : c.field === "coAuthor" ? "Co-author" : "By"} ${list(ids, (id) => (id === ctx.meId ? "me" : ctx.people.get(id)?.name.split(" ")[0] ?? "?"))}`;
    case "collection":
      return `${neg ? "Not in" : "In"} ${list(ids, (id) => ctx.collections.get(id)?.name ?? "collection")}`;
    case "imageType":
      return `${neg ? "No" : "Has"} ${list(ids, (t) => IMAGE_TYPE_LABELS[t] ?? t)}`;
    case "date":
      return `${label}: ${describeDate(c.value as DateRangeValue)}`;
    case "flag":
      return neg || c.value === false ? `Not: ${label.toLowerCase()}` : label;
    case "visibility":
      return c.value === "hidden" ? "Hidden only" : "Including hidden";
    case "number":
      return `${label.replace(" (px)", "")} ≥ ${c.value}px`;
    case "keyValue": {
      const kv = (c.value ?? {}) as { key?: string; value?: string };
      return `Image ${kv.key || "field"}${kv.value ? ` = ${kv.value}` : " is set"}`;
    }
    default:
      return `${negated ? "Not " : ""}${label}${c.op === "eq" ? " is" : ""} “${String(c.value ?? "")}”`;
  }
}

export function describeGroup(g: FilterGroup, ctx: DescribeCtx): string {
  const parts = g.items.map((x) => (isFilterGroup(x) ? `(${describeGroup(x, ctx)})` : describeCondition(x, ctx)));
  if (g.op === "not") return `NOT (${parts.join(" OR ")})`;
  return parts.join(g.op === "and" ? " AND " : " OR ");
}

export const isDateCondition = (c: Condition) => isDateField(c.field) && c.op === "between";

/** A condition is complete enough to apply. */
export function isComplete(c: Condition): boolean {
  if (Array.isArray(c.value)) return c.value.length > 0;
  if (typeof c.value === "string") return c.value.trim().length > 0;
  if (c.value && typeof c.value === "object" && "key" in (c.value as object)) return !!(c.value as { key?: string }).key;
  return c.value !== undefined && c.value !== null;
}
