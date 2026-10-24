import {
  DeleteOutlineRounded,
  DriveFileRenameOutlineRounded,
  MoreHorizRounded,
  SearchRounded,
} from "@mui/icons-material";
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  InputAdornment,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Paper,
  Skeleton,
  Stack,
  Tab,
  Tabs,
  TextField,
  ToggleButton,
  Typography,
} from "@mui/material";
import { useEffect, useMemo, useState } from "react";
import { Link as RouterLink, useSearchParams } from "react-router-dom";
import type { LibraryItem, LibraryKind } from "../../api/contract";
import { useCreateCollection, useDeleteCollection, useDeleteView, useLibrary, usePeople, useSaveView, useUpdateCollection } from "../../api/hooks";
import { can, useWs, wsPath } from "../../app/session";
import { useNotify } from "../../components/notify";
import { EmptyState, ErrorState, PageHeader } from "../../components/ui";
import { timeAgo } from "../../lib/dates";
import { errorMessage } from "../../lib/format";
import { KINDS } from "./concepts";
import { FavoriteButton } from "./FavoriteButton";
import { libraryHref } from "./libraryLinks";

const TABS: { value: LibraryKind | "all"; label: string }[] = [
  { value: "all", label: "All" },
  ...(["view", "collection", "notebook"] as const).map((k) => ({ value: k, label: KINDS[k].plural })),
];

function RenameDialog({ item, onClose }: { item: LibraryItem; onClose: () => void }) {
  const { org, ws } = useWs();
  const saveView = useSaveView(org.id, ws.id);
  const updateCollection = useUpdateCollection(org.id, ws.id);
  const [name, setName] = useState(item.name);
  const [error, setError] = useState<string | null>(null);
  const save = () => {
    const done = { onSuccess: onClose, onError: (e: Error) => setError(errorMessage(e)) };
    if (item.kind === "view") saveView.mutate({ id: item.id, name: name.trim() }, done);
    else updateCollection.mutate({ id: item.id, name: name.trim() }, done);
  };
  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Rename {KINDS[item.kind].label.toLowerCase()}</DialogTitle>
      <DialogContent>
        <TextField fullWidth autoFocus label="Name" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && name.trim() && save()} error={!!error} helperText={error ?? " "} sx={{ mt: 1 }} />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" disabled={!name.trim() || name.trim() === item.name} onClick={save}>Save</Button>
      </DialogActions>
    </Dialog>
  );
}

function Row({ item, ownerName }: { item: LibraryItem; ownerName?: string }) {
  const { org, ws, me, role } = useWs();
  const notify = useNotify();
  const delView = useDeleteView(org.id, ws.id);
  const delCollection = useDeleteCollection(org.id, ws.id);
  const restoreView = useSaveView(org.id, ws.id);
  const restoreCollection = useCreateCollection(org.id, ws.id);
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const [renaming, setRenaming] = useState(false);
  const mine = item.ownerId === me.user.id;
  const canEdit = mine || can(role, "admin") || (item.kind !== "view" && can(role, "member"));
  const canDelete = mine || can(role, "admin");
  const remove = () => {
    setMenu(null);
    if (item.kind === "view")
      delView.mutate(item.id, {
        onSuccess: (v) => notify(`Deleted “${v.name}”`, () => restoreView.mutate({ name: v.name, filterSpec: v.filterSpec, shared: v.shared, pinned: item.pinned })),
        onError: (e) => notify(errorMessage(e)),
      });
    else
      delCollection.mutate(item.id, {
        onSuccess: (c) => notify(`Deleted “${c.name}” (its posts are kept)`, () => restoreCollection.mutate({ name: c.name, postIds: c.postIds, kind: c.kind, sourceTagId: c.sourceTagId })),
        onError: (e) => notify(errorMessage(e)),
      });
  };
  const meta = [
    KINDS[item.kind].label,
    item.postCount !== undefined ? `${item.postCount} post${item.postCount === 1 ? "" : "s"}` : null,
    `updated ${timeAgo(item.updatedAt)}`,
    ownerName ? `by ${mine ? "you" : ownerName}` : null,
    item.kind === "view" ? (item.shared ? "shared" : "only you") : null,
  ].filter(Boolean);
  return (
    <ListItem
      disablePadding
      divider
      secondaryAction={
        <Stack direction="row" spacing={0.25}>
          <FavoriteButton kind={item.kind} id={item.id} name={item.name} />
          {(canEdit || canDelete) && (
            <IconButton aria-label={`More actions for ${item.name}`} onClick={(e) => setMenu(e.currentTarget)}>
              <MoreHorizRounded fontSize="small" />
            </IconButton>
          )}
          <Menu anchorEl={menu} open={!!menu} onClose={() => setMenu(null)}>
            {canEdit && (
              <MenuItem onClick={() => (setMenu(null), setRenaming(true))}>
                <DriveFileRenameOutlineRounded fontSize="small" sx={{ mr: 1 }} /> Rename
              </MenuItem>
            )}
            {canDelete && (
              <MenuItem onClick={remove} sx={{ color: "error.main" }}>
                <DeleteOutlineRounded fontSize="small" sx={{ mr: 1 }} /> Delete
              </MenuItem>
            )}
          </Menu>
          {renaming && <RenameDialog item={item} onClose={() => setRenaming(false)} />}
        </Stack>
      }
    >
      <ListItemButton component={RouterLink} to={libraryHref(wsPath(org, ws), item)} sx={{ pr: 12 }}>
        <ListItemIcon sx={{ minWidth: 36, color: "text.secondary" }}>{KINDS[item.kind].icon}</ListItemIcon>
        <ListItemText primary={item.name} secondary={meta.join(" · ")} slotProps={{ primary: { noWrap: true, fontWeight: 500 }, secondary: { noWrap: true } }} />
      </ListItemButton>
    </ListItem>
  );
}

/**
 * Library (scale): every saved search, collection, and notebook in the workspace — searchable,
 * filterable, sorted, and paged from the server. The rail only shows your Favorites.
 */
export default function LibraryPage() {
  const { org, ws } = useWs();
  const [params, setParams] = useSearchParams();
  const kind = (params.get("kind") as LibraryKind | null) ?? undefined;
  const sort = params.get("sort") === "name" ? "name" : "recent";
  const mine = params.get("mine") === "1";
  const [q, setQ] = useState(params.get("q") ?? "");
  const [debounced, setDebounced] = useState(q);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q), 200);
    return () => clearTimeout(t);
  }, [q]);
  const lib = useLibrary(org.id, ws.id, { kind, q: debounced, sort, mine });
  const { data: people = [] } = usePeople(org.id);
  const names = useMemo(() => new Map(people.map((p) => [p.id, p.name])), [people]);
  const items = lib.data?.pages.flatMap((p) => p.items) ?? [];
  const counts = lib.data?.pages[0]?.counts;
  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    Object.entries(patch).forEach(([k, v]) => (v === null ? next.delete(k) : next.set(k, v)));
    setParams(next, { replace: true });
  };
  const countFor = (t: LibraryKind | "all") => (counts ? (t === "all" ? counts.view + counts.notebook + counts.collection : counts[t]) : undefined);

  return (
    <Box sx={{ maxWidth: 960, width: "100%", mx: "auto", px: { xs: 1.5, sm: 3 }, py: 3 }}>
      <PageHeader title="Library" />
      <Tabs value={kind ?? "all"} onChange={(_, v) => set({ kind: v === "all" ? null : v })} sx={{ mb: 1.5, minHeight: 40, "& .MuiTab-root": { minHeight: 40, textTransform: "none" } }} variant="scrollable">
        {TABS.map((t) => (
          <Tab key={t.value} value={t.value} label={countFor(t.value) === undefined ? t.label : `${t.label} (${countFor(t.value)})`} />
        ))}
      </Tabs>
      {kind && (
        <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1.5, color: "text.secondary", "& svg": { fontSize: 18 } }}>
          {KINDS[kind].icon}
          <Typography variant="body2">{KINDS[kind].blurb}</Typography>
        </Stack>
      )}
      <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ mb: 2 }}>
        <TextField
          placeholder="Search by name"
          value={q}
          onChange={(e) => (setQ(e.target.value), set({ q: e.target.value || null }))}
          slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchRounded fontSize="small" /></InputAdornment> } }}
          inputProps={{ "aria-label": "Search the library" }}
          sx={{ flex: 1 }}
        />
        <TextField select value={sort} onChange={(e) => set({ sort: e.target.value === "name" ? "name" : null })} sx={{ minWidth: 180 }} inputProps={{ "aria-label": "Sort" }}>
          <MenuItem value="recent">Recently updated</MenuItem>
          <MenuItem value="name">Name</MenuItem>
        </TextField>
        <ToggleButton value="mine" selected={mine} onChange={() => set({ mine: mine ? null : "1" })} size="small" sx={{ textTransform: "none", px: 2 }}>
          Created by me
        </ToggleButton>
      </Stack>
      {lib.isPending ? (
        <Stack spacing={1}>{[0, 1, 2, 3].map((i) => <Skeleton key={i} variant="rounded" height={56} />)}</Stack>
      ) : lib.error ? (
        <ErrorState error={lib.error} onRetry={() => lib.refetch()} />
      ) : !items.length ? (
        <EmptyState
          title={debounced || mine ? "Nothing matches" : "Nothing saved yet"}
          body={debounced || mine ? "Try a different name or clear the filters." : "Save a search, or select posts in Search to make a collection or notebook."}
        />
      ) : (
        <Paper variant="outlined" sx={{ opacity: lib.isPlaceholderData ? 0.6 : 1 }}>
          <List disablePadding aria-label="Library items">
            {items.map((i) => <Row key={`${i.kind}-${i.id}`} item={i} ownerName={names.get(i.ownerId)} />)}
          </List>
        </Paper>
      )}
      {lib.hasNextPage && (
        <Button fullWidth sx={{ mt: 1 }} onClick={() => lib.fetchNextPage()} disabled={lib.isFetchingNextPage}>
          Show more ({(lib.data?.pages[0]?.total ?? 0) - items.length} more)
        </Button>
      )}
      {!!items.length && <Typography variant="caption" color="text.disabled" sx={{ display: "block", mt: 1 }}>{lib.data?.pages[0]?.total} total</Typography>}
    </Box>
  );
}
