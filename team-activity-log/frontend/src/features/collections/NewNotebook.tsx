import { AddRounded, UploadFileOutlined } from "@mui/icons-material";
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, TextField } from "@mui/material";
import { useState } from "react";
import { Link as RouterLink, useNavigate } from "react-router-dom";
import { ApiError } from "../../api/client";
import { useCreateCollection } from "../../api/hooks";
import { useWs, wsPath } from "../../app/session";
import { errorMessage } from "../../lib/format";

/** "New notebook": an empty notebook to write pages in, or pull posts into (owner request). */
export function NewNotebookButton() {
  const { org, ws } = useWs();
  const create = useCreateCollection(org.id, ws.id);
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const clash = create.error instanceof ApiError && create.error.code === "name_taken" ? (create.error.details as { existingId?: string })?.existingId : undefined;
  const submit = () => create.mutate({ name: name.trim(), kind: "notebook", postIds: [] }, { onSuccess: (c) => (setOpen(false), navigate(wsPath(org, ws, `/notebooks/${c.id}`))) });
  return (
    <>
      <Button variant="outlined" startIcon={<AddRounded />} onClick={() => (setName(""), create.reset(), setOpen(true))}>New notebook</Button>
      <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="xs">
        <DialogTitle>New notebook</DialogTitle>
        <DialogContent>
          <TextField fullWidth autoFocus label="Name" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && name.trim() && submit()} sx={{ mt: 1 }} placeholder="e.g. March cooldown run" />
          {create.error && (
            <Alert severity={clash ? "warning" : "error"} sx={{ mt: 2 }} action={clash ? <Button size="small" onClick={() => (setOpen(false), navigate(wsPath(org, ws, `/notebooks/${clash}`)))}>Open it</Button> : undefined}>
              {errorMessage(create.error)}
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>Cancel</Button>
          <Button variant="contained" disabled={!name.trim() || create.isPending} onClick={submit}>Create</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}

/** "New deck" (owner request: a deck without PowerPoint): an empty deck to add slides to. */
export function NewDeckButton() {
  const { org, ws } = useWs();
  const create = useCreateCollection(org.id, ws.id);
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const submit = () => create.mutate({ name: name.trim(), kind: "deck", postIds: [] }, { onSuccess: (c) => (setOpen(false), navigate(wsPath(org, ws, `/collections/${c.id}`))) });
  return (
    <>
      <Button variant="outlined" startIcon={<AddRounded />} onClick={() => (setName(""), create.reset(), setOpen(true))}>New deck</Button>
      <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="xs">
        <DialogTitle>New deck</DialogTitle>
        <DialogContent>
          <TextField fullWidth autoFocus label="Name" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && name.trim() && submit()} sx={{ mt: 1 }} placeholder="e.g. Q3 detector review" />
          {create.error && <Alert severity="error" sx={{ mt: 2 }}>{errorMessage(create.error)}</Alert>}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>Cancel</Button>
          <Button variant="contained" disabled={!name.trim() || create.isPending} onClick={submit}>Create</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}

// Section headers share one pattern (owner request): import first and filled, "New …" after it,
// outlined. Decks: Import slides · New deck. Notebooks: Import a document · New notebook.
// Sheets: Import a spreadsheet.

/** Imports start where their results live (owner decision): slides on Decks, PDF and Word on
 *  Notebooks. Same import flow, scoped by `for`. */
export function ImportSlidesButton() {
  const { org, ws } = useWs();
  return (
    <Button variant="contained" startIcon={<UploadFileOutlined />} component={RouterLink} to={`${wsPath(org, ws, "/import")}?for=slides`}>
      Import slides
    </Button>
  );
}
export function ImportDocumentButton() {
  const { org, ws } = useWs();
  return (
    <Button variant="contained" startIcon={<UploadFileOutlined />} component={RouterLink} to={`${wsPath(org, ws, "/import")}?for=document`}>
      Import a document
    </Button>
  );
}
