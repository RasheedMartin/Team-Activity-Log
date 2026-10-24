import { AccountTreeOutlined, AddRounded, CloseRounded, DeleteOutlineRounded } from "@mui/icons-material";
import { Alert, Box, Button, Drawer, IconButton, ListSubheader, MenuItem, Paper, Stack, TextField, Typography } from "@mui/material";
import { useState } from "react";
import type { Condition, FilterField, FilterGroup } from "../../api/contract";
import { isFilterGroup } from "../../api/contract";
import { can, useWs } from "../../app/session";
import { ConditionEditor } from "./ConditionEditor";
import { defaultCondition, describeGroup, fieldDef, FIELDS, isComplete, type DescribeCtx } from "./fields";

const OP_TEXT: Record<FilterGroup["op"], string> = { and: "ALL of", or: "ANY of", not: "NONE of" };

function FieldSelect({ value, onChange }: { value: FilterField; onChange: (f: FilterField) => void }) {
  const { role } = useWs();
  const groups = [...new Set(FIELDS.map((f) => f.group))];
  return (
    <TextField select size="small" value={value} onChange={(e) => onChange(e.target.value as FilterField)} sx={{ minWidth: 190 }} inputProps={{ "aria-label": "Field" }}>
      {groups.flatMap((g) => [
        <ListSubheader key={g}>{g}</ListSubheader>,
        ...FIELDS.filter((f) => f.group === g && (!f.admin || can(role, "admin"))).map((f) => (
          <MenuItem key={f.field} value={f.field}>{f.label}</MenuItem>
        )),
      ])}
    </TextField>
  );
}

function GroupEditor({ group, onChange, onRemove, depth }: { group: FilterGroup; onChange: (g: FilterGroup) => void; onRemove?: () => void; depth: number }) {
  const setItem = (i: number, item: Condition | FilterGroup) => onChange({ ...group, items: group.items.map((x, j) => (j === i ? item : x)) });
  const removeItem = (i: number) => onChange({ ...group, items: group.items.filter((_, j) => j !== i) });
  return (
    <Paper variant="outlined" sx={{ p: 1.5, bgcolor: depth % 2 ? "background.default" : "background.paper", borderLeft: 3, borderLeftColor: depth ? "primary.light" : "primary.main" }}>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
        <Typography variant="body2">Match</Typography>
        <TextField select size="small" value={group.op} onChange={(e) => onChange({ ...group, op: e.target.value as FilterGroup["op"] })} inputProps={{ "aria-label": "Group operator" }}>
          {(["and", "or", "not"] as const).map((o) => <MenuItem key={o} value={o}>{OP_TEXT[o]}</MenuItem>)}
        </TextField>
        <Typography variant="body2" sx={{ flex: 1 }}>these</Typography>
        {onRemove && (
          <IconButton size="small" onClick={onRemove} aria-label="Remove group">
            <DeleteOutlineRounded fontSize="small" />
          </IconButton>
        )}
      </Stack>
      <Stack spacing={1}>
        {group.items.map((item, i) =>
          isFilterGroup(item) ? (
            <GroupEditor key={i} group={item} depth={depth + 1} onChange={(g) => setItem(i, g)} onRemove={() => removeItem(i)} />
          ) : (
            <Stack key={i} direction={{ xs: "column", sm: "row" }} spacing={1} alignItems={{ sm: "flex-start" }} sx={{ p: 1, borderRadius: 1, bgcolor: "action.hover" }}>
              <FieldSelect value={item.field} onChange={(f) => setItem(i, defaultCondition(fieldDef(f)!))} />
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <ConditionEditor cond={item} onChange={(c) => setItem(i, c)} />
              </Box>
              <IconButton size="small" onClick={() => removeItem(i)} aria-label="Remove condition">
                <CloseRounded fontSize="small" />
              </IconButton>
            </Stack>
          ),
        )}
      </Stack>
      <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
        <Button size="small" startIcon={<AddRounded />} onClick={() => onChange({ ...group, items: [...group.items, defaultCondition(FIELDS[0])] })}>
          Condition
        </Button>
        {depth < 3 && (
          <Button size="small" startIcon={<AccountTreeOutlined />} onClick={() => onChange({ ...group, items: [...group.items, { op: "or", items: [defaultCondition(FIELDS[0])] }] })}>
            Group
          </Button>
        )}
      </Stack>
    </Paper>
  );
}

/** Drop incomplete conditions and empty groups before applying. */
function prune(g: FilterGroup): FilterGroup | null {
  const items = g.items.map((x) => (isFilterGroup(x) ? prune(x) : isComplete(x) ? x : null)).filter((x): x is Condition | FilterGroup => !!x);
  return items.length ? { ...g, items } : null;
}

export function AdvancedFilters({ open, onClose, value, onApply, ctx }: { open: boolean; onClose: () => void; value?: FilterGroup; onApply: (g?: FilterGroup) => void; ctx: DescribeCtx }) {
  const [draft, setDraft] = useState<FilterGroup>(value ?? { op: "and", items: [defaultCondition(FIELDS[0])] });
  const pruned = prune(draft);
  return (
    <Drawer anchor="right" open={open} onClose={onClose} slotProps={{ paper: { sx: { width: { xs: "100%", md: 640 } } } }}>
      <Stack direction="row" alignItems="center" sx={{ px: 2, py: 1.5, borderBottom: 1, borderColor: "divider" }}>
        <Box sx={{ flex: 1 }}>
          <Typography variant="h3">Advanced filters</Typography>
          <Typography variant="caption" color="text.secondary">Nested AND / OR / NOT groups. Combined with the sidebar filters and the search text.</Typography>
        </Box>
        <IconButton onClick={onClose} aria-label="Close advanced filters"><CloseRounded /></IconButton>
      </Stack>
      <Box sx={{ p: 2, overflow: "auto", flex: 1 }}>
        <GroupEditor group={draft} onChange={setDraft} depth={0} />
        {pruned && (
          <Alert severity="info" icon={false} sx={{ mt: 2, fontFamily: "'IBM Plex Mono', monospace", fontSize: "0.78rem" }}>
            {describeGroup(pruned, ctx)}
          </Alert>
        )}
      </Box>
      <Stack direction="row" spacing={1} sx={{ p: 2, borderTop: 1, borderColor: "divider" }}>
        <Button color="inherit" onClick={() => (onApply(undefined), onClose())} disabled={!value}>Remove advanced filters</Button>
        <Box sx={{ flex: 1 }} />
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={() => (onApply(pruned ?? undefined), onClose())}>Apply</Button>
      </Stack>
    </Drawer>
  );
}
