import { CollectionsBookmarkOutlined, MenuBookOutlined, SearchRounded } from "@mui/icons-material";
import { Button, Checkbox, Stack, Dialog, DialogActions, DialogContent, DialogTitle, InputAdornment, List, ListItemButton, ListItemIcon, ListItemText, Radio, Skeleton, TextField, Typography } from "@mui/material";
import { useDeferredValue, useState } from "react";
import type { ID } from "../../api/contract";
import { useCollection, useLibrary, useSearch, useUpdateCollection } from "../../api/hooks";
import { useWs } from "../../app/session";
import { useNotify } from "../../components/notify";
import { useRangeSelect } from "../../lib/useRangeSelect";

// Owner request: a post removed from a notebook (or never in it) can be added from the notebook
// itself, and posts selected in search can join a notebook or collection that already exists.
// Added posts go at the end; posts already in it are shown, not added twice.

/** Search posts and add the picked ones to a notebook or collection. */
export function AddPostsDialog({ open, onClose, collectionId, name, postIds }: { open: boolean; onClose: () => void; collectionId: ID; name: string; postIds: ID[] }) {
  const { org, ws } = useWs();
  const [q, setQ] = useState("");
  const query = useDeferredValue(q.trim());
  const [picked, setPicked] = useState<Set<ID>>(new Set()); // kept across searches, so you can pick from several
  const results = useSearch(org.id, ws.id, { q: query || undefined, sort: query ? "relevance" : "newest" }, open);
  const hits = results.data?.pages.flatMap((p) => p.hits) ?? [];
  const update = useUpdateCollection(org.id, ws.id);
  const notify = useNotify();
  const inside = new Set(postIds);
  const shown = hits.map((h) => h.post.id).filter((x) => !inside.has(x));
  const allShown = shown.length > 0 && shown.every((x) => picked.has(x));
  const pick = useRangeSelect(hits.map((h) => h.post.id), picked, setPicked, (x) => !inside.has(x));
  const close = () => (setPicked(new Set()), setQ(""), onClose());
  const add = () =>
    update.mutate(
      { id: collectionId, postIds: [...postIds, ...picked] },
      { onSuccess: () => (notify(`Added ${picked.size} post${picked.size === 1 ? "" : "s"} to “${name}”`, () => update.mutate({ id: collectionId, postIds })), close()), onError: (e) => notify(`Couldn't add: ${e.message}`) },
    );

  return (
    <Dialog open={open} onClose={close} fullWidth maxWidth="sm">
      <DialogTitle>Add posts to “{name}”</DialogTitle>
      <DialogContent>
        <TextField
          fullWidth
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search posts"
          inputProps={{ "aria-label": "Search posts to add" }}
          InputProps={{ startAdornment: <InputAdornment position="start"><SearchRounded fontSize="small" /></InputAdornment> }}
          sx={{ mt: 1, mb: 1 }}
        />
        <Stack direction="row" alignItems="center" spacing={1} sx={{ minHeight: 36 }}>
          <Checkbox
            size="small"
            checked={allShown}
            indeterminate={!allShown && shown.some((x) => picked.has(x))}
            disabled={!shown.length}
            onChange={() => setPicked(new Set(allShown ? [...picked].filter((x) => !shown.includes(x)) : [...picked, ...shown]))}
            inputProps={{ "aria-label": allShown ? "Deselect all shown" : "Select all shown" }}
          />
          <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }}>
            {picked.size ? `${picked.size} picked` : query ? "Select all shown" : "Newest first · Shift-click picks a range"}
          </Typography>
          {picked.size > 0 && <Button size="small" onClick={() => setPicked(new Set())}>Clear</Button>}
        </Stack>
        {results.isPending ? (
          [0, 1, 2].map((i) => <Skeleton key={i} height={48} />)
        ) : !hits.length ? (
          <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>No posts match.</Typography>
        ) : (
          <List dense aria-label="Posts to add" sx={{ maxHeight: 360, overflow: "auto" }}>
            {hits.map(({ post: p }) => {
              const already = inside.has(p.id);
              const on = already || picked.has(p.id);
              return (
                <ListItemButton key={p.id} disabled={already} onClick={(e) => pick(p.id, e.shiftKey)} onMouseDown={(e) => e.shiftKey && e.preventDefault() /* no text selection */}>
                  <ListItemIcon sx={{ minWidth: 36 }}>
                    <Checkbox edge="start" size="small" checked={on} tabIndex={-1} disableRipple inputProps={{ "aria-label": p.title || "Untitled" }} />
                  </ListItemIcon>
                  <ListItemText primary={p.title || "Untitled"} secondary={already ? "Already in it" : p.status === "draft" ? "Draft" : undefined} primaryTypographyProps={{ noWrap: true }} />
                </ListItemButton>
              );
            })}
          </List>
        )}
        {results.hasNextPage && <Button size="small" onClick={() => void results.fetchNextPage()} disabled={results.isFetchingNextPage}>Show more</Button>}
      </DialogContent>
      <DialogActions>
        <Button onClick={close}>Cancel</Button>
        <Button variant="contained" disabled={!picked.size || update.isPending} onClick={add}>
          {picked.size ? `Add ${picked.size}` : "Add"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/** Pick an existing notebook or collection and add posts (from a search selection) to it. */
export function AddToDialog({ postIds, onClose, onDone }: { postIds: ID[]; onClose: () => void; onDone: () => void }) {
  const { org, ws } = useWs();
  const [q, setQ] = useState("");
  const query = useDeferredValue(q.trim());
  const [target, setTarget] = useState<ID | null>(null);
  const notebooks = useLibrary(org.id, ws.id, { kind: "notebook", q: query, limit: 20 });
  const collections = useLibrary(org.id, ws.id, { kind: "collection", q: query, limit: 20 });
  const items = [...(notebooks.data?.pages.flatMap((p) => p.items) ?? []), ...(collections.data?.pages.flatMap((p) => p.items) ?? [])];
  const chosen = useCollection(org.id, ws.id, target);
  const update = useUpdateCollection(org.id, ws.id);
  const notify = useNotify();
  const add = () => {
    const c = chosen.data!;
    const fresh = postIds.filter((x) => !c.postIds.includes(x));
    if (!fresh.length) return (notify(`They're all in “${c.name}” already`), onDone());
    update.mutate(
      { id: c.id, postIds: [...c.postIds, ...fresh] },
      { onSuccess: () => (notify(`Added ${fresh.length} post${fresh.length === 1 ? "" : "s"} to “${c.name}”`, () => update.mutate({ id: c.id, postIds: c.postIds })), onDone()), onError: (e) => notify(`Couldn't add: ${e.message}`) },
    );
  };

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>Add {postIds.length} post{postIds.length === 1 ? "" : "s"} to…</DialogTitle>
      <DialogContent>
        <TextField fullWidth autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a notebook or collection" inputProps={{ "aria-label": "Find a notebook or collection" }} sx={{ mt: 1 }} />
        {notebooks.isPending || collections.isPending ? (
          [0, 1, 2].map((i) => <Skeleton key={i} height={44} />)
        ) : !items.length ? (
          <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>No notebooks or collections{query ? " match" : " yet"}.</Typography>
        ) : (
          <List dense aria-label="Notebooks and collections" sx={{ maxHeight: 320, overflow: "auto" }}>
            {items.map((i) => (
              <ListItemButton key={i.id} selected={target === i.id} onClick={() => setTarget(i.id)}>
                <ListItemIcon sx={{ minWidth: 36 }}>
                  <Radio edge="start" size="small" checked={target === i.id} tabIndex={-1} disableRipple inputProps={{ "aria-label": i.name }} />
                </ListItemIcon>
                <ListItemText primary={i.name} primaryTypographyProps={{ noWrap: true }} />
                {i.kind === "notebook" ? <MenuBookOutlined fontSize="small" sx={{ color: "text.secondary" }} /> : <CollectionsBookmarkOutlined fontSize="small" sx={{ color: "text.secondary" }} />}
              </ListItemButton>
            ))}
          </List>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" disabled={!chosen.data || update.isPending} onClick={add}>Add</Button>
      </DialogActions>
    </Dialog>
  );
}
