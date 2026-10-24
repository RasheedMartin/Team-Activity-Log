import { Box, Tab, Tabs } from "@mui/material";
import { Outlet, Link as RouterLink, useLocation } from "react-router-dom";
import { useDrafts, useNotifications, useTrash } from "../../api/hooks";
import { can, useWs, wsPath } from "../../app/session";
import { PageHeader } from "../../components/ui";

/**
 * Activity (owner request): one rail entry for what's yours to deal with. Mentions, drafts, and
 * (admins) the recycle bin are tabs with their own URLs, so links and Back land on the right one.
 */
export default function ActivityPage() {
  const { org, ws, role } = useWs();
  const isMember = can(role, "member");
  const isAdmin = can(role, "admin");
  const { pathname } = useLocation();
  const notes = useNotifications(org.id);
  const drafts = useDrafts(org.id, ws.id, isMember);
  const trash = useTrash(org.id, ws.id, isAdmin);

  const base = wsPath(org, ws, "/activity");
  const unread = (notes.data ?? []).filter((n) => n.workspaceId === ws.id && !n.readAt).length;
  const binCount = (trash.data?.deleted.length ?? 0) + (trash.data?.hidden.length ?? 0);
  const count = (n: number) => (n ? ` (${n})` : "");
  const tabs = [
    { to: base, label: `Mentions & replies${count(unread)}` },
    ...(isMember ? [{ to: `${base}/drafts`, label: `Drafts${count(drafts.data?.length ?? 0)}` }] : []),
    ...(isAdmin ? [{ to: `${base}/recycle-bin`, label: `Recycle bin${count(binCount)}` }] : []),
  ];
  const current = tabs.find((t) => t.to === pathname.replace(/\/$/, ""))?.to ?? base;

  return (
    <Box sx={{ maxWidth: 860, width: "100%", mx: "auto", px: { xs: 1.5, sm: 3 }, py: 3 }}>
      <PageHeader title="Activity" />
      <Tabs value={current} aria-label="Activity" variant="scrollable" allowScrollButtonsMobile sx={{ mt: -1, mb: 2.5, borderBottom: 1, borderColor: "divider" }}>
        {tabs.map((t) => <Tab key={t.to} value={t.to} label={t.label} component={RouterLink} to={t.to} sx={{ textTransform: "none", minHeight: 44 }} />)}
      </Tabs>
      <Outlet />
    </Box>
  );
}
