import { ArrowBackRounded } from "@mui/icons-material";
import { Box, Button, Stack, Tab, Tabs, Typography } from "@mui/material";
import { Link as RouterLink, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { can, homePath, useOrgScope } from "../../app/session";
import { MembersPanel } from "./MembersPanel";
import { OrgSettingsPanel } from "./OrgSettingsPanel";
import { WorkspacesPanel } from "./WorkspacesPanel";

/** `/o/:org/admin/...` — members, workspaces, org settings (§A3, §W1.3–W1.7). */
export default function AdminPage() {
  const scope = useOrgScope()!;
  const { pathname } = useLocation();
  const base = `/o/${scope.org.slug}/admin`;
  if (!can(scope.role, "admin")) return <Navigate to={`/o/${scope.org.slug}`} replace />;
  const tab = pathname.split("/admin/")[1]?.split("/")[0] ?? "members";
  return (
    <Box sx={{ minHeight: "100dvh", bgcolor: "background.default" }}>
      <Box sx={{ borderBottom: 1, borderColor: "divider", bgcolor: "background.paper" }}>
        <Box sx={{ maxWidth: 1100, mx: "auto", px: 2, pt: 2 }}>
          <Button component={RouterLink} to={homePath(scope.me)} startIcon={<ArrowBackRounded />} size="small" sx={{ mb: 1, ml: -1 }}>
            Back to log
          </Button>
          <Stack direction="row" alignItems="baseline" spacing={1}>
            <Typography variant="h1">{scope.org.name}</Typography>
            <Typography color="text.secondary">Admin</Typography>
          </Stack>
          <Tabs value={tab} sx={{ mt: 1, minHeight: 40, "& .MuiTab-root": { minHeight: 40 } }}>
            <Tab value="members" label="Members" component={RouterLink} to={`${base}/members`} />
            <Tab value="workspaces" label="Workspaces" component={RouterLink} to={`${base}/workspaces`} />
            <Tab value="settings" label="Organization" component={RouterLink} to={`${base}/settings`} />
          </Tabs>
        </Box>
      </Box>
      <Box sx={{ maxWidth: 1100, mx: "auto", px: 2, py: 3 }}>
        <Routes>
          <Route path="members" element={<MembersPanel />} />
          <Route path="workspaces" element={<WorkspacesPanel />} />
          <Route path="settings" element={<OrgSettingsPanel />} />
          <Route path="*" element={<Navigate to="members" replace />} />
        </Routes>
      </Box>
    </Box>
  );
}
