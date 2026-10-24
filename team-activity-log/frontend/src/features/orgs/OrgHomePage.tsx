import { ArrowForwardRounded, ArchiveOutlined } from "@mui/icons-material";
import { Button, List, ListItemButton, ListItemText, Stack, Typography } from "@mui/material";
import { Link as RouterLink, Navigate, useNavigate } from "react-router-dom";
import { useMe } from "../../api/hooks";
import { can, useOrgScope, wsPath } from "../../app/session";
import { AuthLayout } from "../auth/AuthPages";
import { EmptyState } from "../../components/ui";

/** `/o/:org` — workspace picker for the org (§A3). Skipped when there is only one choice. */
export function OrgHomePage() {
  const scope = useOrgScope()!;
  const navigate = useNavigate();
  const active = scope.workspaces.filter((w) => !w.archived);
  if (active.length === 1) return <Navigate to={wsPath(scope.org, active[0])} replace />;
  return (
    <AuthLayout title={scope.org.name} sub="Choose a workspace" wide>
      {active.length === 0 ? (
        <EmptyState
          title="No workspaces yet"
          body={can(scope.role, "admin") ? "Create one to start logging." : "Ask an admin to add you to a workspace."}
          action={can(scope.role, "admin") && <Button variant="contained" component={RouterLink} to={`/o/${scope.org.slug}/admin/workspaces`}>Create workspace</Button>}
        />
      ) : (
        <List disablePadding>
          {active.map((w) => (
            <ListItemButton key={w.id} onClick={() => navigate(wsPath(scope.org, w))}>
              <ListItemText primary={w.name} secondary={w.description} />
              <ArrowForwardRounded fontSize="small" color="disabled" />
            </ListItemButton>
          ))}
          {scope.workspaces.some((w) => w.archived) && (
            <Typography variant="caption" color="text.secondary" sx={{ display: "flex", alignItems: "center", gap: 0.5, mt: 1, px: 2 }}>
              <ArchiveOutlined sx={{ fontSize: 14 }} /> Archived workspaces are in Admin → Workspaces
            </Typography>
          )}
        </List>
      )}
    </AuthLayout>
  );
}

/** `/orgs` — for multi-org users, or users without an org. */
export function OrgPickerPage() {
  const { data: me } = useMe();
  if (!me) return null;
  if (me.orgs.length === 0) return <Navigate to="/new-org" replace />;
  return (
    <AuthLayout title="Your organizations" wide>
      <Stack spacing={2}>
        <List disablePadding>
          {me.orgs.map((o) => (
            <ListItemButton key={o.org.id} component={RouterLink} to={`/o/${o.org.slug}`}>
              <ListItemText primary={o.org.name} secondary={`${o.role} · ${o.workspaces.filter((w) => !w.archived).length} workspaces`} />
              <ArrowForwardRounded fontSize="small" color="disabled" />
            </ListItemButton>
          ))}
        </List>
        <Button component={RouterLink} to="/new-org">
          Create another organization
        </Button>
      </Stack>
    </AuthLayout>
  );
}
