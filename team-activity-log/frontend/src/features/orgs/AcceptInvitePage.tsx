import { Alert, Button, Stack, TextField, Typography } from "@mui/material";
import { useState } from "react";
import { Link as RouterLink, useNavigate, useParams } from "react-router-dom";
import { useAcceptInvite, useInviteLookup, useLogout, useMe } from "../../api/hooks";
import { homePath } from "../../app/session";
import { errorMessage } from "../../lib/format";
import { AuthLayout } from "../auth/AuthPages";

/** §W1.5: new users register (email locked); existing users sign in and the org is added. */
export function AcceptInvitePage() {
  const { token = "" } = useParams();
  const lookup = useInviteLookup(token);
  const { data: me } = useMe();
  const accept = useAcceptInvite(token);
  const logout = useLogout();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  if (lookup.isPending) return <AuthLayout title="Checking your invite…"><Typography color="text.secondary">One moment…</Typography></AuthLayout>;
  if (lookup.error || !lookup.data)
    return (
      <AuthLayout title="Invite not found">
        <Stack spacing={2}>
          <Alert severity="error">{errorMessage(lookup.error)}</Alert>
          <Button component={RouterLink} to="/">Go to sign in</Button>
        </Stack>
      </AuthLayout>
    );

  const inv = lookup.data;
  const done = (m: Parameters<typeof homePath>[0]) => navigate(homePath(m), { replace: true });
  const title = `Join ${inv.org.name}`;
  const sub = `You've been invited as ${inv.role === "admin" ? "an admin" : `a ${inv.role}`}.`;

  if (inv.status !== "pending")
    return (
      <AuthLayout title={title}>
        <Alert severity="warning">This invite is {inv.status}. Ask an admin of {inv.org.name} to send a new one.</Alert>
      </AuthLayout>
    );

  if (me) {
    const wrong = inv.email && me.user.email.toLowerCase() !== inv.email;
    return (
      <AuthLayout title={title} sub={sub}>
        <Stack spacing={2}>
          {wrong ? (
            <>
              <Alert severity="warning">
                This invite is for {inv.email}, but you're signed in as {me.user.email}.
              </Alert>
              <Button variant="outlined" onClick={() => logout.mutate()}>Sign out</Button>
            </>
          ) : (
            <Button variant="contained" disabled={accept.isPending} onClick={() => accept.mutate({}, { onSuccess: done })}>
              Join as {me.user.name}
            </Button>
          )}
          {accept.error && <Alert severity="error">{errorMessage(accept.error)}</Alert>}
        </Stack>
      </AuthLayout>
    );
  }

  const existing = inv.hasAccount;
  return (
    <AuthLayout title={title} sub={sub}>
      <Stack
        component="form"
        spacing={2}
        onSubmit={(e) => {
          e.preventDefault();
          accept.mutate({ name, password, email: inv.email ?? email }, { onSuccess: done });
        }}
      >
        <TextField label="Email" value={inv.email ?? email} onChange={(e) => setEmail(e.target.value)} disabled={!!inv.email} helperText={inv.email ? "Invites are tied to this address" : " "} />
        {!existing && <TextField label="Full name" value={name} onChange={(e) => setName(e.target.value)} autoFocus required />}
        <TextField
          label={existing ? "Your password" : "Choose a password"}
          type="password"
          autoComplete={existing ? "current-password" : "new-password"}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          helperText={existing ? "You already have an account; sign in to accept" : "At least 8 characters"}
          autoFocus={existing}
        />
        {accept.error && <Alert severity="error">{errorMessage(accept.error)}</Alert>}
        <Button type="submit" variant="contained" disabled={accept.isPending}>
          {existing ? "Sign in and join" : "Create account and join"}
        </Button>
      </Stack>
    </AuthLayout>
  );
}
