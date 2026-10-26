import {
  AlignHorizontalLeftRounded,
  AreaChartOutlined,
  BarChartRounded,
  PieChartOutlineRounded,
  ScatterPlotOutlined,
  ShowChartRounded,
} from "@mui/icons-material";
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import { useState, type ReactNode } from "react";
import type { ID, SheetAgg, SheetCell, SheetChart, SheetChartSpec, SheetChartType, SheetColumn } from "../../api/contract";
import { useSheetChart } from "../../api/hooks";
import { useWs } from "../../app/session";
import { useNotify } from "../../components/notify";
import { SheetChartView } from "../../components/SheetChartBlock";
import { errorMessage } from "../../lib/format";
import { defaultSpec } from "../../lib/sheetChart";

const TYPES: { id: SheetChartType; label: string; icon: ReactNode }[] = [
  { id: "line", label: "Line", icon: <ShowChartRounded /> },
  { id: "column", label: "Column", icon: <BarChartRounded /> },
  { id: "bar", label: "Bar", icon: <AlignHorizontalLeftRounded /> },
  { id: "area", label: "Area", icon: <AreaChartOutlined /> },
  { id: "scatter", label: "Scatter", icon: <ScatterPlotOutlined /> },
  { id: "pie", label: "Pie", icon: <PieChartOutlineRounded /> },
];
const AGGS: { id: SheetAgg; label: string }[] = [
  { id: "none", label: "Each row as it is" },
  { id: "sum", label: "Total" },
  { id: "avg", label: "Average" },
  { id: "count", label: "Count of rows" },
  { id: "min", label: "Smallest" },
  { id: "max", label: "Largest" },
];

/**
 * Make or change a chart on a tab: pick a type, what goes along the bottom (X), what's measured
 * (Y), how rows with the same X are summarized, and optionally split into one series per value.
 * The preview is the real chart, drawn from the tab's rows.
 */
export function ChartBuilder({ sheetId, tabId, columns, rows, chart, onClose, onSaved }: { sheetId: ID; tabId: ID; columns: SheetColumn[]; rows: SheetCell[][]; chart?: SheetChart; onClose: () => void; onSaved?: (c: SheetChart) => void }) {
  const { org } = useWs();
  const notify = useNotify();
  const theme = useTheme();
  const phone = useMediaQuery(theme.breakpoints.down("sm"));
  const { create, update } = useSheetChart(org.id, sheetId);
  const [spec, setSpec] = useState<SheetChartSpec>(() => chart?.spec ?? defaultSpec(columns) ?? { type: "column", x: columns[0]?.key ?? "c0", y: [], agg: "count" });
  const [name, setName] = useState(chart?.name ?? "");
  const numbers = columns.filter((c) => c.type === "number");
  const groups = columns.filter((c) => c.type === "category" && c.key !== spec.x);
  const single = !!spec.groupBy || spec.type === "pie"; // one measure: split series, or pie slices
  const set = (patch: Partial<SheetChartSpec>) => setSpec((s) => ({ ...s, ...patch }));
  const colName = (k: string) => columns.find((c) => c.key === k)?.name ?? "";
  const AGG_WORD: Record<SheetAgg, string> = { none: "", sum: "Total ", avg: "Average ", count: "", min: "Smallest ", max: "Largest " };
  const suggested =
    (spec.agg === "count" || !spec.y.length ? `Rows by ${colName(spec.x)}` : `${AGG_WORD[spec.agg]}${spec.y.map(colName).join(", ")} by ${colName(spec.x)}`.replace(/^./, (c) => c.toUpperCase())) +
    (spec.groupBy && spec.agg !== "none" ? `, per ${colName(spec.groupBy)}` : "");
  const valid = !!spec.x && (spec.y.length > 0 || spec.agg === "count");
  const saving = create.isPending || update.isPending;

  const save = () => {
    const v = { name: name.trim() || suggested, spec };
    (chart ? update.mutateAsync({ id: chart.id, ...v }) : create.mutateAsync({ tabId, ...v })).then(
      (c) => (notify(chart ? "Chart saved" : "Chart added to this sheet"), onSaved?.(c), onClose()),
      (e) => notify(errorMessage(e)),
    );
  };

  return (
    <Dialog open onClose={onClose} fullScreen={phone} maxWidth="lg" fullWidth aria-labelledby="chart-builder-title">
      <DialogTitle id="chart-builder-title">{chart ? "Edit chart" : "New chart"}</DialogTitle>
      <DialogContent dividers>
        <Stack direction={{ xs: "column", md: "row" }} spacing={3}>
          <Stack spacing={2} sx={{ width: { md: 300 }, flexShrink: 0 }}>
            <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} placeholder={suggested} slotProps={{ inputLabel: { shrink: true } }} />
            <ToggleButtonGroup exclusive size="small" value={spec.type} onChange={(_, v: SheetChartType | null) => v && set({ type: v, ...(v === "pie" ? { y: spec.y.slice(0, 1), groupBy: undefined } : {}) })} aria-label="Chart type" sx={{ flexWrap: "wrap" }}>
              {TYPES.map((t) => (
                <Tooltip key={t.id} title={t.label}>
                  <ToggleButton value={t.id} aria-label={t.label}>{t.icon}</ToggleButton>
                </Tooltip>
              ))}
            </ToggleButtonGroup>
            <TextField select label={spec.type === "pie" ? "Slices" : spec.type === "bar" ? "Down the side" : "Along the bottom (X)"} value={spec.x} onChange={(e) => set({ x: e.target.value, groupBy: spec.groupBy === e.target.value ? undefined : spec.groupBy })}>
              {columns.map((c) => <MenuItem key={c.key} value={c.key}>{c.name}</MenuItem>)}
            </TextField>
            <TextField
              select
              label="Summarize rows with the same X"
              value={spec.agg}
              onChange={(e) => {
                const agg = e.target.value as SheetAgg;
                set({ agg, ...(agg === "none" ? { groupBy: undefined } : {}) });
              }}
            >
              {AGGS.map((a) => <MenuItem key={a.id} value={a.id}>{a.label}</MenuItem>)}
            </TextField>
            {spec.agg !== "count" && (
              <TextField
                select
                label={spec.type === "pie" ? "Size" : "Measure (Y)"}
                value={single ? (spec.y[0] ?? "") : spec.y}
                onChange={(e) => {
                  const v = e.target.value as unknown as string[] | string;
                  set({ y: (Array.isArray(v) ? v : [v]).slice(0, 8) });
                }}
                slotProps={{ select: { multiple: !single, renderValue: (v) => (Array.isArray(v) ? v : [v as string]).map(colName).join(", ") } }}
                helperText={!numbers.length ? "This tab has no number columns: count rows instead." : !single ? "Choose one or more number columns." : undefined}
                error={!numbers.length}
              >
                {numbers.map((c) => <MenuItem key={c.key} value={c.key}>{c.name}</MenuItem>)}
              </TextField>
            )}
            <TextField
              select
              label="Split into a series per"
              value={spec.groupBy ?? ""}
              onChange={(e) => set({ groupBy: e.target.value || undefined, y: spec.y.slice(0, 1) })}
              disabled={spec.agg === "none" || spec.type === "pie" || !groups.length}
              helperText={spec.agg === "none" ? "Summarize rows first to split them." : !groups.length ? "No category columns to split by." : undefined}
            >
              <MenuItem value="">Don't split</MenuItem>
              {groups.map((c) => <MenuItem key={c.key} value={c.key}>{c.name}</MenuItem>)}
            </TextField>
          </Stack>
          <Box sx={{ flex: 1, minWidth: 0 }} aria-label="Preview">
            {valid ? <SheetChartView rows={rows} columns={columns} spec={spec} name={name || suggested} /> : <Box sx={{ p: 4, color: "text.secondary", textAlign: "center" }}>Choose what to measure to see the chart.</Box>}
          </Box>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={save} disabled={!valid || saving}>{chart ? "Save changes" : "Save chart"}</Button>
      </DialogActions>
    </Dialog>
  );
}
