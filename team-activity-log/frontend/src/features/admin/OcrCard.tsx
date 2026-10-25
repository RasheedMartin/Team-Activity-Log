import { LockOutlined } from "@mui/icons-material";
import { Alert, Box, Button, Chip, FormControlLabel, Paper, Radio, RadioGroup, Skeleton, Stack, TextField, Typography } from "@mui/material";
import { useState } from "react";
import type { OcrProviderId } from "../../api/contract";
import { useOcrSettings, useRereadOcr, useSaveOcr } from "../../api/hooks";
import { useNotify } from "../../components/notify";
import { errorMessage } from "../../lib/format";

// Text in images (OCR) for the org (owner request): the built-in engine is on for everyone; on
// Business an admin can connect a cloud engine with the org's own key. Keys are checked on a test
// image before they're saved, and never shown again (only a hint).

const LABELS: Record<string, string> = { apiKey: "API key", endpoint: "Endpoint (https://…)", accessKeyId: "Access key ID", secretAccessKey: "Secret access key", region: "Region (e.g. us-east-1)" };
const SECRET = new Set(["apiKey", "secretAccessKey"]);
const ABOUT: Record<OcrProviderId, string> = {
  tesseract: "Runs on our servers; images never leave them. Very good on screenshots, plots, and slides.",
  google: "Better on photos and handwriting. Billed by Google to your account.",
  azure: "Better on photos and handwriting. Billed by Microsoft to your account.",
  aws: "Better on photos and forms. Billed by Amazon to your account.",
};

export function OcrCard({ orgId }: { orgId: string }) {
  const q = useOcrSettings(orgId);
  const save = useSaveOcr(orgId);
  const reread = useRereadOcr(orgId);
  const notify = useNotify();
  const [pick, setPick] = useState<OcrProviderId | null>(null);
  const [creds, setCreds] = useState<Record<string, string>>({});
  if (q.isPending) return <Skeleton variant="rounded" height={200} />;
  if (!q.data) return null;
  const s = q.data;
  const choice = pick ?? s.provider;
  const p = s.providers.find((x) => x.id === choice)!;
  const saved = s.saved[choice];
  const editing = p.cloud && (!saved || Object.keys(creds).length > 0);
  const counts = s.counts;
  const waiting = (counts.pending ?? 0) + (counts.running ?? 0);
  const submit = () =>
    save.mutate(
      { provider: choice, ...(editing ? { credentials: creds } : {}) },
      { onSuccess: (d) => (setCreds({}), setPick(null), notify(d.active === "tesseract" ? "Using the built-in engine" : `Connected ${p.name}. New images use it.`)) },
    );

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Typography variant="h4" sx={{ mb: 0.5 }}>Text in images</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
        Words in pictures, screenshots, and imported slides are read automatically, so search finds them.
      </Typography>
      <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap", mb: 2 }}>
        <Chip size="small" label={`${(counts.ready ?? 0) + (counts.edited ?? 0)} with text`} />
        <Chip size="small" label={`${counts.empty ?? 0} without text`} variant="outlined" />
        {waiting > 0 && <Chip size="small" color="info" label={`${waiting} being read`} />}
        {(counts.failed ?? 0) > 0 && <Chip size="small" color="warning" label={`${counts.failed} couldn't be read`} />}
      </Stack>
      {!s.builtInReady && s.active === "tesseract" && <Alert severity="info" sx={{ mb: 2 }}>The built-in engine isn't installed on this server yet; images wait and are read once it is.</Alert>}
      {s.active !== s.provider && <Alert severity="warning" sx={{ mb: 2 }}>Using the built-in engine: {s.cloudAllowed ? "the saved key for your choice is missing" : "cloud engines need the Business plan"}.</Alert>}

      <RadioGroup value={choice} onChange={(e) => (setPick(e.target.value as OcrProviderId), setCreds({}))} aria-label="OCR engine">
        {s.providers.map((x) => {
          const locked = x.cloud && !s.cloudAllowed;
          return (
            <FormControlLabel
              key={x.id}
              value={x.id}
              disabled={locked}
              control={<Radio size="small" />}
              sx={{ alignItems: "flex-start", mb: 0.75, "& .MuiRadio-root": { pt: 0.25 } }}
              label={
                <Box>
                  <Stack direction="row" spacing={1} alignItems="center" useFlexGap sx={{ flexWrap: "wrap" }}>
                    <Typography sx={{ fontWeight: 600, fontSize: "0.95rem" }}>{x.name}</Typography>
                    {x.id === s.active && <Chip size="small" color="success" label="In use" />}
                    {locked && <Chip size="small" icon={<LockOutlined />} label="Business plan" variant="outlined" />}
                    {!locked && s.saved[x.id] && x.id !== s.active && <Chip size="small" label="Key saved" variant="outlined" />}
                  </Stack>
                  <Typography variant="body2" color="text.secondary">{ABOUT[x.id]}</Typography>
                </Box>
              }
            />
          );
        })}
      </RadioGroup>

      {p.cloud && s.cloudAllowed && (
        <Box sx={{ mt: 1, pl: { sm: 4 } }}>
          {saved && !editing ? (
            <Stack direction="row" spacing={1} alignItems="center" useFlexGap sx={{ flexWrap: "wrap" }}>
              <Typography variant="body2" color="text.secondary">
                Saved: {Object.entries(saved).map(([k, v]) => `${LABELS[k] ?? k} ${v}`).join(" · ")}
              </Typography>
              <Button size="small" onClick={() => setCreds(Object.fromEntries(p.fields.map((f) => [f, ""])))}>Replace key</Button>
              <Button size="small" color="error" onClick={() => save.mutate({ provider: choice, forget: true }, { onSuccess: () => (setPick(null), notify(`Removed the ${p.name} key`)) })}>Remove</Button>
            </Stack>
          ) : (
            <Stack spacing={1.25}>
              {p.fields.map((f) => (
                <TextField
                  key={f}
                  size="small"
                  label={LABELS[f] ?? f}
                  type={SECRET.has(f) ? "password" : "text"}
                  autoComplete="off"
                  value={creds[f] ?? ""}
                  onChange={(e) => setCreds({ ...creds, [f]: e.target.value })}
                />
              ))}
              <Typography variant="caption" color="text.secondary">We check the key on a test image before saving it. It's stored encrypted and never shown again.</Typography>
            </Stack>
          )}
        </Box>
      )}
      {save.error && <Alert severity="error" sx={{ mt: 1.5 }}>{errorMessage(save.error)}</Alert>}

      <Stack direction="row" spacing={1} useFlexGap sx={{ mt: 2, flexWrap: "wrap" }}>
        <Button
          variant="contained"
          disabled={save.isPending || (choice === s.provider && !editing) || (editing && p.fields.some((f) => !(creds[f] ?? "").trim()))}
          onClick={submit}
        >
          {save.isPending ? "Checking…" : editing ? "Check and save" : "Use this engine"}
        </Button>
        {(counts.failed ?? 0) > 0 && <Button disabled={reread.isPending} onClick={() => reread.mutate("failed", { onSuccess: (r) => notify(`Reading ${r.queued} images again`) })}>Retry failed</Button>}
        <Button disabled={reread.isPending} onClick={() => reread.mutate("all", { onSuccess: (r) => notify(`Reading ${r.queued} images again (corrected text is kept)`) })}>Re-read all images</Button>
      </Stack>
    </Paper>
  );
}
