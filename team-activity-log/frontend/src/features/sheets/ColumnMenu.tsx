import { AddRounded, ArrowDownwardRounded, ArrowUpwardRounded, CheckRounded, CloseRounded, DeleteOutlineRounded } from "@mui/icons-material";
import { Box, Button, Divider, ListItemIcon, Menu, MenuItem, Stack, TextField, Typography } from "@mui/material";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { SheetCell, SheetColumn, SheetColumnOp } from "../../api/contract";
import { columnStats, fmtCell, type Sort } from "../../lib/sheetData";
import { TYPE_ICON, TYPE_NAME } from "./columnTypes";

const TYPES: SheetColumn["type"][] = ["number", "date", "category", "text"];

/**
 * A column's menu: sort it, what's in it (for the rows the filter shows), and, for people who
 * can edit, rename it, add a column after it, change its type, or delete it.
 */
export function ColumnMenu({
  anchor,
  col,
  rows,
  shown,
  sort,
  editable,
  onSort,
  onEdit,
  onClose,
}: {
  anchor: HTMLElement | null;
  col: SheetColumn | null;
  rows: SheetCell[][];
  shown: number[];
  sort: Sort;
  editable: boolean;
  onSort: (s: Sort) => void;
  onEdit: (op: SheetColumnOp) => void;
  onClose: () => void;
}) {
  const stats = useMemo(() => (col ? columnStats(rows, col, shown) : null), [rows, col, shown]);
  const [name, setName] = useState("");
  useEffect(() => setName(col?.name ?? ""), [col]);
  if (!col || !stats) return null;
  const line = (label: string, value: ReactNode) => (
    <Stack direction="row" justifyContent="space-between" spacing={3} key={label}>
      <Typography variant="body2" color="text.secondary">{label}</Typography>
      <Typography variant="body2" sx={{ fontVariantNumeric: "tabular-nums", textAlign: "right", minWidth: 0 }} noWrap>{value}</Typography>
    </Stack>
  );
  const active = sort?.key === col.key ? sort.dir : null;
  const rename = () => {
    if (name.trim() && name.trim() !== col.name) onEdit({ op: "rename", key: col.key, name: name.trim() });
    onClose();
  };
  return (
    <Menu anchorEl={anchor} open={!!anchor} onClose={onClose} slotProps={{ paper: { sx: { minWidth: 260, maxWidth: 320 } } }}>
      <Box sx={{ px: 2, pt: 0.5, pb: 1 }} onKeyDown={(e) => e.stopPropagation() /* typing a name isn't menu navigation */}>
        {editable ? (
          <Stack direction="row" spacing={1} alignItems="center">
            <TextField size="small" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && rename()} inputProps={{ "aria-label": "Column name" }} sx={{ flex: 1 }} />
            <Button size="small" onClick={rename} disabled={!name.trim() || name.trim() === col.name}>Rename</Button>
          </Stack>
        ) : (
          <Typography sx={{ fontWeight: 600 }} noWrap>{col.name}</Typography>
        )}
        <Typography variant="caption" color="text.secondary">{TYPE_NAME[col.type]}{col.auto ? " (follows what's typed in)" : ""}</Typography>
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
      {editable && [
        <Divider key="d1" />,
        <Typography key="t" variant="caption" color="text.secondary" sx={{ px: 2, display: "block" }}>Holds</Typography>,
        ...TYPES.map((t) => (
          <MenuItem key={t} dense selected={col.type === t && !col.auto} onClick={() => (col.type !== t || col.auto ? onEdit({ op: "type", key: col.key, type: t }) : undefined, onClose())}>
            <ListItemIcon>{col.type === t ? <CheckRounded fontSize="small" /> : <Box sx={{ display: "flex", color: "text.disabled" }}>{TYPE_ICON[t]}</Box>}</ListItemIcon>
            {TYPE_NAME[t]}
          </MenuItem>
        )),
        <Divider key="d2" />,
        <MenuItem key="add" onClick={() => (onEdit({ op: "add", after: col.key }), onClose())}>
          <ListItemIcon><AddRounded fontSize="small" /></ListItemIcon>
          Insert column to the right
        </MenuItem>,
        <MenuItem key="del" onClick={() => (onEdit({ op: "delete", key: col.key }), onClose())} sx={{ color: "error.main" }}>
          <ListItemIcon><DeleteOutlineRounded fontSize="small" color="error" /></ListItemIcon>
          Delete column
        </MenuItem>,
      ]}
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
