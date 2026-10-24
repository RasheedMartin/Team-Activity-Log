import {
  AddRounded,
  AdminPanelSettingsOutlined,
  BookmarkBorderRounded,
  CollectionsBookmarkOutlined,
  DeleteOutlineRounded,
  DynamicFeedRounded,
  EditNoteRounded,
  ExploreOutlined,
  ExpandMoreRounded,
  InboxOutlined,
  LogoutRounded,
  MenuRounded,
  PersonOutlineRounded,
  ScienceOutlined,
  UploadFileOutlined,
} from "@mui/icons-material";
import {
  Badge,
  Box,
  Button,
  Divider,
  Drawer,
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  ListSubheader,
  Menu,
  MenuItem,
  Stack,
  Tooltip,
  Typography,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import { useEffect, useState, type ReactNode } from "react";
import { Link as RouterLink, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { API_MODE } from "../api/client";
import { useCollections, useLogout, useNotifications, useRememberWorkspace, useSavedViews } from "../api/hooks";
import { fromSearchParams, specKey, toSearchParams } from "../lib/filterSpec";

const collectionParams = (id: string) => toSearchParams({ all: [{ field: "collection", op: "in", value: [id] }], sort: "oldest" });
import { UserAvatar } from "../components/ui";
import { can, useWs, wsPath } from "./session";
import { useShortcuts } from "./shortcuts";
import { CommandPalette } from "../features/search/CommandPalette";
import { useLiveEvents } from "../features/discussion/live";

const RAIL_WIDTH = 232;

/**
 * Rail link. NavLink matches on the path only, so links that differ only by query string (saved
 * views, collections — all `/search?…`) pass `active` explicitly instead.
 */
function NavItem({ to, icon, label, end, badge, onClick, active }: { to: string; icon: ReactNode; label: string; end?: boolean; badge?: boolean; onClick?: () => void; active?: boolean }) {
  const sx = { py: 0.5, mb: 0.25, "&.active, &[aria-current=page]": { bgcolor: "action.selected", fontWeight: 600 } };
  const content = (
    <>
      <ListItemIcon sx={{ minWidth: 30, color: "text.secondary", "& svg": { fontSize: 18 } }}>
        <Badge variant="dot" color="primary" invisible={!badge}>
          {icon}
        </Badge>
      </ListItemIcon>
      <ListItemText primary={label} slotProps={{ primary: { noWrap: true, fontSize: "0.85rem", fontWeight: "inherit" } }} />
    </>
  );
  return active === undefined ? (
    <ListItemButton component={NavLink} to={to} end={end} onClick={onClick} sx={sx}>
      {content}
    </ListItemButton>
  ) : (
    <ListItemButton component={RouterLink} to={to} onClick={onClick} aria-current={active ? "page" : undefined} sx={sx}>
      {content}
    </ListItemButton>
  );
}

function WorkspaceSwitcher() {
  const { me, org, ws } = useWs();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const navigate = useNavigate();
  const choices = me.orgs.flatMap((o) => o.workspaces.filter((w) => !w.archived).map((w) => ({ org: o.org, ws: w })));
  const single = choices.length <= 1;
  const label = (
    <Box sx={{ minWidth: 0, textAlign: "left", flex: 1 }}>
      <Typography variant="caption" color="text.secondary" noWrap component="div">
        {org.name}
      </Typography>
      <Typography variant="subtitle2" noWrap component="div">
        {ws.name}
      </Typography>
    </Box>
  );
  // §W1.6: single-org/single-workspace users never see a picker.
  if (single) return <Box sx={{ px: 1.5, py: 1 }}>{label}</Box>;
  return (
    <>
      <Button
        fullWidth
        color="inherit"
        onClick={(e) => setAnchor(e.currentTarget)}
        endIcon={<ExpandMoreRounded />}
        aria-haspopup="menu"
        aria-label={`Switch workspace (current: ${ws.name})`}
        sx={{ px: 1.5, py: 0.75, justifyContent: "space-between", fontWeight: 400 }}
      >
        {label}
      </Button>
      <Menu anchorEl={anchor} open={!!anchor} onClose={() => setAnchor(null)} slotProps={{ paper: { sx: { minWidth: 240 } } }}>
        {me.orgs.map((o) => [
          <ListSubheader key={o.org.id} sx={{ lineHeight: "28px", bgcolor: "transparent" }}>
            {o.org.name}
          </ListSubheader>,
          ...o.workspaces
            .filter((w) => !w.archived)
            .map((w) => (
              <MenuItem
                key={w.id}
                selected={w.id === ws.id}
                onClick={() => {
                  setAnchor(null);
                  navigate(wsPath(o.org, w));
                }}
              >
                {w.name}
              </MenuItem>
            )),
        ])}
      </Menu>
    </>
  );
}

function UserMenu() {
  const { me, org, role } = useWs();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const navigate = useNavigate();
  const logout = useLogout();
  const go = (to: string) => (setAnchor(null), navigate(to));
  return (
    <>
      <ListItemButton onClick={(e) => setAnchor(e.currentTarget)} sx={{ py: 0.75 }} aria-label="Account menu">
        <ListItemIcon sx={{ minWidth: 34 }}>
          <UserAvatar user={me.user} size={24} />
        </ListItemIcon>
        <ListItemText primary={me.user.name} secondary={role} slotProps={{ primary: { noWrap: true, fontSize: "0.85rem" }, secondary: { fontSize: "0.72rem" } }} />
      </ListItemButton>
      <Menu anchorEl={anchor} open={!!anchor} onClose={() => setAnchor(null)} anchorOrigin={{ vertical: "top", horizontal: "left" }} transformOrigin={{ vertical: "bottom", horizontal: "left" }}>
        <MenuItem onClick={() => go("/me/profile")}>
          <ListItemIcon>
            <PersonOutlineRounded fontSize="small" />
          </ListItemIcon>
          Profile & preferences
        </MenuItem>
        {can(role, "admin") && (
          <MenuItem onClick={() => go(`/o/${org.slug}/admin/members`)}>
            <ListItemIcon>
              <AdminPanelSettingsOutlined fontSize="small" />
            </ListItemIcon>
            Organization admin
          </MenuItem>
        )}
        {API_MODE === "mock" && (
          <MenuItem onClick={() => go("/dev")}>
            <ListItemIcon>
              <ScienceOutlined fontSize="small" />
            </ListItemIcon>
            Mock controls
          </MenuItem>
        )}
        <Divider />
        <MenuItem onClick={() => logout.mutate(undefined, { onSettled: () => navigate("/", { replace: true }) })}>
          <ListItemIcon>
            <LogoutRounded fontSize="small" />
          </ListItemIcon>
          Sign out
        </MenuItem>
      </Menu>
    </>
  );
}

function Rail({ onNavigate }: { onNavigate?: () => void }) {
  const { org, ws, role } = useWs();
  const base = wsPath(org, ws);
  const navigate = useNavigate();
  const { data: views } = useSavedViews(org.id, ws.id);
  const { data: collections } = useCollections(org.id, ws.id);
  const { data: notes } = useNotifications(org.id);
  const unread = notes?.some((n) => !n.readAt && n.workspaceId === ws.id);
  const pinned = views?.filter((v) => v.pinned) ?? [];
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const onSearch = location.pathname === `${base}/search`;
  return (
    <Stack sx={{ height: "100%", py: 1 }}>
      <Box sx={{ px: 1 }}>
        <WorkspaceSwitcher />
      </Box>
      {can(role, "member") && !ws.archived && (
        <Box sx={{ px: 1.5, py: 1 }}>
          <Button
            fullWidth
            variant="contained"
            startIcon={<AddRounded />}
            onClick={() => (onNavigate?.(), navigate(`${base}/new`))}
            sx={{ justifyContent: "space-between", "& .MuiButton-endIcon": { ml: "auto" } }}
            endIcon={<Box component="kbd" sx={{ fontSize: "0.7rem", opacity: 0.7, fontFamily: "'IBM Plex Mono', monospace", border: 1, borderColor: "currentColor", borderRadius: 0.5, px: 0.5, lineHeight: 1.3 }}>C</Box>}
          >
            New post
          </Button>
        </Box>
      )}
      <Box sx={{ flex: 1, overflow: "auto", px: 1 }}>
        <List dense disablePadding component="nav" aria-label="Workspace">
          <NavItem to={base} end icon={<DynamicFeedRounded />} label="Feed" onClick={onNavigate} />
          <NavItem to={`${base}/explore`} icon={<ExploreOutlined />} label="Explore" onClick={onNavigate} />
          {can(role, "member") && <NavItem to={`${base}/drafts`} icon={<EditNoteRounded />} label="My drafts" onClick={onNavigate} />}
          <NavItem to={`${base}/inbox`} icon={<InboxOutlined />} label="Inbox" badge={unread} onClick={onNavigate} />
          {can(role, "member") && <NavItem to={`${base}/import`} icon={<UploadFileOutlined />} label="Import deck" onClick={onNavigate} />}
          {can(role, "admin") && <NavItem to={`${base}/trash`} icon={<DeleteOutlineRounded />} label="Hidden & deleted" onClick={onNavigate} />}
        </List>
        {pinned.length > 0 && (
          <List dense disablePadding subheader={<ListSubheader sx={{ bgcolor: "transparent", lineHeight: "28px", fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.06em" }}>Saved views</ListSubheader>}>
            {pinned.map((v) => (
              <NavItem key={v.id} to={`${base}/search?${toSearchParams(v.filterSpec)}&view=${v.id}`} active={onSearch && params.get("view") === v.id} icon={<BookmarkBorderRounded />} label={v.name} onClick={onNavigate} />
            ))}
          </List>
        )}
        {!!collections?.length && (
          <List dense disablePadding subheader={<ListSubheader sx={{ bgcolor: "transparent", lineHeight: "28px", fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.06em" }}>Collections</ListSubheader>}>
            {collections.slice(0, 8).map((c) => (
              <NavItem key={c.id} to={`${base}/search?${collectionParams(c.id)}`} active={onSearch && !params.get("view") && specKey(fromSearchParams(params)) === specKey(fromSearchParams(collectionParams(c.id)))} icon={<CollectionsBookmarkOutlined />} label={c.name} onClick={onNavigate} />
            ))}
          </List>
        )}
      </Box>
      <Divider sx={{ mx: 1, mb: 0.5 }} />
      <Box sx={{ px: 1 }}>
        <UserMenu />
      </Box>
    </Stack>
  );
}

export function AppShell() {
  const scope = useWs();
  const theme = useTheme();
  const narrow = useMediaQuery(theme.breakpoints.down("md"));
  const [open, setOpen] = useState(false);
  const remember = useRememberWorkspace();
  const location = useLocation();
  const { mutate } = remember;
  const wsId = scope.ws.id;
  useEffect(() => {
    mutate(wsId);
  }, [wsId, mutate]);
  useEffect(() => setOpen(false), [location.pathname]);
  useShortcuts();
  useLiveEvents(scope.org.id, scope.ws.id);

  const presenting = location.pathname.endsWith("/present");
  if (presenting) return <Outlet />;

  return (
    <Box sx={{ display: "flex", minHeight: "100dvh", bgcolor: "background.default" }}>
      {narrow ? (
        <Drawer open={open} onClose={() => setOpen(false)} slotProps={{ paper: { sx: { width: RAIL_WIDTH + 24 } } }}>
          <Rail onNavigate={() => setOpen(false)} />
        </Drawer>
      ) : (
        <Box component="aside" sx={{ width: RAIL_WIDTH, flexShrink: 0, borderRight: 1, borderColor: "divider", bgcolor: "background.paper", position: "sticky", top: 0, height: "100dvh" }}>
          <Rail />
        </Box>
      )}
      <Box component="main" sx={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        {narrow && (
          <Stack direction="row" alignItems="center" spacing={1} sx={{ px: 1, py: 0.5, borderBottom: 1, borderColor: "divider", bgcolor: "background.paper", position: "sticky", top: 0, zIndex: 3 }}>
            <Tooltip title="Menu">
              <IconButton onClick={() => setOpen(true)} aria-label="Open navigation">
                <MenuRounded />
              </IconButton>
            </Tooltip>
            <Typography variant="subtitle2" noWrap>
              {scope.ws.name}
            </Typography>
          </Stack>
        )}
        <Outlet />
      </Box>
      <CommandPalette />
    </Box>
  );
}
