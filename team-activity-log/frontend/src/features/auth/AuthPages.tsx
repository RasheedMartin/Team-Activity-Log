import { Alert, Box, Button, Divider, InputAdornment, Link, List, ListItemButton, ListItemAvatar, ListItemText, Paper, Stack, TextField, Typography } from "@mui/material";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link as RouterLink, Navigate, useLocation, useNavigate, useParams } from "react-router-dom";
import { API_MODE } from "../../api/client";
import {
  useCreateOrg,
  useForgotPassword,
  useLogin,
  useMagicLink,
  useMagicSignIn,
  useMe,
  usePersonas,
  useRegister,
  useResetPassword,
  useSignInAs,
  useSlugAvailable,
  useVerifyEmail,
} from "../../api/hooks";
import { homePath } from "../../app/session";
import { BRAND } from "../../app/brand";
import { UserAvatar } from "../../components/ui";
import { errorMessage } from "../../lib/format";

export function AuthLayout({ title, sub, children, wide }: { title: string; sub?: ReactNode; children: ReactNode; wide?: boolean }) {
  return (
    <Box sx={{ minHeight: "100dvh", display: "grid", placeItems: "center", px: 2, py: 6, bgcolor: "background.default" }}>
      <Box sx={{ width: "100%", maxWidth: wide ? 560 : 400 }}>
        <Typography component={RouterLink} to="/" variant="overline" color="primary" sx={{ display: "block", mb: 2, textDecoration: "none" }}>
          {BRAND.name}
        </Typography>
        <Typography variant="h1" sx={{ mb: 0.5 }}>
          {title}
        </Typography>
        {sub && (
          <Typography color="text.secondary" sx={{ mb: 3 }}>
            {sub}
          </Typography>
        )}
        <Paper variant="outlined" sx={{ p: 3, mt: sub ? 0 : 3 }}>
          {children}
        </Paper>
      </Box>
    </Box>
  );
}

function useAfterAuth() {
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from;
  return (me: Parameters<typeof homePath>[0]) => navigate(from && from !== "/" ? from : homePath(me), { replace: true });
}

// ---- sign in ----

export function SignInPage() {
  const { data: me } = useMe();
  const login = useLogin();
  const magic = useMagicLink();
  const after = useAfterAuth();
  const [mode, setMode] = useState<"password" | "magic" | "forgot">("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const forgot = useForgotPassword();
  const location = useLocation();
  const [sent, setSent] = useState(false);

  if (me) return <Navigate to={(location.state as { from?: string } | null)?.from ?? homePath(me)} replace />;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (mode === "password") login.mutate({ email, password }, { onSuccess: after });
    else if (mode === "magic") magic.mutate(email, { onSuccess: () => setSent(true) });
    else forgot.mutate(email, { onSuccess: () => setSent(true) });
  };
  const error = login.error ?? magic.error ?? forgot.error;
  const pending = login.isPending || magic.isPending || forgot.isPending;

  return (
    <AuthLayout title="Sign in" sub="Your team's work log: write it up, find it later.">
      {sent ? (
        <Stack spacing={2}>
          <Alert severity="success">Check {email} for a link.{API_MODE === "mock" && " (Mock mode: open it from the dev panel's outbox.)"}</Alert>
          {API_MODE === "mock" && <Button component={RouterLink} to="/dev">Open dev outbox</Button>}
          <Button onClick={() => (setSent(false), setMode("password"))}>Back to sign in</Button>
        </Stack>
      ) : (
        <Stack component="form" spacing={2} onSubmit={submit} noValidate>
          <TextField label="Email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus required />
          {mode === "password" && (
            <TextField
              label="Password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              slotProps={{ input: { endAdornment: <InputAdornment position="end"><Link component="button" type="button" variant="caption" onClick={() => setMode("forgot")}>Forgot?</Link></InputAdornment> } }}
            />
          )}
          {error && <Alert severity="error">{errorMessage(error)}</Alert>}
          <Button type="submit" variant="contained" disabled={pending || !email}>
            {mode === "password" ? "Sign in" : mode === "magic" ? "Email me a sign-in link" : "Email me a reset link"}
          </Button>
          <Stack direction="row" spacing={1} justifyContent="space-between">
            <Link component="button" type="button" variant="body2" onClick={() => setMode(mode === "magic" ? "password" : "magic")}>
              {mode === "magic" ? "Use a password" : "Email me a link instead"}
            </Link>
            <Link component={RouterLink} to="/register" variant="body2">
              Create account
            </Link>
          </Stack>
          <Divider>or</Divider>
          <Button variant="outlined" disabled title="Connects when the auth provider is set up (backend B-1)">
            Continue with Google
          </Button>
        </Stack>
      )}
      {API_MODE === "mock" && <PersonaPicker />}
    </AuthLayout>
  );
}

/** Dev-only "Sign in as…" (§A3 fake auth). */
function PersonaPicker() {
  const { data } = usePersonas();
  const signInAs = useSignInAs();
  const after = useAfterAuth();
  if (!data?.length) return null;
  return (
    <Box sx={{ mt: 3 }}>
      <Divider sx={{ mb: 1 }}>
        <Typography variant="overline" color="text.secondary">
          Dev · sign in as
        </Typography>
      </Divider>
      <List dense disablePadding sx={{ maxHeight: 260, overflow: "auto" }}>
        {data.map((p) => (
          <ListItemButton key={p.user.id} onClick={() => signInAs.mutate(p.user.id, { onSuccess: after })} disabled={signInAs.isPending}>
            <ListItemAvatar sx={{ minWidth: 36 }}>
              <UserAvatar user={p.user} />
            </ListItemAvatar>
            <ListItemText primary={p.user.name} secondary={p.roles.join(" · ") || "no org yet"} slotProps={{ secondary: { noWrap: true } }} />
          </ListItemButton>
        ))}
      </List>
    </Box>
  );
}

// ---- register ----

export function RegisterPage() {
  const register = useRegister();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const { data: me } = useMe();
  if (me && !register.isSuccess) return <Navigate to={homePath(me)} replace />;
  return (
    <AuthLayout title="Create your account" sub="Then set up your organization and first workspace.">
      <Stack
        component="form"
        spacing={2}
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          register.mutate({ name, email, password }, { onSuccess: () => navigate("/verify-sent", { replace: true, state: { email } }) });
        }}
      >
        <TextField label="Full name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} autoFocus required />
        <TextField label="Work email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <TextField label="Password" type="password" autoComplete="new-password" helperText="At least 8 characters" value={password} onChange={(e) => setPassword(e.target.value)} required />
        {register.error && <Alert severity="error">{errorMessage(register.error)}</Alert>}
        <Button type="submit" variant="contained" disabled={register.isPending}>
          Create account
        </Button>
        <Typography variant="body2" color="text.secondary">
          Already have an account? <Link component={RouterLink} to="/signin">Sign in</Link>
        </Typography>
      </Stack>
    </AuthLayout>
  );
}

export function VerifySentPage() {
  const email = (useLocation().state as { email?: string } | null)?.email;
  return (
    <AuthLayout title="Check your email" sub={`We sent a verification link${email ? ` to ${email}` : ""}.`}>
      <Stack spacing={2}>
        <Typography variant="body2" color="text.secondary">
          You can keep going and set up your organization now; verify any time before inviting people.
        </Typography>
        <Button variant="contained" component={RouterLink} to="/new-org">
          Set up organization
        </Button>
        {API_MODE === "mock" && (
          <Button component={RouterLink} to="/dev">
            Open dev outbox
          </Button>
        )}
      </Stack>
    </AuthLayout>
  );
}

/** Runs a token mutation once on mount (verify / magic link). */
function TokenPage({ title, use }: { title: string; use: () => ReturnType<typeof useVerifyEmail> }) {
  const { token = "" } = useParams();
  const m = use();
  const after = useAfterAuth();
  const ran = useRef(false);
  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    m.mutate(token, { onSuccess: after });
  }, [m, token, after]);
  return (
    <AuthLayout title={title}>
      {m.isError ? (
        <Stack spacing={2}>
          <Alert severity="error">{errorMessage(m.error)}</Alert>
          <Button component={RouterLink} to="/signin">
            Back to sign in
          </Button>
        </Stack>
      ) : (
        <Typography color="text.secondary">One moment…</Typography>
      )}
    </AuthLayout>
  );
}
export const VerifyPage = () => <TokenPage title="Verifying your email" use={useVerifyEmail} />;
export const MagicPage = () => <TokenPage title="Signing you in" use={useMagicSignIn} />;

export function ResetPage() {
  const { token = "" } = useParams();
  const reset = useResetPassword();
  const after = useAfterAuth();
  const [password, setPassword] = useState("");
  return (
    <AuthLayout title="Choose a new password">
      <Stack component="form" spacing={2} onSubmit={(e) => (e.preventDefault(), reset.mutate({ token, password }, { onSuccess: after }))}>
        <TextField label="New password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus helperText="At least 8 characters" />
        {reset.error && <Alert severity="error">{errorMessage(reset.error)}</Alert>}
        <Button type="submit" variant="contained" disabled={reset.isPending}>
          Save and sign in
        </Button>
      </Stack>
    </AuthLayout>
  );
}

// ---- create org (W1.1) ----

const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);

export function CreateOrgPage() {
  const create = useCreateOrg();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [wsName, setWsName] = useState("General");
  const effectiveSlug = slugTouched ? slugify(slug) : slugify(name);
  const [debounced, setDebounced] = useState(effectiveSlug);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(effectiveSlug), 250);
    return () => clearTimeout(t);
  }, [effectiveSlug]);
  const avail = useSlugAvailable(debounced);
  const taken = avail.data && avail.data.slug === effectiveSlug && !avail.data.available;
  return (
    <AuthLayout title="Set up your organization" sub="An organization is your lab or company. Workspaces inside it hold each team's log.">
      <Stack
        component="form"
        spacing={2}
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate({ name, slug: effectiveSlug, workspaceName: wsName }, { onSuccess: (me) => navigate(homePath(me), { replace: true }) });
        }}
      >
        <TextField label="Organization name" placeholder="Halvorsen Lab" value={name} onChange={(e) => setName(e.target.value)} autoFocus required />
        <TextField
          label="URL"
          value={slugTouched ? slug : effectiveSlug}
          onChange={(e) => (setSlugTouched(true), setSlug(e.target.value))}
          error={!!taken}
          helperText={taken ? "Taken. Try another." : effectiveSlug && avail.data?.available && avail.data.slug === effectiveSlug ? "Available" : " "}
          slotProps={{ input: { startAdornment: <InputAdornment position="start">/o/</InputAdornment> } }}
        />
        <TextField label="First workspace" value={wsName} onChange={(e) => setWsName(e.target.value)} helperText="You can rename it or add more later" />
        {create.error && <Alert severity="error">{errorMessage(create.error)}</Alert>}
        <Button type="submit" variant="contained" disabled={create.isPending || !name.trim() || !!taken}>
          Create organization
        </Button>
      </Stack>
    </AuthLayout>
  );
}
