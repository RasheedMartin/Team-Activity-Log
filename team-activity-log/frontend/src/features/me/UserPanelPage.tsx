import { ArrowBackRounded, ChatBubbleOutlineRounded, EditNoteRounded, EmojiEmotionsOutlined, ArticleOutlined, AlternateEmailRounded } from "@mui/icons-material";
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Chip,
  Divider,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  MenuItem,
  Paper,
  Stack,
  Switch,
  Tab,
  Tabs,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";
import { useState, type ReactNode } from "react";
import { Link as RouterLink, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import type { FilterSpec, UserPreferences } from "../../api/contract";
import { useChangePassword, useDeleteAccount, useExportMyData, useMe, useRevokeSessions, useSessions, useUpdatePreferences, useUpdateProfile } from "../../api/hooks";
import { homePath, wsPath } from "../../app/session";
import { useNotify } from "../../components/notify";
import { UserAvatar } from "../../components/ui";
import { timeAgo } from "../../lib/dates";
import { toSearchParams } from "../../lib/filterSpec";
import { errorMessage } from "../../lib/format";

function Section({ title, sub, children }: { title: string; sub?: string; children: ReactNode }) {
  return (
    <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}>
      <Typography variant="h3">{title}</Typography>
      {sub && <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>{sub}</Typography>}
      <Box sx={{ mt: 2 }}>{children}</Box>
    </Paper>
  );
}

const TIMEZONES: string[] = (() => {
  try {
    return (Intl as unknown as { supportedValuesOf(k: string): string[] }).supportedValuesOf("timeZone");
  } catch {
    return ["UTC"];
  }
})();

/** Read a picked image and downscale it to a 128px square data URL for the avatar. */
async function avatarFromFile(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = c.height = 128;
    const s = Math.min(img.naturalWidth, img.naturalHeight);
    c.getContext("2d")!.drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, 0, 0, 128, 128);
    return c.toDataURL("image/jpeg", 0.85);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function ProfileTab() {
  const { data: me } = useMe();
  const update = useUpdateProfile();
  const notify = useNotify();
  const u = me!.user;
  const [f, setF] = useState({ name: u.name, title: u.title ?? "", bio: u.bio ?? "", pronouns: u.pronouns ?? "", timezone: u.timezone ?? "UTC" });
  const dirty = f.name !== u.name || f.title !== (u.title ?? "") || f.bio !== (u.bio ?? "") || f.pronouns !== (u.pronouns ?? "") || f.timezone !== (u.timezone ?? "UTC");
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <Section title="Profile" sub="How you appear on posts, comments, and mentions.">
      <Stack spacing={2} sx={{ maxWidth: 520 }}>
        <Stack direction="row" spacing={2} alignItems="center">
          <UserAvatar user={u} size={64} />
          <Button component="label" variant="outlined" size="small">
            Change photo
            <input hidden type="file" accept="image/*" onChange={async (e) => {
              const file = e.target.files?.[0];
              if (file) update.mutate({ avatarUrl: await avatarFromFile(file) }, { onSuccess: () => notify("Photo updated") });
            }} />
          </Button>
          {u.avatarUrl && <Button size="small" onClick={() => update.mutate({ avatarUrl: undefined })}>Remove</Button>}
        </Stack>
        <TextField label="Name" value={f.name} onChange={set("name")} required />
        <TextField label="Title or team" value={f.title} onChange={set("title")} placeholder="Postdoc, Detector group" />
        <TextField label="Pronouns (optional)" value={f.pronouns} onChange={set("pronouns")} />
        <TextField label="Bio" value={f.bio} onChange={set("bio")} multiline minRows={2} />
        <Autocomplete options={TIMEZONES} value={f.timezone} onChange={(_, v) => v && setF({ ...f, timezone: v })} renderInput={(p) => <TextField {...p} label="Time zone" />} disableClearable />
        <Typography variant="caption" color="text.secondary">Email: {u.email}</Typography>
        {update.error && <Alert severity="error">{errorMessage(update.error)}</Alert>}
        <Box>
          <Button variant="contained" disabled={!dirty || update.isPending} onClick={() => update.mutate(f, { onSuccess: () => notify("Profile saved") })}>
            Save profile
          </Button>
        </Box>
      </Stack>
    </Section>
  );
}

function PreferencesTab() {
  const { data: me } = useMe();
  const update = useUpdatePreferences();
  const p = me!.preferences;
  const workspaces = me!.orgs.flatMap((o) => o.workspaces.filter((w) => !w.archived).map((w) => ({ w, org: o.org })));
  // Changes apply immediately and persist (§W1 done-when).
  const set = <K extends keyof UserPreferences>(k: K, v: UserPreferences[K]) => update.mutate({ ...p, [k]: v });
  const row = (label: string, help: string, control: ReactNode) => (
    <Stack direction={{ xs: "column", sm: "row" }} spacing={1} alignItems={{ sm: "center" }} justifyContent="space-between" sx={{ py: 1.5 }}>
      <Box>
        <Typography variant="body2" sx={{ fontWeight: 600 }}>{label}</Typography>
        <Typography variant="caption" color="text.secondary">{help}</Typography>
      </Box>
      {control}
    </Stack>
  );
  return (
    <Section title="Preferences" sub="Saved to your account; they follow you to any device.">
      <Stack divider={<Divider />}>
        {row("Theme", "Light, dark, or follow your system", (
          <ToggleButtonGroup size="small" exclusive value={p.theme} onChange={(_, v) => v && set("theme", v)} aria-label="Theme">
            <ToggleButton value="light">Light</ToggleButton>
            <ToggleButton value="dark">Dark</ToggleButton>
            <ToggleButton value="system">System</ToggleButton>
          </ToggleButtonGroup>
        ))}
        {row("Density", "Compact fits more on screen", (
          <ToggleButtonGroup size="small" exclusive value={p.density} onChange={(_, v) => v && set("density", v)} aria-label="Density">
            <ToggleButton value="compact">Compact</ToggleButton>
            <ToggleButton value="comfortable">Comfortable</ToggleButton>
          </ToggleButtonGroup>
        ))}
        {row("Default workspace", "Where you land after signing in", (
          <TextField select size="small" value={p.defaultWorkspaceId ?? ""} onChange={(e) => set("defaultWorkspaceId", e.target.value || undefined)} sx={{ minWidth: 220 }} slotProps={{ select: { displayEmpty: true } }}>
            <MenuItem value="">Last used</MenuItem>
            {workspaces.map(({ w, org }) => <MenuItem key={w.id} value={w.id}>{workspaces.length > 1 && me!.orgs.length > 1 ? `${org.name} / ` : ""}{w.name}</MenuItem>)}
          </TextField>
        ))}
        {row("Histogram date", "Which date the search histogram counts by default", (
          <ToggleButtonGroup size="small" exclusive value={p.histogramDateField} onChange={(_, v) => v && set("histogramDateField", v)} aria-label="Histogram date field">
            <ToggleButton value="workDate">Work date</ToggleButton>
            <ToggleButton value="publishedAt">Published</ToggleButton>
          </ToggleButtonGroup>
        ))}
        {row("Keyboard shortcuts", "C new post · / search · J/K move · [ filters · ⌘K palette", <Switch checked={p.shortcuts} onChange={(e) => set("shortcuts", e.target.checked)} inputProps={{ "aria-label": "Keyboard shortcuts" }} />)}
        {row("Reduce motion", "Turn off animations", <Switch checked={p.reducedMotion} onChange={(e) => set("reducedMotion", e.target.checked)} inputProps={{ "aria-label": "Reduce motion" }} />)}
        {row("Email digest", "Mentions and replies always show in your Inbox", (
          <ToggleButtonGroup size="small" exclusive value={p.digest} onChange={(_, v) => v && set("digest", v)} aria-label="Digest">
            <ToggleButton value="off">Off</ToggleButton>
            <ToggleButton value="daily">Daily</ToggleButton>
            <ToggleButton value="weekly">Weekly</ToggleButton>
          </ToggleButtonGroup>
        ))}
      </Stack>
    </Section>
  );
}

function SecurityTab() {
  const change = useChangePassword();
  const sessions = useSessions();
  const revoke = useRevokeSessions();
  const notify = useNotify();
  const [cur, setCur] = useState("");
  const [next, setNext] = useState("");
  return (
    <Stack spacing={2}>
      <Section title="Password">
        <Stack spacing={2} sx={{ maxWidth: 400 }} component="form" onSubmit={(e) => {
          e.preventDefault();
          change.mutate({ current: cur, next }, { onSuccess: () => (setCur(""), setNext(""), notify("Password changed")) });
        }}>
          <TextField label="Current password" type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} />
          <TextField label="New password" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} helperText="At least 8 characters" />
          {change.error && <Alert severity="error">{errorMessage(change.error)}</Alert>}
          <Box><Button type="submit" variant="outlined" disabled={!cur || !next || change.isPending}>Change password</Button></Box>
        </Stack>
      </Section>
      <Section title="Connected accounts" sub="Sign in with these instead of a password.">
        <Stack direction="row" spacing={1} alignItems="center">
          <Typography variant="body2" sx={{ flex: 1 }}>Google</Typography>
          <Chip size="small" label="Not connected" variant="outlined" />
          <Button size="small" disabled title="Available when the auth provider is connected (backend B-1)">Connect</Button>
        </Stack>
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>Two-factor authentication is coming later.</Typography>
      </Section>
      <Section title="Active sessions" sub="Devices signed in to your account.">
        <List dense disablePadding>
          {sessions.data?.map((s) => (
            <ListItemButton key={s.id} disableRipple sx={{ cursor: "default" }}>
              <ListItemText primary={<>{s.device} {s.current && <Chip size="small" label="This device" color="primary" variant="outlined" sx={{ ml: 1 }} />}</>} secondary={`${s.ip} · signed in ${timeAgo(s.createdAt)}`} />
              {!s.current && <Button size="small" onClick={() => revoke.mutate(s.id)}>Sign out</Button>}
            </ListItemButton>
          ))}
        </List>
        <Button sx={{ mt: 1 }} variant="outlined" color="error" disabled={(sessions.data?.length ?? 0) < 2 || revoke.isPending} onClick={() => revoke.mutate(undefined, { onSuccess: () => notify("Signed out of all other devices") })}>
          Sign out everywhere else
        </Button>
      </Section>
    </Stack>
  );
}

function ActivityTab() {
  const { data: me } = useMe();
  const navigate = useNavigate();
  const all = me!.orgs.flatMap((o) => o.workspaces.filter((w) => !w.archived).map((w) => ({ org: o.org, ws: w })));
  const [wsId, setWsId] = useState(me!.lastWorkspaceId && all.some((x) => x.ws.id === me!.lastWorkspaceId) ? me!.lastWorkspaceId : all[0]?.ws.id);
  const target = all.find((x) => x.ws.id === wsId);
  if (!target) return <Section title="My activity"><Typography color="text.secondary">Join a workspace to see your activity.</Typography></Section>;
  // "My activity" views are ordinary search FilterSpecs (§B8), so they reuse the search screen.
  const views: { label: string; icon: ReactNode; spec?: FilterSpec; to?: string }[] = [
    { label: "My posts", icon: <ArticleOutlined />, spec: { all: [{ field: "mine", op: "eq", value: true }] } },
    { label: "My drafts", icon: <EditNoteRounded />, to: wsPath(target.org, target.ws, "/drafts") },
    { label: "Posts I commented on", icon: <ChatBubbleOutlineRounded />, spec: { all: [{ field: "iCommented", op: "eq", value: true }], sort: "recentActivity" } },
    { label: "Posts I reacted to", icon: <EmojiEmotionsOutlined />, spec: { all: [{ field: "iReacted", op: "eq", value: true }] } },
    { label: "Posts that mention me", icon: <AlternateEmailRounded />, spec: { all: [{ field: "mentionsMe", op: "eq", value: true }] } },
  ];
  return (
    <Section title="My activity" sub="Each opens the search screen with the matching filter, so you can narrow it further.">
      {all.length > 1 && (
        <TextField select size="small" label="Workspace" value={wsId} onChange={(e) => setWsId(e.target.value)} sx={{ mb: 2, minWidth: 220 }}>
          {all.map((x) => <MenuItem key={x.ws.id} value={x.ws.id}>{x.ws.name}</MenuItem>)}
        </TextField>
      )}
      <List disablePadding>
        {views.map((v) => (
          <ListItemButton key={v.label} onClick={() => navigate(v.to ?? `${wsPath(target.org, target.ws, "/search")}?${toSearchParams(v.spec!)}`)}>
            <ListItemIcon sx={{ minWidth: 36 }}>{v.icon}</ListItemIcon>
            <ListItemText primary={v.label} />
          </ListItemButton>
        ))}
      </List>
    </Section>
  );
}

function DataTab() {
  const { data: me } = useMe();
  const exp = useExportMyData();
  const del = useDeleteAccount();
  const notify = useNotify();
  const navigate = useNavigate();
  const [confirm, setConfirm] = useState("");
  return (
    <Stack spacing={2}>
      <Section title="Export my data" sub="Your posts, drafts, comments, and images as JSON + image files. Open formats, no lock-in.">
        <Button variant="outlined" disabled={exp.isPending || exp.isSuccess} onClick={() => exp.mutate(undefined, { onSuccess: () => notify("Export started. We'll email you a download link.") })}>
          {exp.isSuccess ? "Export requested" : "Request export"}
        </Button>
      </Section>
      <Section title="Delete account" sub="Your account is deactivated and you're signed out everywhere. Posts and comments stay, attributed to you, so team history isn't lost.">
        <Stack spacing={1.5} sx={{ maxWidth: 400 }}>
          <TextField size="small" label={`Type ${me!.user.email} to confirm`} value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          {del.error && <Alert severity="error">{errorMessage(del.error)}</Alert>}
          <Box>
            <Button variant="contained" color="error" disabled={confirm !== me!.user.email || del.isPending} onClick={() => del.mutate(undefined, { onSuccess: () => navigate("/", { replace: true }) })}>
              Delete my account
            </Button>
          </Box>
        </Stack>
      </Section>
    </Stack>
  );
}

const TABS = [
  { id: "profile", label: "Profile", el: <ProfileTab /> },
  { id: "preferences", label: "Preferences", el: <PreferencesTab /> },
  { id: "security", label: "Security", el: <SecurityTab /> },
  { id: "activity", label: "My activity", el: <ActivityTab /> },
  { id: "data", label: "Data", el: <DataTab /> },
];

/** `/me/...` — the user panel (§W1.8). */
export default function UserPanelPage() {
  const { data: me } = useMe();
  const { pathname } = useLocation();
  const tab = pathname.split("/")[2] ?? "profile";
  return (
    <Box sx={{ minHeight: "100dvh", bgcolor: "background.default" }}>
      <Box sx={{ borderBottom: 1, borderColor: "divider", bgcolor: "background.paper" }}>
        <Box sx={{ maxWidth: 880, mx: "auto", px: 2, pt: 2 }}>
          <Button component={RouterLink} to={homePath(me!)} startIcon={<ArrowBackRounded />} size="small" sx={{ mb: 1, ml: -1 }}>Back to log</Button>
          <Stack direction="row" spacing={1.5} alignItems="center">
            <UserAvatar user={me!.user} size={36} />
            <Typography variant="h1">{me!.user.name}</Typography>
          </Stack>
          <Tabs value={TABS.some((t) => t.id === tab) ? tab : "profile"} variant="scrollable" sx={{ mt: 1, minHeight: 40, "& .MuiTab-root": { minHeight: 40 } }}>
            {TABS.map((t) => <Tab key={t.id} value={t.id} label={t.label} component={RouterLink} to={`/me/${t.id}`} />)}
          </Tabs>
        </Box>
      </Box>
      <Box sx={{ maxWidth: 880, mx: "auto", px: 2, py: 3 }}>
        <Routes>
          {TABS.map((t) => <Route key={t.id} path={t.id} element={t.el} />)}
          <Route path="*" element={<Navigate to="/me/profile" replace />} />
        </Routes>
      </Box>
    </Box>
  );
}
