import {
  ArrowBackRounded,
  ArrowDownwardRounded,
  ArrowUpwardRounded,
  CalendarTodayOutlined,
  CategoryOutlined,
  CloseRounded,
  DeleteOutlineRounded,
  FileDownloadOutlined,
  MoreHorizRounded,
  NumbersRounded,
  SearchRounded,
  SubjectRounded,
} from "@mui/icons-material";
import {
  Alert,
  Box,
  Button,
  ButtonBase,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  InputAdornment,
  ListItemIcon,
  Menu,
  MenuItem,
  Paper,
  Skeleton,
  Stack,
  Tab,
  Tabs,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link as RouterLink, useNavigate, useParams, useSearchParams } from "react-router-dom";
import type { SheetCell, SheetColumn } from "../../api/contract";
import { ApiError, downloadFile } from "../../api/client";
import { useDeleteSheet, useSheet, useSheetRows } from "../../api/hooks";
import { useWs, wsPath } from "../../app/session";
import { useNotify } from "../../components/notify";
import { EmptyState, ErrorState } from "../../components/ui";
import { errorMessage } from "../../lib/format";
import { colIndex, columnStats, fmtCell, view, type Sort } from "../../lib/sheetData";

const ROW_H = 36;
const NUM_W = 56;
const WIDTH: Record<SheetColumn["type"], number> = { number: 130, date: 130, category: 170, text: 240 };
const TYPE_ICON: Record<SheetColumn["type"], ReactNode> = {
  number: <NumbersRounded sx={{ fontSize: 14 }} />,
  date: <CalendarTodayOutlined sx={{ fontSize: 13 }} />,
  category: <CategoryOutlined sx={{ fontSize: 14 }} />,
  text: <SubjectRounded sx={{ fontSize: 14 }} />,
};
const TYPE_NAME: Record<SheetColumn["type"], string> = { number: "Numbers", date: "Dates", category: "Categories", text: "Text" };
const plural = (n: number, one: string) => `${n.toLocaleString()} ${one}${n === 1 ? "" : "s"}`;

/** A column's menu: sort it, and what's in it (for the rows the filter shows). */
function ColumnMenu({ anchor, col, rows, shown, sort, onSort, onClose }: { anchor: HTMLElement | null; col: SheetColumn | null; rows: SheetCell[][]; shown: number[]; sort: Sort; onSort: (s: Sort) => void; onClose: () => void }) {
  const stats = useMemo(() => (col ? columnStats(rows, col, shown) : null), [rows, col, shown]);
  if (!col || !stats) return null;
  const line = (label: string, value: ReactNode) => (
    <Stack direction="row" justifyContent="space-between" spacing={3} key={label}>
      <Typography variant="body2" color="text.secondary">{label}</Typography>
      <Typography variant="body2" sx={{ fontVariantNumeric: "tabular-nums", textAlign: "right", minWidth: 0 }} noWrap>{value}</Typography>
    </Stack>
  );
  const active = sort?.key === col.key ? sort.dir : null;
  return (
    <Menu anchorEl={anchor} open={!!anchor} onClose={onClose} slotProps={{ paper: { sx: { minWidth: 240, maxWidth: 320 } } }}>
      <Box sx={{ px: 2, pt: 0.5, pb: 1 }}>
        <Typography sx={{ fontWeight: 600 }} noWrap>{col.name}</Typography>
        <Typography variant="caption" color="text.secondary">{TYPE_NAME[col.type]}</Typography>
      </Box>
      <MenuItem selected={active === "asc"} onClick={() => (onSort({ key: col.key, dir: "asc" }), onClose())}>
        <ListItemIcon><ArrowUpwardRounded fontSize="small" /></ListItemIcon>
        {col.type === "number" ? "Smallest first" : col.type === "date" ? "Oldest first" : "A to Z"}
      </MenuItem>
      <MenuItem selected={active === "desc"} onClick={() => (onSort({ key: col.key, dir: "desc" }), onClose())}>
        <ListItemIcon><ArrowDownwardRounded fontSize="small" /></ListItemIcon>
        {col.type === "number" ? "Largest first" : col.type === "date" ? "Newest first" : "Z to A"}
      </MenuItem>
      {active && (
        <MenuItem onClick={() => (onSort(null), onClose())}>
          <ListItemIcon><CloseRounded fontSize="small" /></ListItemIcon>
          Clear sort
        </MenuItem>
      )}
      <Divider />
      <Stack spacing={0.5} sx={{ px: 2, py: 1 }} aria-label={`About ${col.name}`}>
        {line("Filled", stats.filled.toLocaleString())}
        {stats.empty > 0 && line("Empty", stats.empty.toLocaleString())}
        {line("Distinct", stats.distinct.toLocaleString())}
        {stats.min !== undefined && line(col.type === "date" ? "Earliest" : "Min", fmtCell(stats.min, col.type))}
        {stats.max !== undefined && line(col.type === "date" ? "Latest" : "Max", fmtCell(stats.max, col.type))}
        {stats.sum !== undefined && line("Sum", fmtCell(stats.sum, "number"))}
        {stats.avg !== undefined && line("Average", fmtCell(stats.avg, "number"))}
        {!!stats.top?.length && (
          <>
            <Typography variant="caption" color="text.secondary" sx={{ pt: 0.5 }}>Most common</Typography>
            {stats.top.map((t) => line(t.value, t.count.toLocaleString()))}
          </>
        )}
      </Stack>
    </Menu>
  );
}

/** A tab's rows: only the visible ones are in the page (tabs hold up to 50,000). */
function Grid({ columns, rows, shown, sort, onHeader }: { columns: SheetColumn[]; rows: SheetCell[][]; shown: number[]; sort: Sort; onHeader: (el: HTMLElement, col: SheetColumn) => void }) {
  const scroller = useRef<HTMLDivElement>(null);
  const v = useVirtualizer({ count: shown.length, getScrollElement: () => scroller.current, estimateSize: () => ROW_H, overscan: 12 });
  const template = `${NUM_W}px ${columns.map((c) => `${WIDTH[c.type]}px`).join(" ")}`;
  const width = NUM_W + columns.reduce((n, c) => n + WIDTH[c.type], 0);
  const cell = { px: 1.25, height: ROW_H, display: "flex", alignItems: "center", borderRight: 1, borderBottom: 1, borderColor: "divider", minWidth: 0, fontSize: "0.85rem" } as const;
  return (
    <Paper variant="outlined" ref={scroller} role="grid" aria-rowcount={shown.length + 1} aria-colcount={columns.length} sx={{ overflow: "auto", height: { xs: "60vh", md: "calc(100vh - 290px)" }, minHeight: 280, position: "relative" }}>
      <Box sx={{ width, minWidth: "100%" }}>
        <Box role="row" sx={{ display: "grid", gridTemplateColumns: template, position: "sticky", top: 0, zIndex: 2, bgcolor: "background.paper", boxShadow: (t) => `0 1px 0 ${t.palette.divider}` }}>
          <Box sx={{ ...cell, position: "sticky", left: 0, bgcolor: "background.paper", zIndex: 1 }} />
          {columns.map((c) => (
            <ButtonBase
              key={c.key}
              role="columnheader"
              aria-sort={sort?.key === c.key ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
              onClick={(e) => onHeader(e.currentTarget, c)}
              sx={{ ...cell, justifyContent: c.type === "number" ? "flex-end" : "flex-start", gap: 0.5, fontWeight: 600, "&:hover": { bgcolor: "action.hover" } }}
            >
              <Box component="span" sx={{ color: "text.disabled", display: "flex" }} aria-hidden>{TYPE_ICON[c.type]}</Box>
              <Box component="span" sx={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</Box>
              {sort?.key === c.key && (sort.dir === "asc" ? <ArrowUpwardRounded sx={{ fontSize: 14 }} /> : <ArrowDownwardRounded sx={{ fontSize: 14 }} />)}
            </ButtonBase>
          ))}
        </Box>
        <Box sx={{ height: v.getTotalSize(), position: "relative" }}>
          {v.getVirtualItems().map((it) => {
            const i = shown[it.index];
            const r = rows[i];
            return (
              <Box key={it.key} role="row" aria-rowindex={it.index + 2} sx={{ display: "grid", gridTemplateColumns: template, position: "absolute", top: 0, left: 0, width: "100%", transform: `translateY(${it.start}px)`, "&:hover > *": { bgcolor: "action.hover" } }}>
                <Box sx={{ ...cell, position: "sticky", left: 0, zIndex: 1, bgcolor: "background.paper", color: "text.disabled", justifyContent: "flex-end", fontSize: "0.75rem", fontVariantNumeric: "tabular-nums" }}>{i + 1}</Box>
                {columns.map((c) => {
                  const text = fmtCell(r[colIndex(c.key)], c.type);
                  return (
                    <Box key={c.key} role="gridcell" title={text.length > 24 ? text : undefined} sx={{ ...cell, justifyContent: c.type === "number" ? "flex-end" : "flex-start", fontVariantNumeric: c.type === "number" ? "tabular-nums" : undefined }}>
                      <Box component="span" sx={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{text}</Box>
                    </Box>
                  );
                })}
              </Box>
            );
          })}
        </Box>
      </Box>
    </Paper>
  );
}

/**
 * One sheet (owner request: Sheets v1 = read + chart + embed): its tabs as tables you can sort,
 * filter, and summarize column by column. The original file stays downloadable.
 */
export default function SheetPage() {
  const { org, ws } = useWs();
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const notify = useNotify();
  const sheet = useSheet(org.id, id);
  const s = sheet.data;
  const tab = s?.tabList.find((t) => t.id === params.get("tab")) ?? s?.tabList[0];
  const data = useSheetRows(org.id, s?.id, tab?.id);
  const rows = data.data?.rows;
  const columns = data.data?.columns ?? tab?.columns ?? [];
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [sort, setSort] = useState<Sort>(null);
  const [colMenu, setColMenu] = useState<{ el: HTMLElement; col: SheetColumn } | null>(null);
  const [more, setMore] = useState<HTMLElement | null>(null);
  const [confirm, setConfirm] = useState(false);
  const del = useDeleteSheet(org.id, ws.id);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q), 150);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => (setSort(null), setQ(""), setDebounced("")), [tab?.id]);
  const shown = useMemo(() => (rows ? view(rows, debounced, sort) : []), [rows, debounced, sort]);

  if (sheet.isPending) return <Box sx={{ maxWidth: 1200, mx: "auto", p: 3 }}><Skeleton width={240} height={40} /><Skeleton variant="rounded" height={400} sx={{ mt: 2 }} /></Box>;
  if (sheet.error || !s) {
    return sheet.error && !(sheet.error instanceof ApiError && sheet.error.status === 404)
      ? <ErrorState error={sheet.error} onRetry={() => sheet.refetch()} />
      : <EmptyState title="Sheet not found" body="It may have been deleted." action={<Button component={RouterLink} to={wsPath(org, ws, "/sheets")}>Back to Sheets</Button>} />;
  }

  return (
    <Box sx={{ maxWidth: 1200, width: "100%", mx: "auto", px: { xs: 1.5, sm: 3 }, py: 2 }}>
      <Button size="small" color="inherit" startIcon={<ArrowBackRounded />} component={RouterLink} to={wsPath(org, ws, "/sheets")} sx={{ color: "text.secondary", mb: 1 }}>
        Sheets
      </Button>
      <Stack direction="row" alignItems="flex-start" spacing={1} sx={{ mb: 1 }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="h5" component="h1" sx={{ fontWeight: 600, overflowWrap: "anywhere" }}>{s.name}</Typography>
          <Typography variant="body2" color="text.secondary" noWrap>
            {[s.filename, s.tabs > 1 ? plural(s.tabs, "tab") : null, plural(s.rows, "row")].filter(Boolean).join(" · ")}
          </Typography>
        </Box>
        <Tooltip title="More">
          <IconButton onClick={(e) => setMore(e.currentTarget)} aria-label="Sheet actions"><MoreHorizRounded /></IconButton>
        </Tooltip>
        <Menu anchorEl={more} open={!!more} onClose={() => setMore(null)}>
          <MenuItem onClick={() => (setMore(null), void downloadFile(`/orgs/${org.id}/sheets/${s.id}/original`, s.filename).catch((e) => notify(e.message)))}>
            <ListItemIcon><FileDownloadOutlined fontSize="small" /></ListItemIcon>
            Download original
          </MenuItem>
          {s.canDelete && (
            <MenuItem onClick={() => (setMore(null), setConfirm(true))} sx={{ color: "error.main" }}>
              <ListItemIcon><DeleteOutlineRounded fontSize="small" color="error" /></ListItemIcon>
              Delete sheet
            </MenuItem>
          )}
        </Menu>
      </Stack>

      {s.tabList.length > 1 && (
        <Tabs value={tab?.id ?? false} onChange={(_, v: string) => setParams({ tab: v }, { replace: true })} variant="scrollable" scrollButtons="auto" allowScrollButtonsMobile sx={{ mb: 1, minHeight: 40, "& .MuiTab-root": { minHeight: 40, textTransform: "none" } }} aria-label="Tabs">
          {s.tabList.map((t) => <Tab key={t.id} value={t.id} label={t.name} />)}
        </Tabs>
      )}
      {tab?.truncated && <Alert severity="info" sx={{ mb: 1 }}>This tab had more than 50,000 rows; the first 50,000 were kept. Download the original for the rest.</Alert>}

      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1, flexWrap: "wrap", rowGap: 1 }}>
        <TextField
          size="small"
          placeholder="Filter rows"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchRounded fontSize="small" /></InputAdornment>, endAdornment: q ? <IconButton size="small" onClick={() => setQ("")} aria-label="Clear filter"><CloseRounded fontSize="small" /></IconButton> : undefined } }}
          inputProps={{ "aria-label": "Filter rows" }}
          sx={{ flex: "1 1 220px", maxWidth: 360 }}
        />
        {sort && (
          <Chip
            size="small"
            label={`${columns.find((c) => c.key === sort.key)?.name ?? ""} ${sort.dir === "asc" ? "↑" : "↓"}`}
            onDelete={() => setSort(null)}
            aria-label="Clear sort"
          />
        )}
        <Typography variant="body2" color="text.secondary" sx={{ ml: "auto !important" }} aria-live="polite">
          {rows ? (debounced ? `${shown.length.toLocaleString()} of ${plural(rows.length, "row")}` : plural(rows.length, "row")) : ""}
        </Typography>
      </Stack>

      {data.error ? (
        <ErrorState error={data.error} onRetry={() => data.refetch()} />
      ) : !rows ? (
        <Skeleton variant="rounded" height={400} />
      ) : !shown.length && debounced ? (
        <EmptyState title="No rows match" body="Try other words, or clear the filter." action={<Button onClick={() => setQ("")}>Clear filter</Button>} />
      ) : (
        <Grid columns={columns} rows={rows} shown={shown} sort={sort} onHeader={(el, col) => setColMenu({ el, col })} />
      )}
      <Typography variant="caption" color="text.disabled" sx={{ display: "block", mt: 0.75 }}>Click a column name to sort it or see what's in it.</Typography>

      <ColumnMenu anchor={colMenu?.el ?? null} col={colMenu?.col ?? null} rows={rows ?? []} shown={shown} sort={sort} onSort={setSort} onClose={() => setColMenu(null)} />

      <Dialog open={confirm} onClose={() => setConfirm(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Delete this sheet?</DialogTitle>
        <DialogContent>
          <Typography variant="body2">
            “{s.name}” and its saved charts are deleted for everyone. Posts that show one of its charts will say the chart is no longer available.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirm(false)}>Cancel</Button>
          <Button
            color="error"
            variant="contained"
            disabled={del.isPending}
            onClick={() =>
              del.mutateAsync(s.id).then(
                () => (notify("Sheet deleted"), navigate(wsPath(org, ws, "/sheets"))),
                (e) => notify(errorMessage(e)),
              )
            }
          >
            Delete
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
