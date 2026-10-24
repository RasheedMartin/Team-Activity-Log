import { Alert, Box, Button, Card, CardActionArea, CardContent, FormControlLabel, Link, List, ListItem, ListItemText, Stack, Switch, Typography } from "@mui/material";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link as RouterLink, useNavigate } from "react-router-dom";
import { API_MODE } from "../../api/client";
import { useDevEmails, useMe } from "../../api/hooks";
import { homePath } from "../../app/session";
import { timeAgo } from "../../lib/dates";
import { readDevSettings, SCENARIOS, writeDevSettings, type DataScenario, type DevSettings } from "../../mock/devSettings";

// `/dev` — mock controls (§A3). Dev tooling, so it may talk to the mock directly.

const TOGGLES: { key: keyof DevSettings; label: string; help: string }[] = [
  { key: "slowNetwork", label: "Slow network", help: "0.8–2.2 s per request" },
  { key: "randomErrors", label: "Random 500s", help: "~10% of requests fail" },
  { key: "indexLag", label: "Index lag", help: "New/edited posts appear in search after ~1.5 s" },
  { key: "liveActivity", label: "Live teammate activity", help: "Other personas comment and react every ~30 s" },
];

export default function DevPage() {
  const [settings, setSettings] = useState(readDevSettings);
  const [busy, setBusy] = useState<DataScenario | null>(null);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data: me } = useMe();
  const { data: emails } = useDevEmails();

  if (API_MODE !== "mock") return <Alert severity="info" sx={{ m: 4 }}>Mock controls are only available with VITE_API_MODE=mock.</Alert>;

  const switchTo = async (s: DataScenario) => {
    setBusy(s);
    const { loadScenario } = await import("../../mock/browser");
    await loadScenario(s);
    qc.clear();
    // A full reload resets the in-memory mock engine and all client state.
    window.location.assign("/");
  };
  const toggle = (key: keyof DevSettings) => setSettings(writeDevSettings({ [key]: !settings[key] }));

  return (
    <Box sx={{ maxWidth: 960, mx: "auto", px: 2, py: 4 }}>
      <Stack direction="row" alignItems="baseline" justifyContent="space-between" sx={{ mb: 3, flexWrap: "wrap", gap: 1 }}>
        <Box>
          <Typography variant="overline" color="primary">Dev only</Typography>
          <Typography variant="h1">Mock controls</Typography>
        </Box>
        {me ? <Button component={RouterLink} to={homePath(me)}>Back to app</Button> : <Button component={RouterLink} to="/signin">Sign in</Button>}
      </Stack>

      <Typography variant="h3" sx={{ mb: 1 }}>Data scenario</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Switching wipes the in-browser database, reseeds it, and signs you in as that scenario's default persona.
      </Typography>
      <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 1.5, mb: 4 }}>
        {SCENARIOS.map((s) => (
          <Card key={s.id} variant="outlined" sx={{ borderColor: settings.scenario === s.id ? "primary.main" : "divider" }}>
            <CardActionArea onClick={() => switchTo(s.id)} disabled={!!busy} sx={{ height: "100%" }}>
              <CardContent>
                <Typography variant="subtitle2">{s.label}{settings.scenario === s.id && " · current"}</Typography>
                <Typography variant="body2" color="text.secondary">{busy === s.id ? "Seeding…" : s.description}</Typography>
              </CardContent>
            </CardActionArea>
          </Card>
        ))}
      </Box>

      <Typography variant="h3" sx={{ mb: 1 }}>Network & behavior</Typography>
      <Stack sx={{ mb: 4 }}>
        {TOGGLES.map((t) => (
          <FormControlLabel
            key={t.key}
            control={<Switch checked={!!settings[t.key]} onChange={() => toggle(t.key)} />}
            label={<><Typography component="span">{t.label}</Typography> <Typography component="span" variant="body2" color="text.secondary">— {t.help}</Typography></>}
          />
        ))}
      </Stack>

      <Typography variant="h3" sx={{ mb: 1 }}>Outbox</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
        Emails the mock "sent" (verification, magic links, invites, resets).
      </Typography>
      {!emails?.length ? (
        <Typography variant="body2" color="text.disabled">Nothing sent yet.</Typography>
      ) : (
        <List dense sx={{ border: 1, borderColor: "divider", borderRadius: 1 }}>
          {emails.slice(0, 30).map((e) => (
            <ListItem key={e.id} divider secondaryAction={e.link && <Button size="small" onClick={() => navigate(e.link!)}>Open link</Button>}>
              <ListItemText
                primary={<>{e.subject} <Typography component="span" variant="caption" color="text.secondary">→ {e.to} · {timeAgo(e.sentAt)}</Typography></>}
                secondary={<>{e.body} {e.link && <Link component={RouterLink} to={e.link}>{e.link}</Link>}</>}
              />
            </ListItem>
          ))}
        </List>
      )}
    </Box>
  );
}
