import { CloseRounded } from "@mui/icons-material";
import { Alert, Autocomplete, Button, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, List, ListItem, ListItemAvatar, ListItemText, MenuItem, TextField, Typography } from "@mui/material";
import { useState } from "react";
import type { Collection, CollectionRole, ID } from "../../api/contract";
import { usePeople, useSetCollectionMembers } from "../../api/hooks";
import { useWs } from "../../app/session";
import { useNotify } from "../../components/notify";
import { UserAvatar } from "../../components/ui";
import { errorMessage } from "../../lib/format";

// Owner request: notebooks are view-only for others unless their owner lets them edit. Everyone in
// the workspace can view; owners pick editors and co-owners here.

const LABEL: Record<Exclude<CollectionRole, "viewer">, string> = { editor: "Editor: writes pages, adds and reorders", owner: "Owner: also shares and deletes" };

export function ShareDialog({ c, open, onClose }: { c: Collection; open: boolean; onClose: () => void }) {
  const { org, ws } = useWs();
  const { data: people = [] } = usePeople(org.id);
  const save = useSetCollectionMembers(org.id, ws.id);
  const notify = useNotify();
  const [list, setList] = useState<{ userId: ID; role: CollectionRole }[]>(() => (c.members ?? []).filter((m) => m.userId !== c.createdBy));
  const byId = new Map(people.map((p) => [p.id, p]));
  const taken = new Set([c.createdBy, ...list.map((m) => m.userId)]);
  const what = c.kind === "notebook" ? "notebook" : "collection";
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Share “{c.name}”</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Everyone in this workspace can view this {what}. Choose who can also edit it.
        </Typography>
        <Autocomplete
          options={people.filter((p) => !taken.has(p.id))}
          getOptionLabel={(p) => p.name}
          value={null}
          onChange={(_, p) => p && setList([...list, { userId: p.id, role: "editor" }])}
          renderInput={(p) => <TextField {...p} label="Add a person" placeholder="Name" />}
          blurOnSelect
          clearOnBlur
        />
        <List dense aria-label="People with access" sx={{ mt: 1 }}>
          <ListItem>
            <ListItemAvatar sx={{ minWidth: 40 }}><UserAvatar user={byId.get(c.createdBy)} size={28} /></ListItemAvatar>
            <ListItemText primary={byId.get(c.createdBy)?.name ?? "Creator"} secondary="Owner (created it)" />
          </ListItem>
          {list.map((m) => (
            <ListItem
              key={m.userId}
              secondaryAction={
                <IconButton edge="end" aria-label={`Remove ${byId.get(m.userId)?.name ?? "person"}`} onClick={() => setList(list.filter((x) => x.userId !== m.userId))}>
                  <CloseRounded fontSize="small" />
                </IconButton>
              }
            >
              <ListItemAvatar sx={{ minWidth: 40 }}><UserAvatar user={byId.get(m.userId)} size={28} /></ListItemAvatar>
              <ListItemText primary={byId.get(m.userId)?.name ?? "Someone"} sx={{ flex: "0 1 auto", mr: 2, minWidth: 0 }} />
              <TextField
                select
                size="small"
                value={m.role}
                onChange={(e) => setList(list.map((x) => (x.userId === m.userId ? { ...x, role: e.target.value as CollectionRole } : x)))}
                inputProps={{ "aria-label": `Role for ${byId.get(m.userId)?.name ?? "person"}` }}
                sx={{ ml: "auto", mr: 4, minWidth: 120 }}
              >
                <MenuItem value="editor">Editor</MenuItem>
                <MenuItem value="owner">Owner</MenuItem>
              </TextField>
            </ListItem>
          ))}
        </List>
        <Typography variant="caption" color="text.secondary" component="div">
          {LABEL.editor}. {LABEL.owner}.
        </Typography>
        {save.error && <Alert severity="error" sx={{ mt: 1.5 }}>{errorMessage(save.error)}</Alert>}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" disabled={save.isPending} onClick={() => save.mutate({ id: c.id, members: list }, { onSuccess: () => (notify("Sharing updated"), onClose()) })}>
          Save
        </Button>
      </DialogActions>
    </Dialog>
  );
}
