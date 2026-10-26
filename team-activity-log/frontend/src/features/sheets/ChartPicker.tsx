import { ArrowBackRounded, InsertChartOutlined, TableChartOutlined } from "@mui/icons-material";
import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, List, ListItemButton, ListItemIcon, ListItemText, Skeleton, Typography } from "@mui/material";
import { useState } from "react";
import type { ID, SheetChart } from "../../api/contract";
import { useSheet, useSheets } from "../../api/hooks";
import { useWs } from "../../app/session";

const plural = (n: number, one: string) => `${n.toLocaleString()} ${one}${n === 1 ? "" : "s"}`;

/** In the composer: choose a sheet, then one of its saved charts, to put in the post. */
export function ChartPicker({ onPick, onClose }: { onPick: (c: SheetChart) => void; onClose: () => void }) {
  const { org, ws } = useWs();
  const sheets = useSheets(org.id, ws.id);
  const [sheetId, setSheetId] = useState<ID | null>(null);
  const sheet = useSheet(org.id, sheetId ?? undefined);
  const tabName = (id: ID) => (sheet.data && sheet.data.tabList.length > 1 ? sheet.data.tabList.find((t) => t.id === id)?.name : undefined);

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth aria-labelledby="chart-picker-title">
      <DialogTitle id="chart-picker-title">{sheetId ? (sheet.data?.name ?? "Charts") : "Add a chart from a sheet"}</DialogTitle>
      <DialogContent dividers sx={{ p: 0, minHeight: 240 }}>
        {!sheetId ? (
          sheets.isPending ? (
            <Box sx={{ p: 2 }}>{[0, 1, 2].map((i) => <Skeleton key={i} height={48} />)}</Box>
          ) : !sheets.data?.length ? (
            <Typography color="text.secondary" sx={{ p: 3 }}>No sheets in this workspace yet. Import a spreadsheet on the Sheets page, make a chart, then add it here.</Typography>
          ) : (
            <List aria-label="Sheets">
              {sheets.data.map((s) => (
                <ListItemButton key={s.id} onClick={() => setSheetId(s.id)}>
                  <ListItemIcon sx={{ minWidth: 36 }}><TableChartOutlined /></ListItemIcon>
                  <ListItemText primary={s.name} secondary={plural(s.rows, "row")} slotProps={{ primary: { noWrap: true } }} />
                </ListItemButton>
              ))}
            </List>
          )
        ) : sheet.isPending ? (
          <Box sx={{ p: 2 }}>{[0, 1].map((i) => <Skeleton key={i} height={48} />)}</Box>
        ) : !sheet.data?.charts.length ? (
          <Typography color="text.secondary" sx={{ p: 3 }}>This sheet has no charts yet. Open it from Sheets and choose Charts → New chart.</Typography>
        ) : (
          <List aria-label="Charts">
            {sheet.data.charts.map((c) => (
              <ListItemButton key={c.id} onClick={() => onPick(c)}>
                <ListItemIcon sx={{ minWidth: 36 }}><InsertChartOutlined /></ListItemIcon>
                <ListItemText primary={c.name} secondary={tabName(c.tabId)} slotProps={{ primary: { noWrap: true } }} />
              </ListItemButton>
            ))}
          </List>
        )}
      </DialogContent>
      <DialogActions>
        {sheetId && <Button startIcon={<ArrowBackRounded />} onClick={() => setSheetId(null)} sx={{ mr: "auto" }}>All sheets</Button>}
        <Button onClick={onClose}>Cancel</Button>
      </DialogActions>
    </Dialog>
  );
}
