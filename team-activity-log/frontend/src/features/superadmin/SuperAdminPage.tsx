import { DeleteForeverOutlined, WarningAmberRounded } from "@mui/icons-material";
import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Paper, Skeleton, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Typography } from "@mui/material";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useSuperDeleteOrg, useSuperOverview, useSuperWipe } from "../../api/hooks";
import { useNotify } from "../../components/notify";
import { ErrorState, PageHeader } from "../../components/ui";
import { formatDay } from "../../lib/dates";
import { errorMessage } from "../../lib/format";

// Super admin (owner request): for the people running the service. Every org at a glance; delete
// one with its data (type its URL name); delete everything only when the server allows it
// (ALLOW_WIPE) and you type the phrase. Only SUPERADMIN_EMAILS accounts ever see this page.

const size = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : n >= 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.round(n / 1e3)} KB`);
const PHRASE = "DELETE EVERYTHING";

export default function SuperAdminPage() {
  const q = useSuperOverview();
  const del = useSuperDeleteOrg();
  const wipe = useSuperWipe();
  const notify = useNotify();
  const navigate = useNavigate();
  const [target, setTarget] = useState<{ id: string; name: string; slug: string } | null>(null);
  const [typed, setTyped] = useState("");
  const [wiping, setWiping] = useState(false);
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data) return <Skeleton variant="rounded" height={300} sx={{ m: 3 }} />;
  const { totals, orgs, wipeAllowed } = q.data;
  return (
    <Box sx={{ maxWidth: 1100, width: "100%", mx: "auto", px: { xs: 1.5, sm: 3 }, py: 3 }}>
      <PageHeader title="Super admin" sub="Everything on this server. Deletions can't be undone." />
      <Stack direction="row" spacing={2} useFlexGap sx={{ flexWrap: "wrap", mb: 3 }}>
        {[["Accounts", totals.users], ["Organizations", totals.orgs], ["Posts", totals.posts], ["Image storage", size(totals.storageBytes)]].map(([k, v]) => (
          <Paper key={k} variant="outlined" sx={{ px: 2, py: 1.5, minWidth: 150 }}>
            <Typography variant="caption" color="text.secondary">{k}</Typography>
            <Typography sx={{ fontSize: "1.4rem", fontWeight: 700 }}>{v}</Typography>
          </Paper>
        ))}
      </Stack>
      <TableContainer component={Paper} variant="outlined" sx={{ mb: 4 }}>
        <Table size="small" aria-label="Organizations">
          <TableHead>
            <TableRow>
              <TableCell>Organization</TableCell>
              <TableCell>Plan</TableCell>
              <TableCell align="right">Members</TableCell>
              <TableCell align="right">Posts</TableCell>
              <TableCell align="right">Storage</TableCell>
              <TableCell>Created</TableCell>
              <TableCell />
            </TableRow>
          </TableHead>
          <TableBody>
            {orgs.map((o) => (
              <TableRow key={o.id}>
                <TableCell><Typography variant="body2" sx={{ fontWeight: 600 }}>{o.name}</Typography><Typography variant="caption" color="text.secondary">/{o.slug}</Typography></TableCell>
                <TableCell>{o.plan}</TableCell>
                <TableCell align="right">{o.members}</TableCell>
                <TableCell align="right">{o.posts}</TableCell>
                <TableCell align="right">{size(o.storageBytes)}</TableCell>
                <TableCell>{formatDay(o.createdAt.slice(0, 10))}</TableCell>
                <TableCell align="right">
                  <Button size="small" color="error" startIcon={<DeleteForeverOutlined />} onClick={() => (setTyped(""), setTarget(o))} aria-label={`Delete ${o.name}`}>Delete</Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      <Paper variant="outlined" sx={{ p: 2, borderColor: "error.main" }}>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
          <WarningAmberRounded color="error" />
          <Typography variant="h4">Delete all data</Typography>
        </Stack>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          Every account, organization, post, comment, and stored file, including yours. Use it to reset the service, never on a whim.
        </Typography>
        {wipeAllowed ? (
          <Button color="error" variant="contained" onClick={() => (setTyped(""), setWiping(true))}>Delete all data…</Button>
        ) : (
          <Alert severity="info">Switched off on this server. To enable it, set ALLOW_WIPE=true and restart; turn it off again afterwards.</Alert>
        )}
      </Paper>

      <Dialog open={!!target} onClose={() => setTarget(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Delete “{target?.name}”?</DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ mb: 2 }}>Removes the organization with all its workspaces, posts, comments, images, and files. Members keep their accounts. This can't be undone.</Typography>
          <TextField fullWidth autoFocus label={`Type ${target?.slug} to confirm`} value={typed} onChange={(e) => setTyped(e.target.value)} />
          {del.error && <Alert severity="error" sx={{ mt: 1.5 }}>{errorMessage(del.error)}</Alert>}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setTarget(null)}>Cancel</Button>
          <Button color="error" variant="contained" disabled={typed !== target?.slug || del.isPending} onClick={() => target && del.mutate({ id: target.id, confirm: typed }, { onSuccess: () => (notify(`Deleted ${target.name}`), setTarget(null)) })}>
            Delete organization
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={wiping} onClose={() => setWiping(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Delete all data?</DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ mb: 2 }}>Everything on this server is removed, including your own account. You'll be signed out.</Typography>
          <TextField fullWidth autoFocus label={`Type ${PHRASE} to confirm`} value={typed} onChange={(e) => setTyped(e.target.value)} />
          {wipe.error && <Alert severity="error" sx={{ mt: 1.5 }}>{errorMessage(wipe.error)}</Alert>}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setWiping(false)}>Cancel</Button>
          <Button color="error" variant="contained" disabled={typed !== PHRASE || wipe.isPending} onClick={() => wipe.mutate(typed, { onSuccess: () => navigate("/", { replace: true }) })}>
            Delete everything
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
