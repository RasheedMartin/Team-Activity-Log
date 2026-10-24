import { ArrowDownwardRounded, ArrowUpwardRounded, CloseRounded, CollectionsBookmarkOutlined, MenuBookOutlined, SlideshowRounded } from "@mui/icons-material";
import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, List, ListItem, ListItemText, Paper, Stack, TextField, Typography } from "@mui/material";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import type { ID, Post } from "../../api/contract";
import { ApiError } from "../../api/client";
import { useCreateCollection, useLibrary } from "../../api/hooks";
import { useWs, wsPath } from "../../app/session";
import { useNotify } from "../../components/notify";
import { KINDS } from "./concepts";
import { formatDay } from "../../lib/dates";
import { errorMessage } from "../../lib/format";

type Action = "present" | "collection" | "notebook";

/** §W5.2: arrange a selection (reorder, skip), then present it, save it, or make a notebook. */
function ArrangeDialog({ posts, action, onClose, onDone }: { posts: Post[]; action: Action; onClose: () => void; onDone: () => void }) {
  const { org, ws } = useWs();
  const navigate = useNavigate();
  const notify = useNotify();
  const create = useCreateCollection(org.id, ws.id);
  const [order, setOrder] = useState(() => (action === "notebook" ? [...posts].sort((a, b) => a.workDate.localeCompare(b.workDate)) : posts));
  const [name, setName] = useState(action === "notebook" ? "Notebook" : "Selection");
  // Catch a duplicate notebook name before submitting (the server enforces it too).
  const similar = useLibrary(org.id, ws.id, { kind: "notebook", q: name.trim(), limit: 20 }, action === "notebook" && !!name.trim());
  const clash = similar.data?.pages[0]?.items.find((c) => c.name.trim().toLowerCase() === name.trim().toLowerCase());
  const move = (i: number, d: -1 | 1) => setOrder((o) => {
    const n = [...o];
    [n[i], n[i + d]] = [n[i + d], n[i]];
    return n;
  });
  const ids = order.map((p) => p.id);
  const go = () => {
    if (action === "present") {
      navigate(`${wsPath(org, ws, "/present")}?posts=${ids.join(",")}`);
      onDone();
      return;
    }
    create.mutate(
      { name, postIds: ids, kind: action === "notebook" ? "notebook" : "saved_selection" },
      {
        onSuccess: (c) => {
          onDone();
          if (action === "notebook") navigate(wsPath(org, ws, `/notebooks/${c.id}`));
          else notify(`Saved “${c.name}” to Collections`);
        },
        onError: (e) => notify(e instanceof ApiError && e.code === "name_taken" ? e.message : errorMessage(e)),
      },
    );
  };
  const title = { present: "Present selection", collection: "New collection", notebook: "New notebook" }[action];
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        {action !== "present" && <TextField fullWidth label="Name" value={name} onChange={(e) => setName(e.target.value)} sx={{ mt: 1, mb: 2 }} autoFocus error={!!clash} />}
        {clash && (
          <Alert severity="warning" sx={{ mb: 2 }} action={<Button size="small" onClick={() => (onDone(), navigate(wsPath(org, ws, `/notebooks/${clash.id}`)))}>Open it</Button>}>
            A notebook named “{clash.name}” already exists. Pick another name or open the existing one.
          </Alert>
        )}
        <Typography variant="caption" color="text.secondary">
          {action === "present" ? "Reorder or skip posts." : `${KINDS[action].blurb} Reorder or skip posts below.`}
        </Typography>
        <List dense sx={{ maxHeight: 360, overflow: "auto" }}>
          {order.map((p, i) => (
            <ListItem
              key={p.id}
              divider
              secondaryAction={
                <Stack direction="row">
                  <IconButton size="small" disabled={i === 0} onClick={() => move(i, -1)} aria-label={`Move ${p.title} up`}><ArrowUpwardRounded fontSize="small" /></IconButton>
                  <IconButton size="small" disabled={i === order.length - 1} onClick={() => move(i, 1)} aria-label={`Move ${p.title} down`}><ArrowDownwardRounded fontSize="small" /></IconButton>
                  <IconButton size="small" onClick={() => setOrder(order.filter((x) => x.id !== p.id))} aria-label={`Skip ${p.title}`}><CloseRounded fontSize="small" /></IconButton>
                </Stack>
              }
            >
              <ListItemText primary={`${i + 1}. ${p.title}`} secondary={formatDay(p.workDate)} sx={{ pr: 12 }} />
            </ListItem>
          ))}
        </List>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" disabled={!order.length || (action !== "present" && !name.trim()) || !!clash || create.isPending} onClick={go}>
          {action === "present" ? "Start presenting" : action === "notebook" ? "Create notebook" : "Save collection"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export function SelectionTray({ selected, posts, onClear }: { selected: ID[]; posts: Map<ID, Post>; onClear: () => void }) {
  const [action, setAction] = useState<Action | null>(null);
  const list = selected.map((id) => posts.get(id)).filter((p): p is Post => !!p);
  if (!selected.length) return null;
  return (
    <>
      <Paper
        elevation={8}
        role="region"
        aria-label="Selection"
        sx={{ position: "fixed", bottom: "calc(16px + env(safe-area-inset-bottom, 0px))", left: "50%", transform: "translateX(-50%)", zIndex: 20, px: 2, py: 1, borderRadius: 2, display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap", maxWidth: "calc(100vw - 32px)" }}
      >
        <Typography variant="body2" sx={{ fontWeight: 600, mr: 1 }}>{selected.length} selected</Typography>
        <Button size="small" variant="contained" startIcon={<SlideshowRounded />} onClick={() => setAction("present")}>Present</Button>
        <Button size="small" startIcon={<CollectionsBookmarkOutlined />} onClick={() => setAction("collection")}>New collection</Button>
        <Button size="small" startIcon={<MenuBookOutlined />} onClick={() => setAction("notebook")}>New notebook</Button>
        <Box sx={{ flex: 1 }} />
        <Button size="small" color="inherit" onClick={onClear}>Clear</Button>
      </Paper>
      {action && <ArrangeDialog posts={list} action={action} onClose={() => setAction(null)} onDone={() => (setAction(null), onClear())} />}
    </>
  );
}
