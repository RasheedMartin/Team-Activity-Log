import { Alert, Box, Button, Chip, LinearProgress, Paper, Stack, TextField, Typography } from "@mui/material";
import { useState } from "react";
import { usePlan, useRenameOrg } from "../../api/hooks";
import { can, useOrgScope } from "../../app/session";
import { useNotify } from "../../components/notify";
import { errorMessage } from "../../lib/format";

export function OrgSettingsPanel() {
  const { org, role } = useOrgScope()!;
  const notify = useNotify();
  const [name, setName] = useState(org.name);
  const rename = useRenameOrg(org.id);
  const owner = can(role, "owner");
  return (
    <Stack spacing={2} sx={{ maxWidth: 640 }}>
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="h4" sx={{ mb: 1.5 }}>Name</Typography>
        <Stack direction="row" spacing={1} alignItems="flex-start">
          <TextField value={name} onChange={(e) => setName(e.target.value)} disabled={!owner} sx={{ flex: 1 }} helperText={`URL: /o/${org.slug} (can't be changed)`} />
          <Button variant="outlined" disabled={!owner || !name.trim() || name === org.name || rename.isPending} onClick={() => rename.mutate(name.trim(), { onSuccess: () => notify("Organization renamed") })}>
            Save
          </Button>
        </Stack>
        {!owner && <Typography variant="caption" color="text.secondary">Only owners can rename the organization.</Typography>}
        {rename.error && <Alert severity="error" sx={{ mt: 1 }}>{errorMessage(rename.error)}</Alert>}
      </Paper>
      <PlanCard orgId={org.id} />
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="h4" sx={{ mb: 0.5 }}>Ownership</Typography>
        <Typography variant="body2" color="text.secondary">
          To transfer ownership, open Members, choose a person's menu, and pick “Transfer ownership”. The last owner can't be removed.
        </Typography>
      </Paper>
    </Stack>
  );
}

const GB = 1024 ** 3;
const fmtBytes = (b: number) => (b >= GB ? `${(b / GB).toFixed(1)} GB` : `${Math.max(0, b / 1024 ** 2).toFixed(b < 1024 ** 2 ? 1 : 0)} MB`);

function Meter({ label, used, max, fmt = String }: { label: string; used: number; max: number | null; fmt?: (n: number) => string }) {
  const pct = max ? Math.min(100, (used / max) * 100) : 0;
  return (
    <Box>
      <Stack direction="row" justifyContent="space-between">
        <Typography variant="body2">{label}</Typography>
        <Typography variant="body2" color="text.secondary">{max === null ? `${fmt(used)} · unlimited` : `${fmt(used)} of ${fmt(max)}`}</Typography>
      </Stack>
      {max !== null && <LinearProgress variant="determinate" value={pct} color={pct >= 100 ? "error" : pct >= 80 ? "warning" : "primary"} aria-label={`${label}: ${Math.round(pct)}% used`} sx={{ height: 6, borderRadius: 3, mt: 0.5 }} />}
    </Box>
  );
}

/** Plan & usage: what the server enforces (backend/src/tal/plans.py). */
function PlanCard({ orgId }: { orgId: string }) {
  const { data: p, error } = usePlan(orgId);
  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack direction="row" alignItems="baseline" spacing={1} sx={{ mb: 1.5 }}>
        <Typography variant="h4">Plan & usage</Typography>
        {p && <Chip size="small" label={p.name} color={p.plan === "free" ? "default" : "primary"} />}
      </Stack>
      {error ? (
        <Alert severity="error">{errorMessage(error)}</Alert>
      ) : !p ? (
        <LinearProgress />
      ) : (
        <Stack spacing={1.5}>
          <Meter label="Members (incl. pending invites)" used={p.usage.members + p.usage.pendingInvites} max={p.limits.members} />
          <Meter label="Workspaces" used={p.usage.workspaces} max={p.limits.workspaces} />
          <Meter label="Image storage" used={p.usage.storageBytes} max={p.limits.storageBytes} fmt={fmtBytes} />
          <Meter label="Slide imports this month" used={p.usage.importsThisMonth} max={p.limits.importsPerMonth} />
          <Typography variant="caption" color="text.secondary">
            Images count once however often they're used. Going over a limit never removes anything; it only blocks adding more.
            {p.plan === "free" && " Paid plans and upgrades are coming soon."}
          </Typography>
        </Stack>
      )}
    </Paper>
  );
}
