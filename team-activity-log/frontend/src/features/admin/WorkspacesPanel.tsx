import { AddRounded, ArchiveOutlined, LockOutlined, PublicOutlined, UnarchiveOutlined } from "@mui/icons-material";
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Chip,
  Drawer,
  FormControlLabel,
  List,
  ListItem,
  ListItemText,
  Paper,
  Stack,
  Switch,
  TextField,
  Typography,
} from "@mui/material";
import { useState } from "react";
import type { User, Workspace } from "../../api/contract";
import { useMembers, useSaveWorkspace, useWorkspaces } from "../../api/hooks";
import { useOrgScope } from "../../app/session";
import { useNotify } from "../../components/notify";
import { ErrorState, UserAvatar } from "../../components/ui";
import { errorMessage } from "../../lib/format";

function WorkspaceDrawer({ ws, onClose }: { ws: Workspace | "new" | null; onClose: () => void }) {
  const { org, me } = useOrgScope()!;
  const save = useSaveWorkspace(org.id);
  const { data: members = [] } = useMembers(org.id);
  const notify = useNotify();
  const editing = ws && ws !== "new" ? ws : undefined;
  const people = members.filter((m) => m.status === "active").map((m) => m.user);
  const initialMembers = editing ? members.filter((m) => m.workspaceIds.includes(editing.id)).map((m) => m.user) : people.filter((u) => u.id === me.user.id);
  const [name, setName] = useState(editing?.name ?? "");
  const [description, setDescription] = useState(editing?.description ?? "");
  const [allOrg, setAllOrg] = useState(editing?.allOrgMembers ?? false);
  const [selected, setSelected] = useState<User[] | null>(null);
  const chosen = selected ?? initialMembers;

  const submit = () =>
    save.mutate(
      { id: editing?.id, name, description, allOrgMembers: allOrg, memberIds: allOrg ? undefined : chosen.map((u) => u.id) },
      { onSuccess: (w) => (notify(editing ? "Workspace saved" : `${w.name} created`), onClose()) },
    );

  return (
    <Drawer anchor="right" open={!!ws} onClose={onClose} slotProps={{ paper: { sx: { width: { xs: "100%", sm: 420 }, p: 3 } } }}>
      <Typography variant="h2" sx={{ mb: 2 }}>{editing ? "Edit workspace" : "New workspace"}</Typography>
      <Stack spacing={2}>
        <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} autoFocus required />
        <TextField label="Description" value={description} onChange={(e) => setDescription(e.target.value)} multiline minRows={2} />
        <FormControlLabel
          control={<Switch checked={allOrg} onChange={(e) => setAllOrg(e.target.checked)} />}
          label={
            <Box>
              <Typography variant="body2">Open to everyone in {org.name}</Typography>
              <Typography variant="caption" color="text.secondary">Otherwise only the members you pick (and admins) can see it.</Typography>
            </Box>
          }
        />
        {!allOrg && (
          <Autocomplete
            multiple
            options={people}
            value={chosen}
            onChange={(_, v) => setSelected(v)}
            getOptionLabel={(u) => u.name}
            isOptionEqualToValue={(a, b) => a.id === b.id}
            renderOption={(props, u) => (
              <li {...props} key={u.id}>
                <UserAvatar user={u} size={22} sx={{ mr: 1 }} />
                {u.name}
              </li>
            )}
            renderInput={(p) => <TextField {...p} label="Members" />}
          />
        )}
        {save.error && <Alert severity="error">{errorMessage(save.error)}</Alert>}
        <Stack direction="row" spacing={1} justifyContent="flex-end">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="contained" onClick={submit} disabled={!name.trim() || save.isPending}>
            {editing ? "Save" : "Create workspace"}
          </Button>
        </Stack>
      </Stack>
    </Drawer>
  );
}

export function WorkspacesPanel() {
  const { org } = useOrgScope()!;
  const workspaces = useWorkspaces(org.id);
  const save = useSaveWorkspace(org.id);
  const notify = useNotify();
  const [editing, setEditing] = useState<Workspace | "new" | null>(null);
  if (workspaces.error) return <ErrorState error={workspaces.error} onRetry={() => workspaces.refetch()} />;
  const all = workspaces.data ?? [];
  const setArchived = (w: Workspace, archived: boolean) =>
    save.mutate(
      { id: w.id, archived },
      { onSuccess: () => notify(archived ? `${w.name} archived. It's read-only and hidden from pickers.` : `${w.name} restored`, () => save.mutate({ id: w.id, archived: !archived })) },
    );
  const section = (title: string, list: Workspace[]) =>
    list.length > 0 && (
      <Box>
        <Typography variant="overline" color="text.secondary">{title}</Typography>
        <Paper variant="outlined">
          <List disablePadding>
            {list.map((w, i) => (
              <ListItem
                key={w.id}
                divider={i < list.length - 1}
                secondaryAction={
                  <Stack direction="row" spacing={0.5}>
                    {!w.archived && <Button size="small" onClick={() => setEditing(w)}>Edit</Button>}
                    <Button size="small" startIcon={w.archived ? <UnarchiveOutlined /> : <ArchiveOutlined />} onClick={() => setArchived(w, !w.archived)}>
                      {w.archived ? "Restore" : "Archive"}
                    </Button>
                  </Stack>
                }
              >
                <ListItemText
                  primary={
                    <Stack direction="row" spacing={1} alignItems="center">
                      <span>{w.name}</span>
                      <Chip size="small" variant="outlined" icon={w.allOrgMembers ? <PublicOutlined /> : <LockOutlined />} label={w.allOrgMembers ? "Everyone" : "Members only"} />
                    </Stack>
                  }
                  secondary={w.description}
                  sx={{ pr: 22 }}
                />
              </ListItem>
            ))}
          </List>
        </Paper>
      </Box>
    );
  return (
    <Stack spacing={2}>
      <Stack direction="row" justifyContent="flex-end">
        <Button variant="contained" startIcon={<AddRounded />} onClick={() => setEditing("new")}>New workspace</Button>
      </Stack>
      {section("Active", all.filter((w) => !w.archived))}
      {section("Archived", all.filter((w) => w.archived))}
      {editing && <WorkspaceDrawer key={editing === "new" ? "new" : editing.id} ws={editing} onClose={() => setEditing(null)} />}
    </Stack>
  );
}
