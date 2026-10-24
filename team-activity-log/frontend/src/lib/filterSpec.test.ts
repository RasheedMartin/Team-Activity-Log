import { describe, expect, it } from "vitest";
import type { Tag, User } from "../api/contract";
import {
  applyOperators,
  excludedIds,
  fromSearchParams,
  getDateFilter,
  includedIds,
  parseQuery,
  setTagMatchMode,
  toSearchParams,
  toggleFacetValue,
} from "./filterSpec";
import { autoInterval, bucketStart, resolveRange } from "./dates";

const tags: Tag[] = [{ id: "t1", name: "calibration", color: "#000" }];
const people: User[] = [{ id: "u1", name: "Dana Okafor", email: "dana.okafor@lab.example" }];

describe("FilterSpec URL state (§W4.8)", () => {
  it("round-trips through the URL", () => {
    let spec = toggleFacetValue({ q: "drift", view: "gallery", sort: "oldest" }, "tag", "t1", "include");
    spec = toggleFacetValue(spec, "author", "u1", "exclude");
    spec = { ...spec, histogram: { field: "publishedAt", interval: "month" } };
    const back = fromSearchParams(toSearchParams(spec));
    expect(back).toEqual(spec);
  });
  it("drops defaults and transport-only fields", () => {
    const p = toSearchParams({ q: "", sort: "newest", view: "posts", cursor: "abc", limit: 5 });
    expect(p.toString()).toBe("");
  });
  it("ignores a corrupted filter param but keeps the query", () => {
    expect(fromSearchParams(new URLSearchParams("q=x&f=%7Bbroken"))).toEqual({ q: "x" });
  });
});

describe("facet toggling", () => {
  it("include, exclude, and remove", () => {
    let s = toggleFacetValue({}, "tag", "a", "include");
    expect(includedIds(s, "tag")).toEqual(["a"]);
    s = toggleFacetValue(s, "tag", "a", "exclude");
    expect(includedIds(s, "tag")).toEqual([]);
    expect(excludedIds(s, "tag")).toEqual(["a"]);
    s = toggleFacetValue(s, "tag", "a", "exclude");
    expect(s.none).toBeUndefined();
  });
  it("match-all switches the operator", () => {
    const s = setTagMatchMode(toggleFacetValue({}, "tag", "a", "include"), "all");
    expect(s.all?.[0].op).toBe("in_all");
  });
});

describe("search operators (§W4.1)", () => {
  it("turns known operators into conditions and leaves the rest as text", () => {
    const { spec, text } = applyOperators({}, "drift tag:calibration by:dana after:2026-03-01 has:image is:question tag:nope", { tags, people });
    expect(text).toBe("drift tag:nope");
    expect(includedIds(spec, "tag")).toEqual(["t1"]);
    expect(includedIds(spec, "author")).toEqual(["u1"]);
    expect(getDateFilter(spec)?.value).toEqual({ from: "2026-03-01" });
    expect(spec.all?.map((c) => c.field)).toEqual(expect.arrayContaining(["hasImages", "unansweredQuestion"]));
  });
  it("parses phrases and exclusions", () => {
    expect(parseQuery('gain "no drift" -cryostat')).toEqual({ terms: ["gain"], phrases: ["no drift"], excluded: ["cryostat"] });
  });
});

describe("dates", () => {
  it("auto interval thresholds", () => {
    expect(autoInterval("2026-01-01", "2026-03-01")).toBe("day");
    expect(autoInterval("2026-01-01", "2026-12-31")).toBe("week");
    expect(autoInterval("2023-01-01", "2026-12-31")).toBe("month");
    expect(autoInterval("2018-01-01", "2026-12-31")).toBe("quarter");
    expect(autoInterval("2000-01-01", "2026-12-31")).toBe("year");
  });
  it("calendar buckets", () => {
    expect(bucketStart(new Date("2026-10-23T00:00:00Z"), "week").toISOString().slice(0, 10)).toBe("2026-10-19");
    expect(bucketStart(new Date("2026-11-23T00:00:00Z"), "quarter").toISOString().slice(0, 10)).toBe("2026-10-01");
  });
  it("relative presets resolve against now", () => {
    expect(resolveRange({ preset: "last_7_days" }, new Date("2026-10-23T12:00:00Z"))).toEqual({ from: "2026-10-17", to: "2026-10-23" });
  });
});
