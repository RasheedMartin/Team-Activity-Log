import { SearchRounded, TableChartOutlined, UploadFileOutlined } from "@mui/icons-material";
import { Box, Button, InputAdornment, LinearProgress, List, ListItemButton, ListItemIcon, ListItemText, Paper, Skeleton, Stack, TextField, Typography } from "@mui/material";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link as RouterLink, useNavigate, useSearchParams } from "react-router-dom";
import { useImportSheet, usePeople, useSheets } from "../../api/hooks";
import { can, useWs, wsPath } from "../../app/session";
import { useNotify } from "../../components/notify";
import { EmptyState, ErrorState, PageHeader } from "../../components/ui";
import { timeAgo } from "../../lib/dates";
import { errorMessage } from "../../lib/format";

export const SHEET_TYPES = ".xlsx,.csv,.tsv";
const plural = (n: number, one: string) => `${n.toLocaleString()} ${one}${n === 1 ? "" : "s"}`;

/** Import a spreadsheet, then open it. */
export function ImportSheetButton() {
  const { org, ws, role } = useWs();
  const input = useRef<HTMLInputElement>(null);
  const imp = useImportSheet(org.id, ws.id);
  const navigate = useNavigate();
  const notify = useNotify();
  if (!can(role, "member")) return null;
  return (
    <>
      <Button variant="contained" startIcon={<UploadFileOutlined />} onClick={() => input.current?.click()} disabled={imp.isPending}>
        {imp.isPending ? "Importing…" : "Import a spreadsheet"}
      </Button>
      <input
        ref={input}
        type="file"
        hidden
        accept={SHEET_TYPES}
        aria-label="Spreadsheet to import"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          if (!/\.(xlsx|csv|tsv)$/i.test(file.name)) return notify("Choose an Excel (.xlsx) or CSV file");
          imp.mutate(file, { onSuccess: (s) => navigate(wsPath(org, ws, `/sheets/${s.id}`)), onError: (err) => notify(errorMessage(err)) });
        }}
      />
    </>
  );
}

/**
 * Sheets (owner request): spreadsheets kept as tables you can sort, filter, chart, and embed in
 * posts. Search finds a sheet by its name, column names, or anything written in its cells.
 */
export default function SheetsPage() {
  const { org, ws } = useWs();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get("q") ?? "");
  const [debounced, setDebounced] = useState(q);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q), 200);
    return () => clearTimeout(t);
  }, [q]);
  const sheets = useSheets(org.id, ws.id, debounced);
  const { data: people = [] } = usePeople(org.id);
  const names = useMemo(() => new Map(people.map((p) => [p.id, p.name])), [people]);
  const items = sheets.data ?? [];

  return (
    <Box sx={{ maxWidth: 960, width: "100%", mx: "auto", px: { xs: 1.5, sm: 3 }, py: 3 }}>
      <PageHeader title="Sheets" sub="Spreadsheets as tables: sort, filter, chart, and put a live chart in a post." actions={<ImportSheetButton />} />
      <TextField
        fullWidth
        placeholder="Search names, columns, and cells"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setParams(e.target.value ? { q: e.target.value } : {}, { replace: true });
        }}
        slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchRounded fontSize="small" /></InputAdornment> } }}
        inputProps={{ "aria-label": "Find sheets" }}
        sx={{ mb: 2 }}
      />
      {sheets.isPending ? (
        <Stack spacing={1}>{[0, 1, 2].map((i) => <Skeleton key={i} variant="rounded" height={56} />)}</Stack>
      ) : sheets.error ? (
        <ErrorState error={sheets.error} onRetry={() => sheets.refetch()} />
      ) : !items.length ? (
        <EmptyState
          icon={<TableChartOutlined />}
          title={debounced ? "Nothing matches" : "No sheets yet"}
          body={debounced ? "Try other words: search looks inside cells too." : "Import an Excel (.xlsx) or CSV file. Each tab becomes a table you can sort, filter, and chart."}
        />
      ) : (
        <Paper variant="outlined" sx={{ opacity: sheets.isPlaceholderData ? 0.6 : 1 }}>
          {sheets.isFetching && <LinearProgress sx={{ height: 2 }} />}
          <List disablePadding aria-label="Sheets">
            {items.map((s) => (
              <ListItemButton key={s.id} component={RouterLink} to={wsPath(org, ws, `/sheets/${s.id}`)} divider>
                <ListItemIcon sx={{ minWidth: 36, color: "text.secondary" }}><TableChartOutlined /></ListItemIcon>
                <ListItemText
                  primary={s.name}
                  secondary={[s.tabs > 1 ? plural(s.tabs, "tab") : null, plural(s.rows, "row"), s.createdBy ? names.get(s.createdBy) : null, `updated ${timeAgo(s.updatedAt)}`].filter(Boolean).join(" · ")}
                  slotProps={{ primary: { noWrap: true, fontWeight: 500 }, secondary: { noWrap: true } }}
                />
              </ListItemButton>
            ))}
          </List>
        </Paper>
      )}
      {!!items.length && <Typography variant="caption" color="text.disabled" sx={{ display: "block", mt: 1 }}>{plural(items.length, "sheet")}</Typography>}
    </Box>
  );
}
