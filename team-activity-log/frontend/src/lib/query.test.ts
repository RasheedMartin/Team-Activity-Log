import { describe, expect, it } from "vitest";
import { parseBoolean, positiveNeedles, printQuery } from "./query";

const p = (q: string) => printQuery(parseBoolean(q).ast);

describe("boolean query parser", () => {
  it("implicit AND, last word is a prefix", () => {
    expect(p("drift cooldown")).toBe("drift cooldown*");
  });
  it("OR binds looser than AND", () => {
    expect(p("drift noise OR pump")).toBe("drift noise OR pump*");
    expect(parseBoolean("a b OR c").ast).toMatchObject({ type: "or", children: [{ type: "and" }, { type: "term", value: "c" }] });
  });
  it("NOT and minus (excluded words are never prefix-expanded)", () => {
    expect(p("drift NOT pump")).toBe("drift NOT pump");
    expect(p("drift -pump")).toBe("drift NOT pump");
    expect(p("signal-to-noise")).toBe("signal-to-noise*");
  });
  it("parentheses and phrases", () => {
    expect(p('(drift OR noise) AND "detector b"')).toBe('(drift OR noise) "detector b"');
  });
  it("field scopes apply to groups", () => {
    expect(p("title:drift comment:(pump OR valve)")).toBe("title:drift (comment:pump OR comment:valve*)");
    expect(p('image:"energy (kev)"')).toBe('image:"energy (kev)"');
  });
  it("explicit prefix with *", () => {
    expect(parseBoolean("calib* run").ast).toMatchObject({ type: "and", children: [{ value: "calib", prefix: true }, { value: "run" }] });
  });
  it("lowercase and/or are words, not operators", () => {
    expect(p("salt and pepper")).toBe("salt and pepper*");
  });
  it("never throws on malformed input and reports hints", () => {
    const r = parseBoolean('(drift OR "unclosed');
    expect(r.ast).not.toBeNull();
    expect(r.errors).toEqual(expect.arrayContaining(["Unclosed quote", "Missing )"]));
    expect(parseBoolean("drift )").errors).toContain("Unexpected )");
    expect(parseBoolean("OR").ast).toBeNull();
    expect(parseBoolean("").ast).toBeNull();
  });
  it("collects positive needles for highlighting", () => {
    expect(positiveNeedles(parseBoolean('drift -pump "detector b" NOT (valve OR leak)').ast)).toEqual(["drift", "detector b"]);
  });
});
