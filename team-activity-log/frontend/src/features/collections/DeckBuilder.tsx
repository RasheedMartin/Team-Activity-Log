import { AddRounded, DeleteOutlineRounded, DriveFileRenameOutlineRounded, MoreVertRounded, UploadFileOutlined } from "@mui/icons-material";
import { Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, IconButton, ListItemIcon, Menu, MenuItem, TextField, Typography } from "@mui/material";
import { useState } from "react";
import { Link as RouterLink, useNavigate } from "react-router-dom";
import type { Collection } from "../../api/contract";
import { useCreateDraft, useDeleteCollection, useUpdateCollection } from "../../api/hooks";
import type { Origin } from "../../app/origin";
import { useWs, wsPath } from "../../app/session";
import { useNotify } from "../../components/notify";
import { errorMessage } from "../../lib/format";
import { uuidv7 } from "../../lib/ids";
import { LAYOUTS, newDesign } from "../../lib/slideLayouts";

// A deck built in the app (owner request: a deck without PowerPoint). Each slide is a post with a
// designed slide, so it's searchable, discussable, and presented or downloaded like an imported deck.

/** Add a slide from a layout: a draft at the end of the deck, opened in the slide editor. */
export function AddSlideButton({ deck, origin }: { deck: Collection; origin: Origin }) {
  const { org, ws } = useWs();
  const create = useCreateDraft(org.id, ws.id);
  const navigate = useNavigate();
  const notify = useNotify();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  return (
    <>
      <Button variant="outlined" startIcon={<AddRounded />} onClick={(e) => setAnchor(e.currentTarget)} disabled={create.isPending} aria-haspopup="menu">
        Add slide
      </Button>
      <Menu anchorEl={anchor} open={!!anchor} onClose={() => setAnchor(null)}>
        {LAYOUTS.map((l) => (
          <MenuItem
            key={l.id}
            onClick={() => {
              setAnchor(null);
              create.mutate(
                { blocks: [{ id: uuidv7(), type: "slide", design: newDesign(l.id) }], collectionId: deck.id },
                { onSuccess: (d) => navigate(wsPath(org, ws, `/p/${d.post.id}/edit`), { state: origin }), onError: (e) => notify(errorMessage(e)) },
              );
            }}
          >
            {l.label}
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}

/** Rename, import more slides, delete. */
export function DeckMenu({ deck }: { deck: Collection }) {
  const { org, ws } = useWs();
  const navigate = useNavigate();
  const notify = useNotify();
  const update = useUpdateCollection(org.id, ws.id);
  const remove = useDeleteCollection(org.id, ws.id);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(deck.name);
  const [deleting, setDeleting] = useState(false);
  const [withSlides, setWithSlides] = useState(true);
  const base = wsPath(org, ws);
  return (
    <>
      <IconButton aria-label="More deck actions" onClick={(e) => setAnchor(e.currentTarget)}><MoreVertRounded /></IconButton>
      <Menu anchorEl={anchor} open={!!anchor} onClose={() => setAnchor(null)}>
        <MenuItem onClick={() => (setAnchor(null), setName(deck.name), setRenaming(true))}>
          <ListItemIcon><DriveFileRenameOutlineRounded fontSize="small" /></ListItemIcon>Rename
        </MenuItem>
        <MenuItem component={RouterLink} to={`${base}/import?for=slides&into=${deck.id}`} onClick={() => setAnchor(null)}>
          <ListItemIcon><UploadFileOutlined fontSize="small" /></ListItemIcon>Import slides into this deck
        </MenuItem>
        <MenuItem onClick={() => (setAnchor(null), setDeleting(true))} sx={{ color: "error.main" }}>
          <ListItemIcon><DeleteOutlineRounded fontSize="small" color="error" /></ListItemIcon>Delete deck…
        </MenuItem>
      </Menu>

      <Dialog open={renaming} onClose={() => setRenaming(false)} fullWidth maxWidth="xs">
        <DialogTitle>Rename deck</DialogTitle>
        <DialogContent>
          <TextField fullWidth autoFocus label="Name" value={name} onChange={(e) => setName(e.target.value)} sx={{ mt: 1 }} />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRenaming(false)}>Cancel</Button>
          <Button variant="contained" disabled={!name.trim() || update.isPending} onClick={() => update.mutate({ id: deck.id, name: name.trim() }, { onSuccess: () => setRenaming(false), onError: (e) => notify(errorMessage(e)) })}>
            Save
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={deleting} onClose={() => setDeleting(false)} fullWidth maxWidth="xs">
        <DialogTitle>Delete “{deck.name}”?</DialogTitle>
        <DialogContent>
          <FormControlLabel control={<Checkbox checked={withSlides} onChange={(e) => setWithSlides(e.target.checked)} />} label="Also delete my slides in it" />
          <Typography variant="body2" color="text.secondary">
            {withSlides ? "Your slides go to the recycle bin. Posts other people added stay where they are." : "The slides stay as posts; only the deck goes."}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleting(false)}>Cancel</Button>
          <Button
            color="error"
            variant="contained"
            disabled={remove.isPending}
            onClick={() =>
              remove.mutateAsync({ id: deck.id, deleteMyPosts: withSlides }).then(
                () => (notify(`Deleted “${deck.name}”`), navigate(`${base}/collections`)),
                (e) => notify(errorMessage(e)),
              )
            }
          >
            Delete
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
