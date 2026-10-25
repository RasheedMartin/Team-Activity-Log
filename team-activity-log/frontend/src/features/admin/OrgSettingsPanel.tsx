import { Alert, Box, Button, Chip, LinearProgress, Paper, Stack, TextField, ToggleButton, ToggleButtonGroup, Typography } from "@mui/material";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useBilling, usePlan, useRenameOrg } from "../../api/hooks";
import { UPGRADE_PRICES } from "../../app/pricing";
import { formatDay } from "../../lib/dates";
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
/** Upgrade choices: Team and Business, monthly or yearly (only the prices the server has set up). */
function Upgrade({ orgId, options }: { orgId: string; options: string[] }) {
  const billing = useBilling(orgId);
  const [interval, setInterval] = useState<"month" | "year">(options.some((o) => o.endsWith(":year")) ? "year" : "month");
  const plans = (["team", "business"] as const).filter((p) => options.includes(`${p}:${interval}`));
  return (
    <Stack spacing={1.25}>
      <Stack direction="row" alignItems="center" spacing={1} useFlexGap sx={{ flexWrap: "wrap" }}>
        <Typography variant="subtitle2" sx={{ flex: 1 }}>Upgrade</Typography>
        <ToggleButtonGroup size="small" exclusive value={interval} onChange={(_, v) => v && setInterval(v)} aria-label="Billing period">
          <ToggleButton value="month" disabled={!options.some((o) => o.endsWith(":month"))}>Monthly</ToggleButton>
          <ToggleButton value="year" disabled={!options.some((o) => o.endsWith(":year"))}>Yearly</ToggleButton>
        </ToggleButtonGroup>
      </Stack>
      <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
        {plans.map((p) => (
          <Button key={p} variant={p === "team" ? "contained" : "outlined"} disabled={billing.isPending} onClick={() => billing.mutate({ action: "checkout", plan: p, interval })} sx={{ flex: 1, flexDirection: "column", py: 1 }}>
            <span>Upgrade to {p === "team" ? "Team" : "Business"}</span>
            <Typography component="span" variant="caption" sx={{ opacity: 0.85 }}>
              {UPGRADE_PRICES[p][interval]} per member / month{interval === "year" ? ", billed yearly" : ""}
            </Typography>
          </Button>
        ))}
      </Stack>
      {billing.error && <Alert severity="error">{errorMessage(billing.error)}</Alert>}
      <Typography variant="caption" color="text.secondary">Payment is handled by Stripe. Seats follow your member count.</Typography>
    </Stack>
  );
}

function PlanCard({ orgId }: { orgId: string }) {
  const { data: p, error, refetch } = usePlan(orgId);
  const billing = useBilling(orgId);
  const [params, setParams] = useSearchParams();
  const returned = params.get("billing"); // back from Stripe Checkout
  useEffect(() => {
    if (returned !== "success") return;
    const t = [1500, 4000, 9000].map((ms) => setTimeout(() => void refetch(), ms)); // the webhook usually lands in seconds
    return () => t.forEach(clearTimeout);
  }, [returned, refetch]);
  const dismiss = () => setParams((q) => (q.delete("billing"), q), { replace: true });
  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack direction="row" alignItems="baseline" spacing={1} useFlexGap sx={{ mb: 1.5, flexWrap: "wrap" }}>
        <Typography variant="h4">Plan & usage</Typography>
        {p && <Chip size="small" label={p.trial?.active ? `${p.name} trial` : p.name} color={p.plan === "free" ? "default" : "primary"} />}
      </Stack>
      {error ? (
        <Alert severity="error">{errorMessage(error)}</Alert>
      ) : !p ? (
        <LinearProgress />
      ) : (
        <Stack spacing={1.5}>
          {returned === "success" && (
            <Alert severity="success" onClose={dismiss}>
              Thanks! {p.billing.subscribed ? `You're on ${p.name}.` : "Your plan updates as soon as Stripe confirms the payment, usually within a few seconds."}
            </Alert>
          )}
          {returned === "cancelled" && <Alert severity="info" onClose={dismiss}>Checkout was cancelled; nothing changed.</Alert>}
          {p.trial?.active && (
            <Alert severity="info">
              Team trial: {p.trial.daysLeft} day{p.trial.daysLeft === 1 ? "" : "s"} left (ends {formatDay(p.trial.endsAt.slice(0, 10))}). After that you're on Free: nothing is deleted, but Free limits apply to anything new.
            </Alert>
          )}
          {p.trial && !p.trial.active && p.plan === "free" && <Alert severity="warning">Your Team trial has ended. Everything you made is still here; upgrade to go past Free's limits.</Alert>}
          {p.billing.status === "past_due" && <Alert severity="warning">The last payment didn't go through. Update the card in Manage billing to keep {p.name}.</Alert>}
          <Meter label="Members (incl. pending invites)" used={p.usage.members + p.usage.pendingInvites} max={p.limits.members} />
          <Meter label="Workspaces" used={p.usage.workspaces} max={p.limits.workspaces} />
          <Meter label="Image storage" used={p.usage.storageBytes} max={p.limits.storageBytes} fmt={fmtBytes} />
          <Meter label="Slide imports this month" used={p.usage.importsThisMonth} max={p.limits.importsPerMonth} />
          <Typography variant="caption" color="text.secondary">
            Images count once however often they're used. Going over a limit never removes anything; it only blocks adding more.
          </Typography>
          {p.billing.enabled ? (
            p.billing.subscribed || p.billing.canManage ? (
              <Box>
                <Button variant="outlined" disabled={billing.isPending} onClick={() => billing.mutate({ action: "portal" })}>Manage billing</Button>
                <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5 }}>Change plan, update the card, see invoices, or cancel (in Stripe).</Typography>
              </Box>
            ) : (
              <Upgrade orgId={orgId} options={p.billing.options} />
            )
          ) : (
            p.paidPlan === "free" && <Typography variant="caption" color="text.secondary">Billing isn't set up on this server yet, so upgrades aren't available.</Typography>
          )}
        </Stack>
      )}
    </Paper>
  );
}
