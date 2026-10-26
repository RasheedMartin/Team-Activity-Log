import { AccountTreeOutlined, AddRounded, CheckRounded, DeleteOutlineRounded, ExpandMoreRounded, SavedSearchRounded } from "@mui/icons-material";
import {
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControlLabel,
  IconButton,
  ListItemIcon,
  ListItemText,
  ListSubheader,
  Menu,
  MenuItem,
  Popover,
  Stack,
  Switch,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import { useEffect, useState } from "react";
import type { Condition, FilterSpec, LibraryItem, SavedView } from "../../api/contract";
import { useDeleteView, useLibrary, useSaveView } from "../../api/hooks";
import { useNotify } from "../../components/notify";
import { KINDS } from "../collections/concepts";
import { FavoriteButton } from "../collections/FavoriteButton";
import { can, useWs } from "../../app/session";
import { formatRange } from "../../lib/dates";
import { clearFilters, isEmptySpec, normalize, specKey } from "../../lib/filterSpec";
import { errorMessage } from "../../lib/format";
import { ConditionEditor } from "./ConditionEditor";
import { defaultCondition, describeCondition, describeGroup, FIELDS, isComplete, type DescribeCtx } from "./fields";

type ListKey = "all" | "any" | "none";

function EditChip({ cond, list, label, onChange, onRemove }: { cond: Condition; list: ListKey; label: string; onChange: (c: Condition) => void; onRemove: () => void }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [draft, setDraft] = useState(cond);
  return (
    <>
      <Chip
        label={label}
        onClick={(e) => (setDraft(cond), setAnchor(e.currentTarget))}
        onDelete={onRemove}
        variant={list === "none" ? "outlined" : "filled"}
        sx={{ maxWidth: 320, textDecoration: list === "none" ? "line-through" : undefined, bgcolor: list === "none" ? undefined : "action.selected" }}
        aria-label={`Filter: ${label}. Click to edit, Delete to remove.`}
      />
      <Popover open={!!anchor} anchorEl={anchor} onClose={() => setAnchor(null)} anchorOrigin={{ vertical: "bottom", horizontal: "left" }}>
        <Stack spacing={1.5} sx={{ p: 2, width: 340 }}>
          <ConditionEditor cond={draft} onChange={setDraft} />
          <Stack direction="row" justifyContent="flex-end" spacing={1}>
            <Button onClick={() => setAnchor(null)}>Cancel</Button>
            <Button variant="contained" disabled={!isComplete(draft)} onClick={() => (onChange(draft), setAnchor(null))}>Apply</Button>
          </Stack>
        </Stack>
      </Popover>
    </>
  );
}

function AddFilter({ spec, setSpec }: { spec: FilterSpec; setSpec: (s: FilterSpec) => void }) {
  const { role } = useWs();
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const [editing, setEditing] = useState<{ anchor: HTMLElement; cond: Condition } | null>(null);
  const groups = [...new Set(FIELDS.map((f) => f.group))];
  const add = (c: Condition) => {
    const kept = (spec.all ?? []).filter((x) => x.field !== c.field);
    setSpec({ ...spec, all: [...kept, c], cursor: undefined });
  };
  return (
    <>
      <Button size="small" startIcon={<AddRounded />} onClick={(e) => setMenu(e.currentTarget)} aria-haspopup="menu">
        Add filter
      </Button>
      <Menu anchorEl={menu} open={!!menu} onClose={() => setMenu(null)} slotProps={{ paper: { sx: { maxHeight: 420 } } }}>
        {groups.flatMap((g) => [
          <ListSubheader key={g} sx={{ lineHeight: "28px" }}>{g}</ListSubheader>,
          ...FIELDS.filter((f) => f.group === g && f.field !== "tag" && f.field !== "author" && (!f.admin || can(role, "admin"))).map((f) => (
            <MenuItem
              key={f.field}
              onClick={() => {
                const anchor = menu!;
                setMenu(null);
                const c = defaultCondition(f);
                if (f.kind === "flag" || f.kind === "visibility") add(c);
                else setEditing({ anchor, cond: c });
              }}
            >
              {f.label}
            </MenuItem>
          )),
        ])}
      </Menu>
      <Popover open={!!editing} anchorEl={editing?.anchor} onClose={() => setEditing(null)}>
        {editing && (
          <Stack spacing={1.5} sx={{ p: 2, width: 340 }}>
            <Typography variant="subtitle2">{FIELDS.find((f) => f.field === editing.cond.field)?.label}</Typography>
            <ConditionEditor cond={editing.cond} onChange={(cond) => setEditing({ ...editing, cond })} />
            <Stack direction="row" justifyContent="flex-end" spacing={1}>
              <Button onClick={() => setEditing(null)}>Cancel</Button>
              <Button variant="contained" disabled={!isComplete(editing.cond)} onClick={() => (add(editing.cond), setEditing(null))}>Add</Button>
            </Stack>
          </Stack>
        )}
      </Popover>
    </>
  );
}

export function SaveViewDialog({ open, onClose, spec, existing, onSaved }: { open: boolean; onClose: () => void; spec: FilterSpec; existing?: SavedView; onSaved: (v: SavedView) => void }) {
  const { org, ws } = useWs();
  const save = useSaveView(org.id, ws.id);
  const [name, setName] = useState(existing?.name ?? "");
  const [shared, setShared] = useState(existing?.shared ?? false);
  const [pinned, setPinned] = useState(existing?.pinned ?? true);
  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{existing ? "Update saved search" : "Save search"}</DialogTitle>
      <DialogContent>
        <Stack spacing={1.5} sx={{ pt: 1 }}>
          <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="Calibration, this quarter" />
          <Typography variant="body2" color="text.secondary">{KINDS.view.blurb}</Typography>
          <FormControlLabel control={<Switch checked={pinned} onChange={(e) => setPinned(e.target.checked)} />} label="Add to Favorites in the sidebar" />
          <FormControlLabel control={<Switch checked={shared} onChange={(e) => setShared(e.target.checked)} />} label={`Share with everyone in ${ws.name}`} />
          {save.error && <Typography color="error" variant="body2">{errorMessage(save.error)}</Typography>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" disabled={!name.trim() || save.isPending} onClick={() => save.mutate({ id: existing?.id, name: name.trim(), shared, pinned, filterSpec: normalize(spec) }, { onSuccess: (v) => (onSaved(v), onClose()) })}>
          Save
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/** The saved-searches menu searches them on the server (a workspace may have hundreds). */
/** Saved searches. `compact`: a small ▾ beside the results title (the search page header). */
export function SavedViewsMenu({ activeId, onApply, compact }: { activeId?: string | null; onApply: (v: LibraryItem) => void; compact?: boolean }) {
  const { org, ws, me, role } = useWs();
  const notify = useNotify();
  const del = useDeleteView(org.id, ws.id);
  const restore = useSaveView(org.id, ws.id);
  const remove = (v: LibraryItem) =>
    del.mutate(v.id, {
      onSuccess: (gone) => notify(`Deleted “${gone.name}”`, () => restore.mutate({ name: gone.name, filterSpec: gone.filterSpec, shared: gone.shared, pinned: v.pinned })),
      onError: (e) => notify(errorMessage(e)),
    });
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q), 150);
    return () => clearTimeout(t);
  }, [q]);
  const lib = useLibrary(org.id, ws.id, { kind: "view", q: debounced, limit: 15 }, !!anchor);
  const views = lib.data?.pages[0]?.items ?? [];
  const total = lib.data?.pages[0]?.total ?? 0;
  return (
    <>
      {compact ? (
        <Tooltip title="Saved searches">
          <IconButton size="small" onClick={(e) => setAnchor(e.currentTarget)} aria-haspopup="menu" aria-label="Saved searches">
            <ExpandMoreRounded fontSize="small" />
          </IconButton>
        </Tooltip>
      ) : (
        <Button size="small" color="inherit" endIcon={<ExpandMoreRounded />} startIcon={<SavedSearchRounded />} onClick={(e) => setAnchor(e.currentTarget)} aria-haspopup="menu" sx={{ whiteSpace: "nowrap" }}>
          Saved searches
        </Button>
      )}
      <Menu anchorEl={anchor} open={!!anchor} onClose={() => setAnchor(null)} slotProps={{ paper: { sx: { width: 340 } } }} autoFocus={false}>
        <Box sx={{ px: 1.5, pb: 1 }} onKeyDown={(e) => e.stopPropagation()}>
          <TextField size="small" fullWidth autoFocus placeholder="Find a saved search" value={q} onChange={(e) => setQ(e.target.value)} inputProps={{ "aria-label": "Find a saved search" }} />
        </Box>
        {lib.isPending && <MenuItem disabled>Loading…</MenuItem>}
        {!lib.isPending && !views.length && <MenuItem disabled>{debounced ? "No saved searches match" : "No saved searches yet"}</MenuItem>}
        {views.map((v) => (
          <MenuItem key={v.id} selected={v.id === activeId} onClick={() => (setAnchor(null), onApply(v))}>
            <ListItemIcon>{v.id === activeId ? <CheckRounded fontSize="small" /> : null}</ListItemIcon>
            <ListItemText primary={v.name} secondary={v.shared ? "Shared" : "Only you"} slotProps={{ primary: { noWrap: true } }} />
            <FavoriteButton kind="view" id={v.id} name={v.name} size="small" />
            {(v.ownerId === me.user.id || can(role, "admin")) && (
              <Tooltip title="Delete saved search">
                <IconButton
                  size="small"
                  aria-label={`Delete ${v.name}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setAnchor(null); // so the Undo in the message underneath can be reached
                    remove(v);
                  }}
                >
                  <DeleteOutlineRounded fontSize="small" />
                </IconButton>
              </Tooltip>
            )}
          </MenuItem>
        ))}
        {total > views.length && (
          <Typography variant="caption" color="text.secondary" sx={{ display: "block", px: 2, pt: 1 }}>
            Showing {views.length} of {total}: type to find the rest.
          </Typography>
        )}
      </Menu>
    </>
  );
}

interface Props {
  spec: FilterSpec;
  setSpec: (s: FilterSpec) => void;
  total?: number;
  view: "posts" | "gallery";
  rangeLabel?: { from?: string; to?: string };
  ctx: DescribeCtx;
  activeView?: SavedView;
  onAdvanced: () => void;
  onSave: () => void;
}

export function ChipsBar({ spec, setSpec, total, view, rangeLabel, ctx, activeView, onAdvanced, onSave }: Props) {
  const lists: ListKey[] = ["all", "any", "none"];
  const replace = (list: ListKey, i: number, c?: Condition) => {
    const arr = [...(spec[list] ?? [])];
    if (c) arr[i] = c;
    else arr.splice(i, 1);
    setSpec({ ...spec, [list]: arr.length ? arr : undefined, cursor: undefined });
  };
  const empty = isEmptySpec(spec);
  const viewChanged = activeView && specKey(activeView.filterSpec) !== specKey(spec);
  return (
    <Stack direction="row" spacing={0.75} alignItems="center" sx={{ flexWrap: "wrap", rowGap: 0.75, minHeight: 32 }}>
      <Typography variant="body2" sx={{ fontWeight: 600, mr: 0.5, fontVariantNumeric: "tabular-nums" }} aria-live="polite">
        {total === undefined ? "…" : `${total.toLocaleString()} ${view === "gallery" ? (total === 1 ? "image" : "images") : total === 1 ? "post" : "posts"}`}
        {rangeLabel && (rangeLabel.from || rangeLabel.to) && (
          <Typography component="span" variant="body2" color="text.secondary"> · {formatRange(rangeLabel.from, rangeLabel.to)}</Typography>
        )}
      </Typography>
      {lists.flatMap((list) =>
        (spec[list] ?? []).map((c, i) => (
          <EditChip
            key={`${list}-${c.field}-${i}`}
            cond={c}
            list={list}
            label={`${list === "any" ? "Any: " : ""}${describeCondition(c, ctx, list === "none")}`}
            onChange={(next) => replace(list, i, next)}
            onRemove={() => replace(list, i)}
          />
        )),
      )}
      {spec.where && (
        <Chip icon={<AccountTreeOutlined />} label={describeGroup(spec.where, ctx)} onClick={onAdvanced} onDelete={() => setSpec({ ...spec, where: undefined, cursor: undefined })} sx={{ maxWidth: 420, bgcolor: "action.selected" }} />
      )}
      <AddFilter spec={spec} setSpec={setSpec} />
      <Button size="small" startIcon={<AccountTreeOutlined />} onClick={onAdvanced}>
        Advanced
      </Button>
      <Box sx={{ flex: 1 }} />
      {!empty && (
        <Button size="small" color="inherit" onClick={() => setSpec(clearFilters(spec))}>
          Clear all
        </Button>
      )}
      {(!empty || viewChanged) && (
        <Button size="small" startIcon={<SavedSearchRounded />} onClick={onSave}>
          {activeView ? (viewChanged ? `Update “${activeView.name}”` : "Saved") : "Save search"}
        </Button>
      )}
      <Divider flexItem orientation="vertical" sx={{ display: "none" }} />
    </Stack>
  );
}
