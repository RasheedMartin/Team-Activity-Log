import { http, HttpResponse } from "msw";
import type { SheetCell, SheetChartSpec, SheetColumn, SheetColumnOp, SheetRowOp } from "../../api/contract";
import { uuidv7 } from "../../lib/ids";
import { db, type SheetRow, type SheetTabRow } from "../db";
import { fail, roleAtLeast, route, workspaceCtx, type OrgCtx } from "../server";
import { asText, coerce, infer, MAX_ROWS, parseSheet, searchText, SheetError, TYPE_WORD, type ParsedTab } from "../sheets";

// Mirrors backend/src/tal/routes/sheets.py: import or start a sheet, browse and edit its tabs, save
// charts that posts embed. Everyone in the workspace can view; the creator and admins edit (or
// everyone, when editing is opened to the workspace); the creator or an admin can delete.

const MAX_BYTES = 25 * 1024 * 1024;
const CHART_TYPES = new Set(["line", "column", "bar", "area", "scatter", "pie"]);
const AGGS = new Set(["sum", "avg", "count", "min", "max", "none"]);
const TYPES = new Set(["number", "date", "category", "text"]);
const now = () => new Date().toISOString();
const isAdmin = (ctx: OrgCtx) => roleAtLeast(ctx.role, "admin");
const idx = (key: string) => Number(key.slice(1));
const canEdit = (s: SheetRow, ctx: OrgCtx) => s.createdBy === ctx.user.id || isAdmin(ctx) || (s.editAccess === "workspace" && ctx.role !== "viewer");

/** A tab with row ids and a next column key (older mock rows get them on first read). */
function tabOf(id: string): SheetTabRow | undefined {
  const t = db.t.sheetTabs.get(id);
  if (!t || (t.rowIds && t.nextCol !== undefined)) return t;
  return db.t.sheetTabs.update(t.id, { rowIds: t.rows.map((_, i) => i + 1), nextCol: t.columns.length });
}
const tabsOf = (id: string) =>
  db.t.sheetTabs
    .filter((t) => t.sheetId === id)
    .sort((a, b) => a.position - b.position)
    .map((t) => tabOf(t.id)!);
const summary = (s: SheetRow, tabs: SheetTabRow[]) => ({ id: s.id, workspaceId: s.workspaceId, name: s.name, ...(s.filename ? { filename: s.filename } : {}), bytes: s.bytes, createdBy: s.createdBy, updatedAt: s.updatedAt, tabs: tabs.length, rows: tabs.reduce((n, t) => n + t.rowCount, 0) });
const chartView = ({ id, sheetId, tabId, name, spec }: { id: string; sheetId: string; tabId: string; name: string; spec: SheetChartSpec }) => ({ id, sheetId, tabId, name, spec });
const tabView = (t: SheetTabRow) => ({ id: t.id, name: t.name, columns: t.columns, rowCount: t.rowCount, truncated: t.truncated });

function sheetCtx(cookies: Record<string, string>, org: string, id: string) {
  const s = db.t.sheets.get(id) ?? fail(404, "not_found", "Sheet not found");
  const ctx = workspaceCtx(cookies, org, s.workspaceId); // 404s unless the person can open the workspace
  if (s.orgId !== ctx.org.id) fail(404, "not_found", "Sheet not found");
  return { s, ctx };
}
function editable(cookies: Record<string, string>, org: string, id: string) {
  const r = sheetCtx(cookies, org, id);
  if (!canEdit(r.s, r.ctx)) fail(403, "forbidden", "Only the sheet's creator or an admin can change it (they can let everyone edit)");
  return r;
}
function tabIn(s: SheetRow, tabId: string) {
  const t = tabOf(tabId);
  if (!t || t.sheetId !== s.id) fail(404, "not_found", "Tab not found");
  return t!;
}

function detail(s: SheetRow, ctx: OrgCtx) {
  const tabs = tabsOf(s.id);
  return {
    ...summary(s, tabs),
    canDelete: s.createdBy === ctx.user.id || isAdmin(ctx),
    canEdit: canEdit(s, ctx),
    editAccess: s.editAccess ?? "owner",
    hasOriginal: !!s.blob,
    ...(s.updatedBy ? { updatedBy: s.updatedBy } : {}),
    tabList: tabs.map(tabView),
    charts: db.t.sheetCharts.filter((c) => c.sheetId === s.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map(chartView),
  };
}

function spec(value: unknown, columns: SheetColumn[]): SheetChartSpec {
  if (!value || typeof value !== "object") fail(422, "invalid", "A chart needs a type, an X column, and at least one Y column");
  const v = value as Record<string, unknown>;
  const keys = new Set(columns.map((c) => c.key));
  const type = (CHART_TYPES.has(v.type as string) ? v.type : "line") as SheetChartSpec["type"];
  const x = keys.has(v.x as string) ? (v.x as string) : "";
  const y = Array.isArray(v.y) ? (v.y as string[]).filter((k) => keys.has(k)).slice(0, 8) : [];
  const agg = (AGGS.has(v.agg as string) ? v.agg : "none") as SheetChartSpec["agg"];
  if (!x || (!y.length && agg !== "count")) fail(422, "invalid", "Choose an X column and at least one Y column");
  const groupBy = keys.has(v.groupBy as string) ? (v.groupBy as string) : undefined;
  return { type, x, y, agg, ...(groupBy ? { groupBy } : {}) };
}

const chartName = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 300) : fail(422, "invalid", "Chart name is required"));
const sha256 = async (blob: Blob) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer())), (b) => b.toString(16).padStart(2, "0")).join("");

/** Search text: tab and column names plus distinct cell text, from what's stored now. */
function refreshSearch(s: SheetRow) {
  const tabs = tabsOf(s.id).map((t) => ({ name: t.name, columns: t.columns, rows: t.rows, truncated: t.truncated }));
  db.t.sheets.update(s.id, { searchText: searchText(tabs) });
}
const touch = (s: SheetRow, ctx: OrgCtx) => db.t.sheets.update(s.id, { updatedAt: now(), updatedBy: ctx.user.id });

function addTabs(s: SheetRow, tabs: ParsedTab[], first = 0) {
  tabs.forEach((tab, i) => db.t.sheetTabs.put({ id: uuidv7(), sheetId: s.id, position: first + i, name: tab.name.slice(0, 300), columns: tab.columns, rows: tab.rows, rowIds: tab.rows.map((_, j) => j + 1), nextCol: tab.columns.length, rowCount: tab.rows.length, truncated: tab.truncated }));
}

async function parseUpload(request: Request) {
  const fname = (new URL(request.url).searchParams.get("filename") ?? "").replace(/[\\/]/g, "_").replace(/\p{Cc}/gu, "_").trim().slice(0, 255) || "sheet.csv";
  const blob = await request.blob();
  if (blob.size > MAX_BYTES) fail(413, "too_large", "Spreadsheets must be under 25 MB");
  try {
    return { fname, blob, tabs: await parseSheet(blob, fname) };
  } catch (e) {
    return fail(422, "unreadable", e instanceof SheetError ? e.message : "This file couldn't be read");
  }
}

// ---- edits (routes/sheets.py: edit_rows, edit_columns)

const pad = (cells: SheetCell[], width: number) => Array.from({ length: width }, (_, i) => cells[i] ?? null);

function cellFor(col: SheetColumn, value: SheetCell | undefined): SheetCell {
  if (col.auto) return asText(value ?? null); // stored as typed; autoTypes settles the column's type
  const [ok, v] = coerce(value, col.type);
  if (!ok) fail(422, "invalid", `“${asText(value ?? null)}” isn't ${TYPE_WORD[col.type]}: ${col.name} holds ${col.type}s. Change the column's type to put text in it.`);
  return v;
}

/** Rewrite one column's cells as `kind`; returns the new rows. */
function retype(rows: SheetCell[][], key: string, kind: SheetColumn["type"]) {
  const i = idx(key);
  return rows.map((r) => {
    const [, v] = coerce(r[i], kind);
    if (v === (r[i] ?? null)) return r;
    const next = [...r];
    next[i] = v;
    return next;
  });
}

export const sheetHandlers = [
  http.get(
    "/v1/orgs/:org/workspaces/:ws/sheets",
    route(({ cookies, params, request }) => {
      const ctx = workspaceCtx(cookies, params.org as string, params.ws as string);
      const q = (new URL(request.url).searchParams.get("q") ?? "").trim().toLowerCase();
      const sheets = db.t.sheets
        .filter((s) => s.workspaceId === ctx.ws.id && (!q || s.name.toLowerCase().includes(q) || s.searchText.toLowerCase().includes(q)))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, 200);
      return HttpResponse.json(sheets.map((s) => summary(s, tabsOf(s.id))));
    }),
  ),
  http.post(
    "/v1/orgs/:org/workspaces/:ws/sheets",
    route(async ({ cookies, params, request }) => {
      const ctx = workspaceCtx(cookies, params.org as string, params.ws as string, "member");
      const { fname, blob, tabs } = await parseUpload(request);
      const t = now();
      const s = db.t.sheets.put({
        id: uuidv7(), orgId: ctx.org.id, workspaceId: ctx.ws.id, name: (new URL(request.url).searchParams.get("name")?.trim() || fname.replace(/\.(xlsx|csv|tsv|txt)$/i, "")).slice(0, 300),
        filename: fname, sha256: await sha256(blob), bytes: blob.size, searchText: searchText(tabs), createdBy: ctx.user.id, createdAt: t, updatedAt: t, blob, editAccess: "owner",
      });
      addTabs(s, tabs);
      return HttpResponse.json(detail(s, ctx), { status: 201 });
    }),
  ),
  http.post(
    "/v1/orgs/:org/workspaces/:ws/sheets/blank",
    route(async ({ cookies, params, request }) => {
      const ctx = workspaceCtx(cookies, params.org as string, params.ws as string, "member");
      const { name } = (await request.json()) as { name?: string };
      if (!name?.trim()) fail(422, "invalid", "Name is required");
      const t = now();
      const s = db.t.sheets.put({ id: uuidv7(), orgId: ctx.org.id, workspaceId: ctx.ws.id, name: name!.trim().slice(0, 300), filename: "", sha256: "", bytes: 0, searchText: "", createdBy: ctx.user.id, createdAt: t, updatedAt: t, editAccess: "owner" });
      const columns: SheetColumn[] = [0, 1, 2].map((i) => ({ key: `c${i}`, name: `Column ${i + 1}`, type: "text", auto: true }));
      addTabs(s, [{ name: "Sheet 1", columns, rows: Array.from({ length: 5 }, () => [null, null, null]), truncated: false }]);
      return HttpResponse.json(detail(s, ctx), { status: 201 });
    }),
  ),
  http.get(
    "/v1/orgs/:org/sheets/:id",
    route(({ cookies, params }) => {
      const { s, ctx } = sheetCtx(cookies, params.org as string, params.id as string);
      return HttpResponse.json(detail(s, ctx));
    }),
  ),
  http.patch(
    "/v1/orgs/:org/sheets/:id",
    route(async ({ cookies, params, request }) => {
      const { s, ctx } = editable(cookies, params.org as string, params.id as string);
      const body = (await request.json()) as { name?: string; editAccess?: string };
      if ("name" in body) {
        if (!body.name?.trim()) fail(422, "invalid", "Name is required");
        db.t.sheets.update(s.id, { name: body.name!.trim().slice(0, 300) });
      }
      if ("editAccess" in body) {
        if (s.createdBy !== ctx.user.id && !isAdmin(ctx)) fail(403, "forbidden", "Only the sheet's creator or an admin can change who edits it");
        if (body.editAccess !== "owner" && body.editAccess !== "workspace") fail(422, "invalid", "editAccess is owner or workspace");
        db.t.sheets.update(s.id, { editAccess: body.editAccess as "owner" | "workspace" });
      }
      touch(s, ctx);
      return HttpResponse.json(detail(db.t.sheets.get(s.id)!, ctx));
    }),
  ),
  http.get(
    "/v1/orgs/:org/sheets/:id/tabs/:tab/rows",
    route(({ cookies, params }) => {
      const { s } = sheetCtx(cookies, params.org as string, params.id as string);
      const tab = tabIn(s, params.tab as string);
      return HttpResponse.json({ columns: tab.columns, ids: tab.rowIds, rows: tab.rows.map((r) => pad(r, tab.nextCol!)) });
    }),
  ),
  http.patch(
    "/v1/orgs/:org/sheets/:id/tabs/:tab/rows",
    route(async ({ cookies, params, request }) => {
      const { s, ctx } = editable(cookies, params.org as string, params.id as string);
      const tab = tabIn(s, params.tab as string);
      const { ops } = (await request.json()) as { ops?: SheetRowOp[] };
      if (!Array.isArray(ops) || !ops.length || ops.length > 2000) fail(422, "invalid", "Send 1 to 2000 edits");
      const cols = new Map(tab.columns.map((c) => [c.key, c]));
      const width = tab.nextCol!;
      const ids = [...tab.rowIds!];
      let rows = tab.rows.map((r) => pad(r, width));
      let nextId = Math.max(0, ...ids) + 1;
      const changed = new Set<number>();
      const inserted: { id: number; after: number | null }[] = [];
      const deleted: number[] = [];
      const touched = new Set<string>();
      const gone = () => fail(409, "gone", "That row was deleted (maybe by someone else). Reload to see the latest.");
      for (const op of ops!) {
        if (op.op === "set") {
          const i = ids.indexOf(op.id);
          if (i < 0) gone();
          const col = cols.get(op.col) ?? fail(422, "invalid", "No such column");
          rows[i] = [...rows[i]];
          rows[i][idx(col.key)] = cellFor(col, op.value);
          changed.add(op.id);
          touched.add(col.key);
        } else if (op.op === "insert") {
          if (ids.length >= MAX_ROWS) fail(422, "too_many", `A tab holds up to ${MAX_ROWS.toLocaleString()} rows`);
          const cells: SheetCell[] = Array(width).fill(null);
          for (const [k, v] of Object.entries(op.cells ?? {})) {
            const col = cols.get(k);
            if (col) {
              cells[idx(k)] = cellFor(col, v);
              touched.add(k);
            }
          }
          let where = ids.length;
          if (op.first) where = 0;
          else if (op.after !== undefined) {
            const a = ids.indexOf(op.after);
            if (a < 0) gone();
            where = a + 1;
          }
          const id = nextId++;
          ids.splice(where, 0, id);
          rows.splice(where, 0, cells);
          inserted.push({ id, after: null }); // set from the final order below
        } else if (op.op === "delete") {
          for (const id of op.ids) {
            const i = ids.indexOf(id);
            if (i < 0) continue;
            ids.splice(i, 1);
            rows.splice(i, 1);
            changed.delete(id);
            deleted.push(id);
          }
        } else fail(422, "invalid", "Edits are set, insert, or delete");
      }
      // Columns that follow what's typed into them take the type their values now fit.
      let columns = tab.columns;
      let retyped = false;
      for (const c of columns.filter((c) => touched.has(c.key) && c.auto)) {
        const kind = infer(rows.map((r) => asText(r[idx(c.key)])));
        if (kind !== c.type) {
          rows = retype(rows, c.key, kind);
          columns = columns.map((x) => (x.key === c.key ? { ...x, type: kind } : x));
          retyped = true;
        }
      }
      db.t.sheetTabs.update(tab.id, { rows, rowIds: ids, columns, rowCount: rows.length });
      touch(s, ctx);
      refreshSearch(s);
      const at = new Map(ids.map((id, i) => [id, i]));
      return HttpResponse.json({
        rows: [...changed].filter((id) => at.has(id)).map((id) => ({ id, cells: rows[at.get(id)!] })),
        inserted: inserted.filter((x) => at.has(x.id)).map((x) => ({ id: x.id, after: at.get(x.id)! > 0 ? ids[at.get(x.id)! - 1] : null, cells: rows[at.get(x.id)!] })),
        deleted,
        columns,
        rowCount: rows.length,
        retyped,
      });
    }),
  ),
  http.patch(
    "/v1/orgs/:org/sheets/:id/tabs/:tab/columns",
    route(async ({ cookies, params, request }) => {
      const { s, ctx } = editable(cookies, params.org as string, params.id as string);
      const tab = tabIn(s, params.tab as string);
      const { ops } = (await request.json()) as { ops?: SheetColumnOp[] };
      let cols = tab.columns.map((c) => ({ ...c }));
      let rows = tab.rows;
      let nextCol = tab.nextCol!;
      for (const op of ops ?? []) {
        const col = op.op === "add" ? undefined : cols.find((c) => c.key === op.key);
        if (op.op !== "add" && !col) fail(404, "not_found", "No such column");
        if (op.op === "add" || op.op === "rename") {
          let name = (op.name ?? "").trim().slice(0, 200);
          if (op.op === "add" && !name) {
            let n = cols.length + 1;
            while (cols.some((c) => c.name.toLowerCase() === `column ${n}`)) n++;
            name = `Column ${n}`;
          }
          if (!name) fail(422, "invalid", "Name the column");
          if (cols.some((c) => c.name.toLowerCase() === name.toLowerCase() && c !== col)) fail(422, "invalid", `There's already a column called “${name}”`);
          if (op.op === "rename") col!.name = name;
          else {
            const at = cols.findIndex((c) => c.key === op.after);
            cols.splice(at < 0 ? cols.length : at + 1, 0, { key: `c${nextCol++}`, name, type: "text", auto: true });
          }
        } else if (op.op === "delete") {
          if (cols.length === 1) fail(422, "invalid", "A tab needs at least one column");
          const used = db.t.sheetCharts.filter((c) => c.tabId === tab.id && [c.spec.x, c.spec.groupBy, ...c.spec.y].includes(col!.key)).map((c) => c.name);
          if (used.length) fail(409, "in_use", `${col!.name} is used by ${used.map((n) => `“${n}”`).join(", ")}. Change or delete ${used.length === 1 ? "that chart" : "those charts"} first.`);
          cols = cols.filter((c) => c !== col);
          rows = rows.map((r) => (r[idx(col!.key)] == null ? r : Object.assign([...r], { [idx(col!.key)]: null })));
        } else if (op.op === "type") {
          if (!TYPES.has(op.type)) fail(422, "invalid", "A column holds numbers, dates, categories, or text");
          rows.forEach((r, n) => {
            if (!coerce(r[idx(col!.key)], op.type)[0]) fail(422, "invalid", `Row ${n + 1} has “${asText(r[idx(col!.key)])}”, which isn't ${TYPE_WORD[op.type]}. Fix it first, or keep ${col!.name} as text.`);
          });
          rows = retype(rows, col!.key, op.type);
          col!.type = op.type;
          delete col!.auto; // chosen now, not inferred
        } else fail(422, "invalid", "Column edits are add, rename, delete, or type");
      }
      const t = db.t.sheetTabs.update(tab.id, { columns: cols, rows, nextCol })!;
      touch(s, ctx);
      refreshSearch(s);
      return HttpResponse.json(tabView(t));
    }),
  ),
  http.post(
    "/v1/orgs/:org/sheets/:id/replace",
    route(async ({ cookies, params, request }) => {
      const { s, ctx } = editable(cookies, params.org as string, params.id as string);
      const { fname, blob, tabs } = await parseUpload(request);
      const current = tabsOf(s.id);
      const old = new Map(current.map((t) => [t.name.toLowerCase(), t]));
      // A CSV has no tab names: it's a new version of the open tab (else the first); the others stay.
      const oneTab = /\.(csv|tsv|txt)$/i.test(fname);
      if (oneTab && current.length) tabs[0].name = (old.get((new URL(request.url).searchParams.get("tab") ?? "").toLowerCase()) ?? current[0]).name;
      const keep = new Set<string>(oneTab ? current.map((t) => t.id) : []);
      tabs.forEach((nt, i) => {
        const t = old.get(nt.name.toLowerCase());
        if (!t) return addTabs(s, [nt], i);
        keep.add(t.id);
        const byName = new Map(t.columns.map((c) => [c.name.toLowerCase(), c.key]));
        let nextCol = t.nextCol!;
        const keys = nt.columns.map((c) => {
          const k = byName.get(c.name.toLowerCase());
          byName.delete(c.name.toLowerCase());
          return k ?? `c${nextCol++}`;
        });
        const rows = nt.rows.map((r) => {
          const cells: SheetCell[] = Array(nextCol).fill(null);
          r.forEach((v, j) => (cells[idx(keys[j])] = v));
          return cells;
        });
        db.t.sheetTabs.update(t.id, { position: oneTab ? t.position : i, name: nt.name, columns: nt.columns.map((c, j) => ({ ...c, key: keys[j] })), rows, rowIds: rows.map((_, j) => j + 1), nextCol, rowCount: rows.length, truncated: nt.truncated });
      });
      let removedCharts = 0;
      for (const t of old.values()) {
        if (keep.has(t.id)) continue;
        for (const c of db.t.sheetCharts.filter((c) => c.tabId === t.id)) {
          db.t.sheetCharts.delete(c.id);
          removedCharts++;
        }
        db.t.sheetTabs.delete(t.id);
      }
      const brokenCharts = db.t.sheetCharts
        .filter((c) => c.sheetId === s.id)
        .filter((c) => {
          const keys = new Set(db.t.sheetTabs.get(c.tabId)?.columns.map((x) => x.key));
          return ![c.spec.x, ...c.spec.y, ...(c.spec.groupBy ? [c.spec.groupBy] : [])].every((k) => keys.has(k));
        })
        .map((c) => c.name);
      db.t.sheets.update(s.id, { filename: fname, sha256: await sha256(blob), bytes: blob.size, blob });
      touch(s, ctx);
      refreshSearch(s);
      return HttpResponse.json({ ...detail(db.t.sheets.get(s.id)!, ctx), removedCharts, brokenCharts });
    }),
  ),
  http.get(
    "/v1/orgs/:org/sheets/:id/original",
    route(({ cookies, params }) => {
      const { s } = sheetCtx(cookies, params.org as string, params.id as string);
      if (!s.blob) fail(404, "not_found", "There's no original file: this sheet was made in the app. Download it as CSV instead.");
      return new HttpResponse(s.blob, { headers: { "Content-Type": s.blob!.type || "application/octet-stream", "Content-Disposition": `attachment; filename="${(s.filename ?? "sheet").replace(/"/g, "")}"` } });
    }),
  ),
  http.post(
    "/v1/orgs/:org/sheets/:id/charts",
    route(async ({ cookies, params, request }) => {
      const { s, ctx } = sheetCtx(cookies, params.org as string, params.id as string);
      if (ctx.role === "viewer") fail(403, "forbidden", "Viewers can't save charts");
      const body = (await request.json()) as Record<string, unknown>;
      const tab = tabOf(body.tabId as string);
      if (!tab || tab.sheetId !== s.id) fail(422, "invalid", "Choose a tab");
      const c = db.t.sheetCharts.put({ id: uuidv7(), sheetId: s.id, tabId: tab!.id, name: chartName(body.name), spec: spec(body.spec, tab!.columns), createdBy: ctx.user.id, createdAt: now() });
      db.t.sheets.update(s.id, { updatedAt: now() });
      return HttpResponse.json(chartView(c), { status: 201 });
    }),
  ),
  http.patch(
    "/v1/orgs/:org/sheets/:id/charts/:chart",
    route(async ({ cookies, params, request }) => {
      const { s, ctx } = sheetCtx(cookies, params.org as string, params.id as string);
      const c = db.t.sheetCharts.get(params.chart as string);
      if (!c || c.sheetId !== s.id) fail(404, "not_found", "Chart not found");
      if (c!.createdBy !== ctx.user.id && !isAdmin(ctx)) fail(403, "forbidden", "Only the chart's author or an admin can change it");
      const body = (await request.json()) as Record<string, unknown>;
      const patch = { ...("name" in body ? { name: chartName(body.name) } : {}), ...("spec" in body ? { spec: spec(body.spec, db.t.sheetTabs.get(c!.tabId)?.columns ?? []) } : {}) };
      return HttpResponse.json(chartView(db.t.sheetCharts.update(c!.id, patch)!));
    }),
  ),
  http.delete(
    "/v1/orgs/:org/sheets/:id/charts/:chart",
    route(({ cookies, params }) => {
      const { s, ctx } = sheetCtx(cookies, params.org as string, params.id as string);
      const c = db.t.sheetCharts.get(params.chart as string);
      if (!c || c.sheetId !== s.id) fail(404, "not_found", "Chart not found");
      if (c!.createdBy !== ctx.user.id && !isAdmin(ctx)) fail(403, "forbidden", "Only the chart's author or an admin can delete it");
      db.t.sheetCharts.delete(c!.id);
      return new HttpResponse(null, { status: 204 });
    }),
  ),
  http.delete(
    "/v1/orgs/:org/sheets/:id",
    route(({ cookies, params }) => {
      const { s, ctx } = sheetCtx(cookies, params.org as string, params.id as string);
      if (s.createdBy !== ctx.user.id && !isAdmin(ctx)) fail(403, "forbidden", "Only the sheet's creator or an admin can delete it");
      for (const t of tabsOf(s.id)) db.t.sheetTabs.delete(t.id);
      for (const c of db.t.sheetCharts.filter((c) => c.sheetId === s.id)) db.t.sheetCharts.delete(c.id);
      db.t.sheets.delete(s.id); // embedded charts show "no longer available"
      return new HttpResponse(null, { status: 204 });
    }),
  ),
];
