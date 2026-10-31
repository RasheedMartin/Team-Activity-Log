import { AddchartRounded, AddRounded, ArrowBackRounded, CloseRounded, DeleteOutlineRounded, SearchRounded, UndoRounded } from "@mui/icons-material";
import { Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, InputAdornment, Skeleton, Stack, Tab, Tabs, TextField, ToggleButton, ToggleButtonGroup, Tooltip, Typography } from "@mui/material";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Link as RouterLink, useParams, useSearchParams } from "react-router-dom";
import type { SheetCell, SheetChart, SheetColumn, SheetColumnOp, SheetRowOp } from "../../api/contract";
import { ApiError } from "../../api/client";
import { useEditSheet, usePeople, useSheet, useSheetRows } from "../../api/hooks";
import { can, useWs, wsPath } from "../../app/session";
import { useNotify } from "../../components/notify";
import { EmptyState, ErrorState } from "../../components/ui";
import { timeAgo } from "../../lib/dates";
import { errorMessage } from "../../lib/format";
import { colIndex, view, type Sort } from "../../lib/sheetData";
import { ChartBuilder } from "./ChartBuilder";
import { ChartsPanel } from "./ChartsPanel";
import { ColumnMenu } from "./ColumnMenu";
import { SheetGrid, type Active } from "./SheetGrid";
import { SheetMenu } from "./SheetMenu";

const plural = (n: number, one: string) => `${n.toLocaleString()} ${one}${n === 1 ? "" : "s"}`;
interface Undo {
  label: string;
  ops: SheetRowOp[];
}

/**
 * One sheet (owner request: Sheets): its tabs as tables you can sort, filter, and summarize
 * column by column; edit them if you may (v2); chart them (Charts view).
 */
export default function SheetPage() {
  const { org, ws, role } = useWs();
  const { id = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const notify = useNotify();
  const sheet = useSheet(org.id, id);
  const s = sheet.data;
  const tab = s?.tabList.find((t) => t.id === params.get("tab")) ?? s?.tabList[0];
  const data = useSheetRows(org.id, s?.id, tab?.id);
  const rows = data.data?.rows;
  const ids = data.data?.ids;
  const columns = data.data?.columns ?? tab?.columns ?? [];
  const edit = useEditSheet(org.id, id, tab?.id ?? "");
  const { data: people = [] } = usePeople(org.id);
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [sort, setSort] = useState<Sort>(null);
  const [colMenu, setColMenu] = useState<{ el: HTMLElement; col: SheetColumn } | null>(null);
  const [building, setBuilding] = useState<{ chart?: SheetChart } | null>(null);
  const [active, setActive] = useState<Active | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const lastPicked = useRef<number | null>(null);
  const [pending, setPending] = useState<Map<string, SheetCell>>(new Map());
  const [undo, setUndo] = useState<Undo[]>([]);
  const [deletingCol, setDeletingCol] = useState<SheetColumn | null>(null);
  const focusRow = useRef<number | null>(null); // a row just added: put the cursor on it once it's in
  const charts = params.get("view") === "charts";
  const editable = !!s?.canEdit && !charts;
  const go = (patch: { tab?: string; charts?: boolean }) => {
    const tabId = patch.tab ?? params.get("tab");
    const next: Record<string, string> = {};
    if (tabId) next.tab = tabId;
    if (patch.charts ?? charts) next.view = "charts";
    setParams(next, { replace: true });
  };
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q), 150);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => {
    setSort(null);
    setQ("");
    setDebounced("");
    setActive(null);
    setSelected(new Set());
    setUndo([]);
  }, [tab?.id]);
  const tabCharts = s?.charts.filter((c) => c.tabId === tab?.id).length ?? 0;
  const shown = useMemo(() => (rows ? view(rows, debounced, sort) : []), [rows, debounced, sort]);
  useEffect(() => {
    if (focusRow.current === null || !ids) return;
    const r = shown.indexOf(ids.indexOf(focusRow.current));
    if (r >= 0) setActive({ r, c: 0 });
    focusRow.current = null;
  }, [ids, shown]);

  // ---- edits ----
  const run = (ops: SheetRowOp[], then?: (r: Awaited<ReturnType<typeof edit.rows.mutateAsync>>) => void) =>
    edit.rows.mutateAsync(ops).then(
      (r) => then?.(r),
      (e) => notify(errorMessage(e)),
    );
  const setCell = (rowIndex: number, col: SheetColumn, value: string) => {
    if (!ids || !rows) return;
    const before = rows[rowIndex]?.[colIndex(col.key)] ?? null;
    const key = `${rowIndex}:${col.key}`;
    setPending((p) => new Map(p).set(key, value === "" ? null : value));
    const rowId = ids[rowIndex];
    void run([{ op: "set", id: rowId, col: col.key, value: value === "" ? null : value }], () => setUndo((u) => [...u.slice(-49), { label: `Undo edit in ${col.name}`, ops: [{ op: "set", id: rowId, col: col.key, value: before }] }])).finally(() =>
      setPending((p) => {
        const n = new Map(p);
        n.delete(key);
        return n;
      }),
    );
  };
  const undoLast = () => {
    const last = undo[undo.length - 1];
    if (!last) return;
    setUndo((u) => u.slice(0, -1));
    void run(last.ops);
  };
  const addRow = (after?: number) =>
    void run([{ op: "insert", ...(after !== undefined && ids ? { after: ids[after] } : {}) }], (r) => {
      focusRow.current = r.inserted[0]?.id ?? null;
      if (after === undefined) {
        // so the new row is on screen
        setSort(null);
        setQ("");
        setDebounced("");
      }
    });
  const pickRow = (i: number, range: boolean) => {
    setSelected((cur) => {
      const next = new Set(cur);
      if (range && lastPicked.current !== null) {
        const a = shown.indexOf(lastPicked.current);
        const b = shown.indexOf(i);
        for (const x of shown.slice(Math.min(a, b), Math.max(a, b) + 1)) next.add(x);
      } else if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
    lastPicked.current = i;
  };
  const deleteRows = () => {
    if (!ids || !rows) return;
    const gone = [...selected].sort((a, b) => a - b);
    const goneIds = gone.map((i) => ids[i]);
    // Undo puts each run of rows back after the row before it (or first): last-first, see the API.
    const groups = new Map<number | "first", number[]>();
    const goneSet = new Set(gone);
    for (const i of gone) {
      let p = i - 1;
      while (p >= 0 && goneSet.has(p)) p--;
      const anchor = p < 0 ? "first" : ids[p];
      groups.set(anchor, [...(groups.get(anchor) ?? []), i]);
    }
    const restore: SheetRowOp[] = [...groups].flatMap(([anchor, list]) =>
      [...list].reverse().map((i) => ({ op: "insert" as const, ...(anchor === "first" ? { first: true } : { after: anchor }), cells: Object.fromEntries(columns.map((c) => [c.key, rows[i][colIndex(c.key)] ?? null])) })),
    );
    setSelected(new Set());
    setActive(null);
    void run([{ op: "delete", ids: goneIds }], () => notify(`Deleted ${plural(gone.length, "row")}`, () => void run(restore)));
  };
  const editColumn = (op: SheetColumnOp) => {
    if (op.op === "delete") return setDeletingCol(columns.find((c) => c.key === op.key) ?? null);
    edit.columns.mutateAsync([op]).then(
      () => op.op === "type" && notify(`${columns.find((c) => c.key === op.key)?.name} now holds ${op.type === "category" ? "categories" : op.type === "text" ? "text" : `${op.type}s`}`),
      (e) => notify(errorMessage(e)),
    );
  };
  const onKey = (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z" && !(e.target instanceof HTMLInputElement)) {
      e.preventDefault();
      undoLast();
    }
  };

  if (sheet.isPending) return <Box sx={{ maxWidth: 1200, mx: "auto", p: 3 }}><Skeleton width={240} height={40} /><Skeleton variant="rounded" height={400} sx={{ mt: 2 }} /></Box>;
  if (sheet.error || !s) {
    return sheet.error && !(sheet.error instanceof ApiError && sheet.error.status === 404)
      ? <ErrorState error={sheet.error} onRetry={() => sheet.refetch()} />
      : <EmptyState title="Sheet not found" body="It may have been deleted." action={<Button component={RouterLink} to={wsPath(org, ws, "/sheets")}>Back to Sheets</Button>} />;
  }
  const editor = s.updatedBy ? people.find((p) => p.id === s.updatedBy)?.name : undefined;
  const busy = edit.rows.isPending || edit.columns.isPending;

  return (
    <Box sx={{ maxWidth: 1200, width: "100%", mx: "auto", px: { xs: 1.5, sm: 3 }, py: 2 }} onKeyDown={onKey}>
      <Button size="small" color="inherit" startIcon={<ArrowBackRounded />} component={RouterLink} to={wsPath(org, ws, "/sheets")} sx={{ color: "text.secondary", mb: 1 }}>
        Sheets
      </Button>
      <Stack direction="row" alignItems="flex-start" spacing={1} sx={{ mb: 1 }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="h5" component="h1" sx={{ fontWeight: 600, overflowWrap: "anywhere" }}>{s.name}</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: "anywhere" }}>
            {[s.filename ?? "Made in the app", s.tabs > 1 ? plural(s.tabs, "tab") : null, plural(s.rows, "row"), `edited ${timeAgo(s.updatedAt)}${editor ? ` by ${editor}` : ""}`].filter(Boolean).join(" · ")}
            {!s.canEdit && <Chip size="small" label="View only" variant="outlined" sx={{ ml: 1, height: 20 }} />}
          </Typography>
        </Box>
        <SheetMenu sheet={s} tabName={tab?.name} data={data.data} />
      </Stack>

      {s.tabList.length > 1 && (
        <Tabs value={tab?.id ?? false} onChange={(_, v: string) => go({ tab: v })} variant="scrollable" scrollButtons="auto" allowScrollButtonsMobile sx={{ mb: 1, minHeight: 40, "& .MuiTab-root": { minHeight: 40, textTransform: "none" } }} aria-label="Tabs">
          {s.tabList.map((t) => <Tab key={t.id} value={t.id} label={t.name} />)}
        </Tabs>
      )}
      {tab?.truncated && <Alert severity="info" sx={{ mb: 1 }}>This tab had more than 50,000 rows; the first 50,000 were kept. Download the original for the rest.</Alert>}

      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1, flexWrap: "wrap", rowGap: 1 }}>
        <ToggleButtonGroup exclusive size="small" value={charts ? "charts" : "table"} onChange={(_, v: string | null) => v && go({ charts: v === "charts" })} aria-label="View">
          <ToggleButton value="table" sx={{ textTransform: "none", px: 1.5 }}>Table</ToggleButton>
          <ToggleButton value="charts" sx={{ textTransform: "none", px: 1.5 }}>Charts{tabCharts ? ` (${tabCharts})` : ""}</ToggleButton>
        </ToggleButtonGroup>
        {charts ? (
          can(role, "member") && !!rows && !!tabCharts && (
            <Button size="small" startIcon={<AddchartRounded />} onClick={() => setBuilding({})} sx={{ ml: "auto !important" }}>
              New chart
            </Button>
          )
        ) : selected.size > 0 ? (
          <>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>{plural(selected.size, "row")} selected</Typography>
            {editable && selected.size === 1 && <Button size="small" startIcon={<AddRounded />} disabled={busy} onClick={() => addRow([...selected][0])}>Insert row below</Button>}
            {editable && <Button size="small" color="error" startIcon={<DeleteOutlineRounded />} disabled={busy} onClick={deleteRows}>Delete</Button>}
            <Button size="small" onClick={() => setSelected(new Set())}>Clear</Button>
          </>
        ) : (
          <>
            <TextField
              size="small"
              placeholder="Filter rows"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchRounded fontSize="small" /></InputAdornment>, endAdornment: q ? <IconButton size="small" onClick={() => setQ("")} aria-label="Clear filter"><CloseRounded fontSize="small" /></IconButton> : undefined } }}
              inputProps={{ "aria-label": "Filter rows" }}
              sx={{ flex: "1 1 200px", maxWidth: 360 }}
            />
            {sort && <Chip size="small" label={`${columns.find((c) => c.key === sort.key)?.name ?? ""} ${sort.dir === "asc" ? "↑" : "↓"}`} onDelete={() => setSort(null)} aria-label="Clear sort" />}
            {editable && !!undo.length && (
              <Tooltip title={`${undo[undo.length - 1].label} (Ctrl/⌘ Z)`}>
                <IconButton size="small" onClick={undoLast} disabled={busy} aria-label="Undo"><UndoRounded fontSize="small" /></IconButton>
              </Tooltip>
            )}
            <Typography variant="body2" color="text.secondary" sx={{ ml: "auto !important" }} aria-live="polite">
              {busy ? "Saving…" : rows ? (debounced ? `${shown.length.toLocaleString()} of ${plural(rows.length, "row")}` : plural(rows.length, "row")) : ""}
            </Typography>
          </>
        )}
      </Stack>

      {data.error ? (
        <ErrorState error={data.error} onRetry={() => data.refetch()} />
      ) : !rows ? (
        <Skeleton variant="rounded" height={400} />
      ) : charts ? (
        <ChartsPanel sheet={s} tabId={tab!.id} rows={rows} columns={columns} onNew={() => setBuilding({})} onEdit={(chart) => setBuilding({ chart })} />
      ) : !shown.length && debounced ? (
        <EmptyState title="No rows match" body="Try other words, or clear the filter." action={<Button onClick={() => setQ("")}>Clear filter</Button>} />
      ) : (
        <SheetGrid
          columns={columns}
          rows={rows}
          shown={shown}
          sort={sort}
          editable={editable}
          pending={pending}
          selectedRows={selected}
          onSelectRow={pickRow}
          onHeader={(el, col) => setColMenu({ el, col })}
          onSet={setCell}
          active={active}
          setActive={setActive}
        />
      )}
      {!charts && (
        <Stack direction="row" alignItems="center" spacing={1} sx={{ mt: 0.75, flexWrap: "wrap" }}>
          {editable && rows && <Button size="small" startIcon={<AddRounded />} onClick={() => addRow()} disabled={busy}>Add row</Button>}
          <Typography variant="caption" color="text.disabled">
            {editable ? "Click a cell and type to edit; Enter saves. Click a row number to select rows, a column name for more." : "Click a column name to sort it or see what's in it."}
          </Typography>
        </Stack>
      )}
      {building && rows && tab && <ChartBuilder sheetId={s.id} tabId={tab.id} columns={columns} rows={rows} chart={building.chart} onClose={() => setBuilding(null)} onSaved={() => go({ charts: true })} />}

      <ColumnMenu anchor={colMenu?.el ?? null} col={colMenu?.col ?? null} rows={rows ?? []} shown={shown} sort={sort} editable={editable} onSort={setSort} onEdit={editColumn} onClose={() => setColMenu(null)} />

      <Dialog open={!!deletingCol} onClose={() => setDeletingCol(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Delete “{deletingCol?.name}”?</DialogTitle>
        <DialogContent>
          <Typography variant="body2">The column and every value in it are deleted for everyone.</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeletingCol(null)}>Cancel</Button>
          <Button
            color="error"
            variant="contained"
            disabled={edit.columns.isPending}
            onClick={() => {
              const col = deletingCol!;
              setDeletingCol(null);
              edit.columns.mutateAsync([{ op: "delete", key: col.key }]).then(() => notify(`Deleted ${col.name}`), (e) => notify(errorMessage(e)));
            }}
          >
            Delete
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
