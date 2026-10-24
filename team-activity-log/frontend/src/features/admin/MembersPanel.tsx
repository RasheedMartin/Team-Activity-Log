import { LinkRounded, MoreHorizRounded, PersonAddAlt1Rounded, SearchRounded, UploadFileOutlined } from "@mui/icons-material";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  InputAdornment,
  ListItemText,
  Menu,
  MenuItem,
  Paper,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import { useMemo, useState } from "react";
import type { ID, Membership, OrgRole, Workspace } from "../../api/contract";
import {
  useCreateInviteLink,
  useInviteAction,
  useInviteLinks,
  useInvites,
  useMembers,
  useRemoveMember,
  useRevokeInviteLink,
  useSendInvites,
  useTransferOwnership,
  useUpdateMember,
  useWorkspaces,
} from "../../api/hooks";
import { can, useOrgScope } from "../../app/session";
import { useNotify } from "../../components/notify";
import { EmptyState, ErrorState, UserAvatar } from "../../components/ui";
import { formatDay, timeAgo } from "../../lib/dates";
import { errorMessage } from "../../lib/format";

const ROLES: OrgRole[] = ["owner", "admin", "member", "viewer"];
const ROLE_HELP: Record<OrgRole, string> = {
  owner: "Everything, including transferring ownership",
  admin: "Manage members and workspaces, edit or hide any post",
  member: "Write, comment, react, import",
  viewer: "Read and react",
};

function WorkspacePicker({ value, onChange, workspaces, disabled }: { value: ID[]; onChange: (ids: ID[]) => void; workspaces: Workspace[]; disabled?: boolean }) {
  const explicit = workspaces.filter((w) => !w.allOrgMembers && !w.archived);
  if (!explicit.length) return <Typography variant="caption" color="text.secondary">All workspaces</Typography>;
  return (
    <Select
      multiple
      size="small"
      displayEmpty
      disabled={disabled}
      value={value.filter((id) => explicit.some((w) => w.id === id))}
      onChange={(e) => onChange(e.target.value as ID[])}
      renderValue={(ids) => (ids.length ? ids.map((id) => explicit.find((w) => w.id === id)?.name).join(", ") : <Typography variant="body2" color="text.secondary">Open workspaces only</Typography>)}
      sx={{ minWidth: 180, maxWidth: 260, fontSize: "0.85rem" }}
      inputProps={{ "aria-label": "Private workspaces" }}
    >
      {explicit.map((w) => (
        <MenuItem key={w.id} value={w.id}>
          <Checkbox size="small" checked={value.includes(w.id)} sx={{ p: 0.5, mr: 1 }} />
          <ListItemText primary={w.name} />
        </MenuItem>
      ))}
    </Select>
  );
}

function Confirm({ open, title, body, action, danger, onClose, onConfirm, pending }: { open: boolean; title: string; body: string; action: string; danger?: boolean; onClose: () => void; onConfirm: () => void; pending?: boolean }) {
  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        <Typography variant="body2">{body}</Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" color={danger ? "error" : "primary"} onClick={onConfirm} disabled={pending}>
          {action}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function MemberRow({ m, workspaces, myRole, isMe }: { m: Membership; workspaces: Workspace[]; myRole: OrgRole; isMe: boolean }) {
  const { org } = useOrgScope()!;
  const update = useUpdateMember(org.id);
  const remove = useRemoveMember(org.id);
  const transfer = useTransferOwnership(org.id);
  const notify = useNotify();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [confirm, setConfirm] = useState<"remove" | "transfer" | null>(null);
  const editable = !isMe && (myRole === "owner" || m.role !== "owner");
  const deactivated = m.status === "deactivated";
  const run = (p: Promise<unknown>, done?: string, undo?: () => void) =>
    p.then(() => done && notify(done, undo)).catch((e) => notify(errorMessage(e)));

  return (
    <TableRow hover sx={{ opacity: deactivated ? 0.55 : 1 }}>
      <TableCell>
        <Stack direction="row" spacing={1.25} alignItems="center">
          <UserAvatar user={m.user} size={28} />
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>
              {m.user.name} {isMe && <Typography component="span" variant="caption" color="text.secondary">(you)</Typography>}
            </Typography>
            <Typography variant="caption" color="text.secondary" noWrap component="div">
              {m.user.email}
            </Typography>
          </Box>
          {deactivated && <Chip label="Deactivated" size="small" variant="outlined" />}
        </Stack>
      </TableCell>
      <TableCell>
        <Select
          size="small"
          value={m.role}
          disabled={!editable || deactivated}
          onChange={(e) => run(update.mutateAsync({ userId: m.user.id, role: e.target.value as OrgRole }), `${m.user.name} is now ${e.target.value}`)}
          renderValue={(r) => r}
          sx={{ fontSize: "0.85rem", minWidth: 110 }}
          inputProps={{ "aria-label": `Role for ${m.user.name}` }}
        >
          {ROLES.filter((r) => r !== "owner" || m.role === "owner").map((r) => (
            <MenuItem key={r} value={r}>
              <ListItemText primary={r} secondary={ROLE_HELP[r]} slotProps={{ secondary: { variant: "caption" } }} />
            </MenuItem>
          ))}
        </Select>
      </TableCell>
      <TableCell>
        <WorkspacePicker
          value={m.workspaceIds}
          workspaces={workspaces}
          disabled={!editable || deactivated || can(m.role, "admin")}
          onChange={(ids) => run(update.mutateAsync({ userId: m.user.id, workspaceIds: ids }))}
        />
      </TableCell>
      <TableCell align="right">
        {editable && (
          <IconButton aria-label={`Actions for ${m.user.name}`} onClick={(e) => setAnchor(e.currentTarget)}>
            <MoreHorizRounded fontSize="small" />
          </IconButton>
        )}
        <Menu anchorEl={anchor} open={!!anchor} onClose={() => setAnchor(null)}>
          {deactivated ? (
            <MenuItem onClick={() => (setAnchor(null), run(update.mutateAsync({ userId: m.user.id, status: "active" }), `${m.user.name} reactivated`))}>Reactivate</MenuItem>
          ) : (
            <MenuItem
              onClick={() => {
                setAnchor(null);
                run(update.mutateAsync({ userId: m.user.id, status: "deactivated" }), `${m.user.name} deactivated. Their posts stay attributed.`, () => update.mutate({ userId: m.user.id, status: "active" }));
              }}
            >
              Deactivate
            </MenuItem>
          )}
          {myRole === "owner" && !deactivated && <MenuItem onClick={() => (setAnchor(null), setConfirm("transfer"))}>Transfer ownership…</MenuItem>}
          <MenuItem sx={{ color: "error.main" }} onClick={() => (setAnchor(null), setConfirm("remove"))}>
            Remove from organization…
          </MenuItem>
        </Menu>
        <Confirm
          open={confirm === "remove"}
          title={`Remove ${m.user.name}?`}
          body="They lose access to every workspace in this organization. Their posts and comments stay, attributed to them. To keep the door open, deactivate instead."
          action="Remove"
          danger
          pending={remove.isPending}
          onClose={() => setConfirm(null)}
          onConfirm={() => run(remove.mutateAsync(m.user.id), `${m.user.name} removed`).finally(() => setConfirm(null))}
        />
        <Confirm
          open={confirm === "transfer"}
          title={`Make ${m.user.name} the owner?`}
          body="They become an owner and you become an admin. Only an owner can undo this."
          action="Transfer ownership"
          pending={transfer.isPending}
          onClose={() => setConfirm(null)}
          onConfirm={() => run(transfer.mutateAsync(m.user.id), "Ownership transferred").finally(() => setConfirm(null))}
        />
      </TableCell>
    </TableRow>
  );
}

// ---- invite dialog (§W1.4) ----

interface Draft {
  email: string;
  name?: string;
  role: OrgRole;
  workspaceIds: ID[];
}

function parseInviteInput(text: string, role: OrgRole, workspaceIds: ID[], workspaces: Workspace[]): Draft[] {
  const lines = text.split(/\n/).map((l) => l.trim()).filter(Boolean);
  const header = lines[0]?.toLowerCase().startsWith("email");
  if (header || lines.some((l) => l.split(",").length > 2)) {
    // CSV: email, name, role, workspaces (workspaces separated by ";")
    return lines.slice(header ? 1 : 0).map((l) => {
      const [email, name, r, ws] = l.split(",").map((s) => s?.trim());
      const rr = (ROLES as string[]).includes(r?.toLowerCase() ?? "") ? (r.toLowerCase() as OrgRole) : role;
      const wsIds = ws ? ws.split(/[;|]/).map((n) => workspaces.find((w) => w.name.toLowerCase() === n.trim().toLowerCase() || w.slug === n.trim())?.id).filter((x): x is ID => !!x) : workspaceIds;
      return { email, name: name || undefined, role: rr, workspaceIds: wsIds };
    });
  }
  return text
    .split(/[\s,;]+/)
    .map((e) => e.trim())
    .filter(Boolean)
    .map((email) => ({ email, role, workspaceIds }));
}

function InviteDialog({ open, onClose, workspaces }: { open: boolean; onClose: () => void; workspaces: Workspace[] }) {
  const { org } = useOrgScope()!;
  const send = useSendInvites(org.id);
  const [text, setText] = useState("");
  const [role, setRole] = useState<OrgRole>("member");
  const [wsIds, setWsIds] = useState<ID[]>([]);
  const [results, setResults] = useState<{ email: string; error?: string }[] | null>(null);
  const drafts = useMemo(() => parseInviteInput(text, role, wsIds, workspaces), [text, role, wsIds, workspaces]);
  const close = () => {
    setText("");
    setResults(null);
    onClose();
  };
  const onFile = async (f?: File) => f && setText(await f.text());
  return (
    <Dialog open={open} onClose={close} fullWidth maxWidth="sm">
      <DialogTitle>Invite people to {org.name}</DialogTitle>
      <DialogContent>
        {results ? (
          <Stack spacing={1}>
            <Alert severity={results.some((r) => r.error) ? "warning" : "success"}>
              {results.filter((r) => !r.error).length} invite{results.filter((r) => !r.error).length === 1 ? "" : "s"} sent.
            </Alert>
            {results.filter((r) => r.error).map((r) => (
              <Typography key={r.email} variant="body2" color="error">
                {r.email}: {r.error}
              </Typography>
            ))}
          </Stack>
        ) : (
          <Stack spacing={2} sx={{ pt: 1 }}>
            <TextField
              label="Emails"
              placeholder={"ana@lab.org, ben@lab.org\nor CSV: email, name, role, workspaces"}
              multiline
              minRows={3}
              value={text}
              onChange={(e) => setText(e.target.value)}
              autoFocus
              helperText={`${drafts.length} recipient${drafts.length === 1 ? "" : "s"} · CSV columns: email, name, role, workspaces (separate workspaces with ;)`}
            />
            <Button component="label" startIcon={<UploadFileOutlined />} sx={{ alignSelf: "flex-start" }}>
              Upload CSV
              <input hidden type="file" accept=".csv,text/csv" onChange={(e) => onFile(e.target.files?.[0])} />
            </Button>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
              <TextField select label="Role" value={role} onChange={(e) => setRole(e.target.value as OrgRole)} sx={{ minWidth: 160 }} helperText={ROLE_HELP[role]}>
                {ROLES.filter((r) => r !== "owner").map((r) => (
                  <MenuItem key={r} value={r}>
                    {r}
                  </MenuItem>
                ))}
              </TextField>
              <Box>
                <Typography variant="caption" color="text.secondary" component="div" sx={{ mb: 0.5 }}>
                  Private workspaces
                </Typography>
                <WorkspacePicker value={wsIds} onChange={setWsIds} workspaces={workspaces} />
              </Box>
            </Stack>
            {send.error && <Alert severity="error">{errorMessage(send.error)}</Alert>}
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        {results ? (
          <Button variant="contained" onClick={close}>Done</Button>
        ) : (
          <>
            <Button onClick={close}>Cancel</Button>
            <Button variant="contained" disabled={!drafts.length || send.isPending} onClick={() => send.mutate(drafts, { onSuccess: setResults })}>
              Send {drafts.length || ""} invite{drafts.length === 1 ? "" : "s"}
            </Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  );
}

function InviteLinks() {
  const { org } = useOrgScope()!;
  const { data: links } = useInviteLinks(org.id);
  const create = useCreateInviteLink(org.id);
  const revoke = useRevokeInviteLink(org.id);
  const notify = useNotify();
  const [roleCap, setRoleCap] = useState<OrgRole>("member");
  const [days, setDays] = useState(7);
  const copy = (token: string) => {
    const url = `${location.origin}/accept-invite/${token}`;
    navigator.clipboard?.writeText(url).then(() => notify("Link copied"), () => notify(url));
  };
  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Typography variant="h4" sx={{ mb: 0.5 }}>Invite link</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
        Anyone with the link can join with at most the role you choose, until it expires.
      </Typography>
      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
        <TextField select size="small" label="Role cap" value={roleCap} onChange={(e) => setRoleCap(e.target.value as OrgRole)} sx={{ minWidth: 130 }}>
          {(["member", "viewer"] as OrgRole[]).map((r) => <MenuItem key={r} value={r}>{r}</MenuItem>)}
        </TextField>
        <TextField select size="small" label="Expires in" value={days} onChange={(e) => setDays(Number(e.target.value))} sx={{ minWidth: 130 }}>
          {[1, 7, 30].map((d) => <MenuItem key={d} value={d}>{d} day{d > 1 ? "s" : ""}</MenuItem>)}
        </TextField>
        <Button startIcon={<LinkRounded />} onClick={() => create.mutate({ roleCap, days }, { onSuccess: (l) => copy(l.token) })} disabled={create.isPending}>
          Create and copy
        </Button>
      </Stack>
      {!!links?.length && (
        <Stack spacing={0.5} sx={{ mt: 1.5 }}>
          {links.map((l) => (
            <Stack key={l.id} direction="row" spacing={1} alignItems="center">
              <Typography variant="body2" sx={{ fontFamily: "monospace", flex: 1, minWidth: 0 }} noWrap>
                /accept-invite/{l.token}
              </Typography>
              <Typography variant="caption" color="text.secondary">{l.roleCap} · until {formatDay(l.expiresAt.slice(0, 10))}</Typography>
              <Button size="small" onClick={() => copy(l.token)}>Copy</Button>
              <Button size="small" color="error" onClick={() => revoke.mutate(l.id)}>Revoke</Button>
            </Stack>
          ))}
        </Stack>
      )}
    </Paper>
  );
}

export function MembersPanel() {
  const { org, role, me } = useOrgScope()!;
  const members = useMembers(org.id);
  const { data: workspaces = [] } = useWorkspaces(org.id);
  const invites = useInvites(org.id);
  const inviteAction = useInviteAction(org.id);
  const notify = useNotify();
  const [q, setQ] = useState("");
  const [inviting, setInviting] = useState(false);

  const list = (members.data ?? [])
    .filter((m) => m.status !== "invited")
    .filter((m) => !q || `${m.user.name} ${m.user.email}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => Number(a.status === "deactivated") - Number(b.status === "deactivated") || a.user.name.localeCompare(b.user.name));
  const pending = (invites.data ?? []).filter((i) => i.status === "pending" || i.status === "expired");

  return (
    <Stack spacing={3}>
      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
        <TextField
          placeholder="Find people"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          slotProps={{ input: { startAdornment: <InputAdornment position="start"><SearchRounded fontSize="small" /></InputAdornment> } }}
          sx={{ flex: 1, minWidth: 200, maxWidth: 360 }}
        />
        <Box sx={{ flex: 1 }} />
        <Button variant="contained" startIcon={<PersonAddAlt1Rounded />} onClick={() => setInviting(true)}>
          Invite people
        </Button>
      </Stack>

      {members.error ? (
        <ErrorState error={members.error} onRetry={() => members.refetch()} />
      ) : (
        <TableContainer component={Paper} variant="outlined">
          <Table size="small" aria-label="Members">
            <TableHead>
              <TableRow>
                <TableCell>Person</TableCell>
                <TableCell>Role</TableCell>
                <TableCell>
                  <Tooltip title="Workspaces open to all org members are always included. Admins see every workspace.">
                    <span>Private workspaces</span>
                  </Tooltip>
                </TableCell>
                <TableCell />
              </TableRow>
            </TableHead>
            <TableBody>
              {list.map((m) => (
                <MemberRow key={m.user.id} m={m} workspaces={workspaces} myRole={role} isMe={m.user.id === me.user.id} />
              ))}
              {!members.isPending && !list.length && (
                <TableRow>
                  <TableCell colSpan={4}>
                    <EmptyState title={q ? "No one matches" : "Just you so far"} body={q ? undefined : "Invite teammates to start logging together."} />
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      <Box>
        <Typography variant="h3" sx={{ mb: 1 }}>Pending invites</Typography>
        {!pending.length ? (
          <Typography variant="body2" color="text.secondary">No pending invites.</Typography>
        ) : (
          <TableContainer component={Paper} variant="outlined">
            <Table size="small" aria-label="Pending invites">
              <TableBody>
                {pending.map((i) => (
                  <TableRow key={i.id}>
                    <TableCell>{i.email}</TableCell>
                    <TableCell>{i.role}</TableCell>
                    <TableCell>
                      <Typography variant="caption" color={i.status === "expired" ? "error" : "text.secondary"}>
                        {i.status === "expired" ? "Expired" : `Sent ${timeAgo(i.createdAt)} · expires ${formatDay(i.expiresAt.slice(0, 10))}`}
                      </Typography>
                    </TableCell>
                    <TableCell align="right">
                      <Button size="small" onClick={() => inviteAction.mutate({ id: i.id, action: "resend" }, { onSuccess: () => notify(`Invite re-sent to ${i.email}`) })}>
                        Resend
                      </Button>
                      <Button size="small" color="error" onClick={() => inviteAction.mutate({ id: i.id, action: "revoke" }, { onSuccess: () => notify(`Invite to ${i.email} revoked`) })}>
                        Revoke
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Box>

      <InviteLinks />
      <InviteDialog open={inviting} onClose={() => setInviting(false)} workspaces={workspaces} />
    </Stack>
  );
}
