import { TableChartOutlined } from "@mui/icons-material";
import { Box, Link, Skeleton, Stack, Typography } from "@mui/material";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link as RouterLink } from "react-router-dom";
import type { ID, SheetChartSpec, SheetColumn, SheetCell } from "../api/contract";
import { useSheet, useSheetRows } from "../api/hooks";
import { useWs, wsPath } from "../app/session";
import { sheetChartData } from "../lib/sheetChart";
import { fmtCell } from "../lib/sheetData";
import { ChartSvg } from "./SlideChart";

/** Width of the element, kept current. */
function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setW(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, w };
}

/** A chart drawn from a tab's rows at the width it's given (height follows, within bounds). */
export function SheetChartView({ rows, columns, spec, name, interactive = true }: { rows: SheetCell[][]; columns: SheetColumn[]; spec: SheetChartSpec; name?: string; interactive?: boolean }) {
  const { ref, w } = useWidth();
  const { data, note } = useMemo(() => sheetChartData(rows, columns, spec), [rows, columns, spec]);
  const h = Math.round(Math.min(380, Math.max(220, w * 0.55)));
  const fs = w < 420 ? 11 : 12;
  const empty = !data.categories.length || data.series.every((s) => s.values.every((v) => v === null));
  return (
    <Box>
      <Box ref={ref} sx={{ position: "relative", height: h, width: "100%" }}>
        {empty ? (
          <Stack alignItems="center" justifyContent="center" sx={{ height: "100%", color: "text.secondary", border: 1, borderStyle: "dashed", borderColor: "divider", borderRadius: 1 }}>
            <Typography variant="body2">Nothing to draw with these columns</Typography>
          </Stack>
        ) : (
          w > 0 && (
            <ChartSvg data={data} chartType={spec.type} w={w} h={h} fontSize={fs} interactive={interactive}>
              <table>
                <caption>{name}</caption>
                <thead><tr><th>{columns.find((c) => c.key === spec.x)?.name}</th>{data.series.map((s) => <th key={s.name}>{s.name}</th>)}</tr></thead>
                <tbody>{data.categories.slice(0, 200).map((c, i) => <tr key={i}><th>{c}</th>{data.series.map((s) => <td key={s.name}>{fmtCell(s.values[i], "number")}</td>)}</tr>)}</tbody>
              </table>
            </ChartSvg>
          )
        )}
      </Box>
      {note && <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5 }}>{note}</Typography>}
    </Box>
  );
}

/**
 * A chart saved on a sheet, in a post (owner request: embed). Always drawn from the sheet's
 * current data; links back to the sheet. If the sheet or chart is deleted, it says so.
 */
export function SheetChartBlock({ sheetId, chartId }: { sheetId: ID; chartId: ID }) {
  const { org, ws } = useWs();
  const sheet = useSheet(org.id, sheetId);
  const chart = sheet.data?.charts.find((c) => c.id === chartId);
  const tab = sheet.data?.tabList.find((t) => t.id === chart?.tabId);
  const rows = useSheetRows(org.id, chart ? sheetId : undefined, chart?.tabId);
  const frame = { p: { xs: 1.5, sm: 2 }, border: 1, borderColor: "divider", borderRadius: 1.5, bgcolor: "background.paper", breakInside: "avoid" } as const;

  if (sheet.isPending || (chart && rows.isPending)) return <Skeleton variant="rounded" height={300} aria-label="Loading chart" />;
  if (!chart || !sheet.data || rows.error) {
    return (
      <Stack direction="row" spacing={1} alignItems="center" sx={{ ...frame, color: "text.secondary" }}>
        <TableChartOutlined fontSize="small" />
        <Typography variant="body2">{rows.error ? "This chart couldn't be loaded." : "This chart is no longer available. Its sheet or the chart was deleted."}</Typography>
      </Stack>
    );
  }
  return (
    <Box component="figure" sx={{ ...frame, m: 0 }} aria-label={`Chart: ${chart.name}`}>
      <Typography sx={{ fontWeight: 600, mb: 1 }}>{chart.name}</Typography>
      <SheetChartView rows={rows.data!.rows} columns={rows.data!.columns} spec={chart.spec} name={chart.name} />
      <Typography component="figcaption" variant="caption" color="text.secondary" sx={{ display: "flex", alignItems: "center", gap: 0.5, mt: 1 }}>
        <TableChartOutlined sx={{ fontSize: 14 }} />
        From{" "}
        <Link component={RouterLink} to={wsPath(org, ws, `/sheets/${sheetId}${sheet.data.tabList.length > 1 && tab ? `?tab=${tab.id}` : ""}`)} underline="hover">
          {sheet.data.name}
          {sheet.data.tabList.length > 1 && tab ? ` · ${tab.name}` : ""}
        </Link>
      </Typography>
    </Box>
  );
}
