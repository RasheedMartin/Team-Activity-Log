import { http, HttpResponse } from "msw";
import type { SheetChartSpec, SheetColumn } from "../../api/contract";
import { uuidv7 } from "../../lib/ids";
import { db, type SheetRow, type SheetTabRow } from "../db";
import { fail, roleAtLeast, route, workspaceCtx, type OrgCtx } from "../server";
import { parseSheet, searchText, SheetError } from "../sheets";

// Mirrors backend/src/tal/routes/sheets.py: import a spreadsheet, browse its tabs, save charts that
// posts embed. Everyone in the workspace can view; the creator (or an admin) can delete.

const MAX_BYTES = 25 * 1024 * 1024;
const CHART_TYPES = new Set(["line", "column", "bar", "area", "scatter", "pie"]);
const AGGS = new Set(["sum", "avg", "count", "min", "max", "none"]);
const now = () => new Date().toISOString();
const isAdmin = (ctx: OrgCtx) => roleAtLeast(ctx.role, "admin");

const tabsOf = (id: string) => db.t.sheetTabs.filter((t) => t.sheetId === id).sort((a, b) => a.position - b.position);
const summary = (s: SheetRow, tabs: SheetTabRow[]) => ({ id: s.id, workspaceId: s.workspaceId, name: s.name, filename: s.filename, bytes: s.bytes, createdBy: s.createdBy, updatedAt: s.updatedAt, tabs: tabs.length, rows: tabs.reduce((n, t) => n + t.rowCount, 0) });
const chartView = ({ id, sheetId, tabId, name, spec }: { id: string; sheetId: string; tabId: string; name: string; spec: SheetChartSpec }) => ({ id, sheetId, tabId, name, spec });

function sheetCtx(cookies: Record<string, string>, org: string, id: string) {
  const s = db.t.sheets.get(id) ?? fail(404, "not_found", "Sheet not found");
  const ctx = workspaceCtx(cookies, org, s.workspaceId); // 404s unless the person can open the workspace
  if (s.orgId !== ctx.org.id) fail(404, "not_found", "Sheet not found");
  return { s, ctx };
}

function detail(s: SheetRow, ctx: OrgCtx) {
  const tabs = tabsOf(s.id);
  return {
    ...summary(s, tabs),
    canDelete: s.createdBy === ctx.user.id || isAdmin(ctx),
    tabList: tabs.map((t) => ({ id: t.id, name: t.name, columns: t.columns, rowCount: t.rowCount, truncated: t.truncated })),
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
      const url = new URL(request.url);
      const fname = (url.searchParams.get("filename") ?? "").replace(/[\\/]/g, "_").replace(/\p{Cc}/gu, "_").trim().slice(0, 255) || "sheet.csv";
      const blob = await request.blob();
      if (blob.size > MAX_BYTES) fail(413, "too_large", "Spreadsheets must be under 25 MB");
      let tabs;
      try {
        tabs = await parseSheet(blob, fname);
      } catch (e) {
        return fail(422, "unreadable", e instanceof SheetError ? e.message : "This file couldn't be read");
      }
      const sha = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer())), (b) => b.toString(16).padStart(2, "0")).join("");
      const t = now();
      const s = db.t.sheets.put({
        id: uuidv7(), orgId: ctx.org.id, workspaceId: ctx.ws.id, name: (url.searchParams.get("name")?.trim() || fname.replace(/\.(xlsx|csv|tsv|txt)$/i, "")).slice(0, 300),
        filename: fname, sha256: sha, bytes: blob.size, searchText: searchText(tabs), createdBy: ctx.user.id, createdAt: t, updatedAt: t, blob,
      });
      tabs.forEach((tab, i) => db.t.sheetTabs.put({ id: uuidv7(), sheetId: s.id, position: i, name: tab.name.slice(0, 300), columns: tab.columns, rows: tab.rows, rowCount: tab.rows.length, truncated: tab.truncated }));
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
  http.get(
    "/v1/orgs/:org/sheets/:id/tabs/:tab/rows",
    route(({ cookies, params }) => {
      const { s } = sheetCtx(cookies, params.org as string, params.id as string);
      const tab = db.t.sheetTabs.get(params.tab as string);
      if (!tab || tab.sheetId !== s.id) fail(404, "not_found", "Tab not found");
      return HttpResponse.json({ columns: tab!.columns, rows: tab!.rows });
    }),
  ),
  http.get(
    "/v1/orgs/:org/sheets/:id/original",
    route(({ cookies, params }) => {
      const { s } = sheetCtx(cookies, params.org as string, params.id as string);
      return new HttpResponse(s.blob, { headers: { "Content-Type": s.blob.type || "application/octet-stream", "Content-Disposition": `attachment; filename="${s.filename.replace(/"/g, "")}"` } });
    }),
  ),
  http.post(
    "/v1/orgs/:org/sheets/:id/charts",
    route(async ({ cookies, params, request }) => {
      const { s, ctx } = sheetCtx(cookies, params.org as string, params.id as string);
      if (ctx.role === "viewer") fail(403, "forbidden", "Viewers can't save charts");
      const body = (await request.json()) as Record<string, unknown>;
      const tab = db.t.sheetTabs.get(body.tabId as string);
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
