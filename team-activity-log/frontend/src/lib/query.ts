// Boolean search language for FilterSpec.q (owner request on top of §W4.1).
//
//   drift cooldown              implicit AND
//   drift OR noise              OR (operators are UPPERCASE, like Elasticsearch query_string)
//   NOT pump   /   -pump        exclusion
//   (drift OR noise) AND "detector B"
//   title:drift  comment:"pump schedule"  image:keV  tag:calibration  body:(gain OR offset)
//   calib*                      explicit prefix (the last word typed is always prefix-matched)
//
// The parser never throws: malformed input degrades to plain words and reports a hint.
// The server maps this AST onto an Elasticsearch bool query; the mock engine evaluates it directly.

export type QueryField = "title" | "body" | "comment" | "image" | "tag";
export const QUERY_FIELDS: QueryField[] = ["title", "body", "comment", "image", "tag"];

export type QueryNode =
  | { type: "and" | "or"; children: QueryNode[] }
  | { type: "not"; child: QueryNode }
  | { type: "term"; value: string; field?: QueryField; prefix?: boolean }
  | { type: "phrase"; value: string; field?: QueryField };

export interface ParsedBoolean {
  ast: QueryNode | null;
  errors: string[];
}

type Tok =
  | { k: "word"; v: string }
  | { k: "phrase"; v: string }
  | { k: "field"; v: QueryField }
  | { k: "and" | "or" | "not" | "minus" | "lp" | "rp" };

function tokenize(q: string, errors: string[]): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < q.length) {
    const c = q[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === "(") {
      out.push({ k: "lp" });
      i++;
      continue;
    }
    if (c === ")") {
      out.push({ k: "rp" });
      i++;
      continue;
    }
    if (c === '"') {
      const end = q.indexOf('"', i + 1);
      if (end === -1) {
        errors.push("Unclosed quote");
        out.push({ k: "phrase", v: q.slice(i + 1).trim() });
        break;
      }
      out.push({ k: "phrase", v: q.slice(i + 1, end).trim() });
      i = end + 1;
      continue;
    }
    if (c === "-" && i + 1 < q.length && !/\s/.test(q[i + 1]) && (i === 0 || /[\s(]/.test(q[i - 1]))) {
      out.push({ k: "minus" });
      i++;
      continue;
    }
    let j = i;
    while (j < q.length && !/[\s()"]/.test(q[j])) j++;
    const word = q.slice(i, j);
    i = j;
    const fm = /^([a-z]+):$/i.exec(word) ?? /^([a-z]+):(.+)$/i.exec(word);
    if (fm && (QUERY_FIELDS as string[]).includes(fm[1].toLowerCase())) {
      out.push({ k: "field", v: fm[1].toLowerCase() as QueryField });
      if (fm[2]) out.push({ k: "word", v: fm[2] });
      continue;
    }
    if (word === "AND" || word === "&&") out.push({ k: "and" });
    else if (word === "OR" || word === "||") out.push({ k: "or" });
    else if (word === "NOT") out.push({ k: "not" });
    else out.push({ k: "word", v: word });
  }
  return out;
}

export function parseBoolean(q: string | undefined): ParsedBoolean {
  const errors: string[] = [];
  const text = (q ?? "").trim();
  if (!text) return { ast: null, errors };
  const toks = tokenize(text, errors);
  let pos = 0;
  const peek = () => toks[pos];

  const parseOr = (): QueryNode | null => {
    const parts: QueryNode[] = [];
    const first = parseAnd();
    if (first) parts.push(first);
    while (peek()?.k === "or") {
      pos++;
      const next = parseAnd();
      if (next) parts.push(next);
      else errors.push("OR needs something after it");
    }
    return parts.length === 0 ? null : parts.length === 1 ? parts[0] : { type: "or", children: parts };
  };

  const parseAnd = (): QueryNode | null => {
    const parts: QueryNode[] = [];
    for (;;) {
      const t = peek();
      if (!t || t.k === "or" || t.k === "rp") break;
      if (t.k === "and") {
        pos++;
        if (!parts.length) errors.push("AND needs something before it");
        continue;
      }
      const u = parseUnary();
      if (u) parts.push(u);
    }
    return parts.length === 0 ? null : parts.length === 1 ? parts[0] : { type: "and", children: parts };
  };

  const parseUnary = (): QueryNode | null => {
    const t = peek();
    if (t?.k === "not" || t?.k === "minus") {
      pos++;
      const child = parseUnary();
      if (!child) {
        errors.push("NOT needs something after it");
        return null;
      }
      return { type: "not", child };
    }
    return parsePrimary();
  };

  const withField = (node: QueryNode, field: QueryField): QueryNode => {
    if (node.type === "term" || node.type === "phrase") return { ...node, field };
    if (node.type === "not") return { type: "not", child: withField(node.child, field) };
    return { type: node.type, children: node.children.map((c) => withField(c, field)) };
  };

  const parsePrimary = (): QueryNode | null => {
    const t = toks[pos++];
    if (!t) return null;
    if (t.k === "lp") {
      const inner = parseOr();
      if (peek()?.k === "rp") pos++;
      else errors.push("Missing )");
      return inner;
    }
    if (t.k === "rp") {
      errors.push("Unexpected )");
      return null;
    }
    if (t.k === "field") {
      const inner = parsePrimary();
      if (!inner) {
        errors.push(`${t.v}: needs a word after it`);
        return null;
      }
      return withField(inner, t.v);
    }
    if (t.k === "phrase") return t.v ? { type: "phrase", value: t.v.toLowerCase() } : null;
    if (t.k === "word") {
      const prefix = t.v.endsWith("*");
      const value = t.v.replace(/\*+$/, "").toLowerCase();
      if (!value) return null;
      return { type: "term", value, ...(prefix ? { prefix: true } : {}) };
    }
    return null;
  };

  let ast = parseOr();
  // Anything left over (e.g. a stray ")") is folded in so no typed text silently disappears.
  while (pos < toks.length) {
    if (toks[pos].k === "rp") errors.push("Unexpected )");
    pos++;
    const rest = parseOr();
    if (rest) ast = ast ? { type: "and", children: [ast, rest] } : rest;
  }
  // The last bare word is still being typed: match it as a prefix (§W4.1 "prefix as you type").
  const last = lastTerm(ast);
  if (last) last.prefix = true;
  return { ast, errors: [...new Set(errors)] };
}

function lastTerm(n: QueryNode | null): Extract<QueryNode, { type: "term" }> | null {
  if (!n) return null;
  if (n.type === "term") return n;
  if (n.type === "and" || n.type === "or") return lastTerm(n.children[n.children.length - 1]);
  return null;
}

/** Positive (non-negated) words and phrases, for highlighting. */
export function positiveNeedles(n: QueryNode | null, negated = false): string[] {
  if (!n) return [];
  if (n.type === "term" || n.type === "phrase") return negated ? [] : [n.value];
  if (n.type === "not") return positiveNeedles(n.child, !negated);
  return n.children.flatMap((c) => positiveNeedles(c, negated));
}

/** True when the query uses boolean syntax (for showing the syntax hint). */
export const usesBooleanSyntax = (q?: string) => !!q && /\b(AND|OR|NOT)\b|[()]|\b(title|body|comment|image|tag):/.test(q);

/** Back to text (normalizes spacing; used in tests and for display). */
export function printQuery(n: QueryNode | null): string {
  if (!n) return "";
  const f = (x: { field?: QueryField }) => (x.field ? `${x.field}:` : "");
  switch (n.type) {
    case "term":
      return `${f(n)}${n.value}${n.prefix ? "*" : ""}`;
    case "phrase":
      return `${f(n)}"${n.value}"`;
    case "not":
      return `NOT ${n.child.type === "and" || n.child.type === "or" ? `(${printQuery(n.child)})` : printQuery(n.child)}`;
    case "and":
      return n.children.map((c) => (c.type === "or" ? `(${printQuery(c)})` : printQuery(c))).join(" ");
    case "or":
      return n.children.map(printQuery).join(" OR ");
  }
}
