import { AddchartRounded, DeleteOutlineRounded, EditOutlined, PostAddRounded } from "@mui/icons-material";
import { Box, Button, IconButton, Paper, Stack, Tooltip, Typography } from "@mui/material";
import { useNavigate } from "react-router-dom";
import type { Sheet, SheetCell, SheetChart, SheetColumn } from "../../api/contract";
import { useCreateDraft, useSheetChart } from "../../api/hooks";
import { can, useWs, wsPath } from "../../app/session";
import { useNotify } from "../../components/notify";
import { SheetChartView } from "../../components/SheetChartBlock";
import { EmptyState } from "../../components/ui";
import { errorMessage } from "../../lib/format";
import { uuidv7 } from "../../lib/ids";

/** Start a draft whose first block is this chart, and open it to write around it. */
function useChartToPost() {
  const { org, ws } = useWs();
  const create = useCreateDraft(org.id, ws.id);
  const navigate = useNavigate();
  const notify = useNotify();
  return {
    pending: create.isPending,
    run: (c: SheetChart) =>
      create.mutateAsync({ title: c.name, blocks: [{ id: uuidv7(), type: "chart", sheetId: c.sheetId, chartId: c.id }] }).then(
        (d) => navigate(wsPath(org, ws, `/p/${d.post.id}/edit`)),
        (e) => notify(errorMessage(e)),
      ),
  };
}

function ChartCard({ chart, rows, columns, onEdit }: { chart: SheetChart; rows: SheetCell[][]; columns: SheetColumn[]; onEdit: () => void }) {
  const { org, role } = useWs();
  const notify = useNotify();
  const { remove } = useSheetChart(org.id, chart.sheetId);
  const toPost = useChartToPost();
  const member = can(role, "member");
  return (
    <Paper variant="outlined" component="section" aria-label={chart.name} sx={{ p: { xs: 1.5, sm: 2 }, minWidth: 0 }}>
      <Stack direction="row" alignItems="center" spacing={0.5} sx={{ mb: 1 }}>
        <Typography sx={{ fontWeight: 600, flex: 1, minWidth: 0 }} noWrap>{chart.name}</Typography>
        {member && (
          <>
            <Tooltip title="Edit chart"><IconButton size="small" onClick={onEdit} aria-label={`Edit ${chart.name}`}><EditOutlined fontSize="small" /></IconButton></Tooltip>
            <Tooltip title="Delete chart">
              <IconButton
                size="small"
                aria-label={`Delete ${chart.name}`}
                disabled={remove.isPending}
                onClick={() => remove.mutateAsync(chart.id).then(() => notify("Chart deleted. Posts showing it now say it's no longer available."), (e) => notify(errorMessage(e)))}
              >
                <DeleteOutlineRounded fontSize="small" />
              </IconButton>
            </Tooltip>
          </>
        )}
      </Stack>
      <SheetChartView rows={rows} columns={columns} spec={chart.spec} name={chart.name} />
      {member && (
        <Button size="small" startIcon={<PostAddRounded />} onClick={() => void toPost.run(chart)} disabled={toPost.pending} sx={{ mt: 1 }}>
          Add to a new post
        </Button>
      )}
    </Paper>
  );
}

/** A tab's saved charts. Each stays live: it's drawn from the tab's rows wherever it appears. */
export function ChartsPanel({ sheet, tabId, rows, columns, onNew, onEdit }: { sheet: Sheet; tabId: string; rows: SheetCell[][]; columns: SheetColumn[]; onNew: () => void; onEdit: (c: SheetChart) => void }) {
  const { role } = useWs();
  const charts = sheet.charts.filter((c) => c.tabId === tabId);
  if (!charts.length) {
    return (
      <EmptyState
        icon={<AddchartRounded />}
        title="No charts on this tab yet"
        body="Make a chart from its columns. Saved charts can go in posts, and they stay up to date with the sheet."
        action={can(role, "member") ? <Button variant="contained" startIcon={<AddchartRounded />} onClick={onNew}>New chart</Button> : undefined}
      />
    );
  }
  return (
    <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" }, gap: 2 }}>
      {charts.map((c) => <ChartCard key={c.id} chart={c} rows={rows} columns={columns} onEdit={() => onEdit(c)} />)}
    </Box>
  );
}
