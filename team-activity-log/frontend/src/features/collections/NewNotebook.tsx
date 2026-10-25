import { AddRounded } from "@mui/icons-material";
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, TextField } from "@mui/material";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
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
      <Button variant="contained" startIcon={<AddRounded />} onClick={() => (setName(""), create.reset(), setOpen(true))}>New notebook</Button>
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
