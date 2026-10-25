import {
  AddRounded,
  AdminPanelSettingsOutlined,
  HomeOutlined,
  SearchRounded,
  ExpandMoreRounded,
  NotificationsNoneRounded,
  LibraryBooksOutlined,
  LogoutRounded,
  MenuRounded,
  PersonOutlineRounded,
  PublicOutlined,
  ScienceOutlined,
  SlideshowOutlined,
  StarRounded,
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
import { useLogout, useNotifications, usePins, useRememberWorkspace } from "../api/hooks";
import { libraryHref } from "../features/collections/libraryLinks";
import { KINDS, favoriteDomId } from "../features/collections/concepts";

const PINS_SHOWN = 10;
import { UserAvatar } from "../components/ui";
import { BRAND } from "./brand";
import { can, useWs, wsPath } from "./session";
import { useShortcuts } from "./shortcuts";
import { CommandPalette } from "../features/search/CommandPalette";
import { SlideDrop } from "../features/import/SlideDrop";
import { useLiveEvents } from "../features/discussion/live";

const RAIL_WIDTH = 232;

/**
 * Rail link. NavLink matches on the path only, so links that differ only by query string (saved
 * views, collections — all `/search?…`) pass `active` explicitly instead.
 */
function NavItem({ to, icon, label, end, badge, onClick, active, id }: { to: string; icon: ReactNode; label: string; end?: boolean; badge?: boolean; onClick?: () => void; active?: boolean; id?: string }) {
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
    <ListItemButton id={id} component={NavLink} to={to} end={end} onClick={onClick} sx={sx}>
      {content}
    </ListItemButton>
  ) : (
    <ListItemButton id={id} component={RouterLink} to={to} onClick={onClick} aria-current={active ? "page" : undefined} sx={sx}>
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
        {/* The public home page (`/` sends signed-in people straight to their workspace). */}
        <MenuItem onClick={() => go("/about")}>
          <ListItemIcon>
            <PublicOutlined fontSize="small" />
          </ListItemIcon>
          About {BRAND.name}
        </MenuItem>
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
  // The rail shows only what *you* pinned (scale: a workspace may have hundreds of views,
  // notebooks, and collections; everything else lives in the Library).
  const { data: pins = [] } = usePins(org.id, ws.id);
  const { data: notes } = useNotifications(org.id);
  const unread = notes?.some((n) => !n.readAt && n.workspaceId === ws.id);
  const shownPins = pins.slice(0, PINS_SHOWN);
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const onSearch = location.pathname === `${base}/search`;
  const pinIsActive = (item: (typeof pins)[number]) => (item.kind === "view" ? onSearch && params.get("view") === item.id : location.pathname === libraryHref(base, item));
  const pinActive = shownPins.some(pinIsActive);
  return (
    <Stack sx={{ height: "100%", py: 1 }}>
      <Box sx={{ px: 1 }}>
        <WorkspaceSwitcher />
      </Box>
      {can(role, "member") && !ws.archived && (
        <Box sx={{ px: 1.5, pt: 1.5, pb: 2, mb: 1, borderBottom: 1, borderColor: "divider" }}>
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
          {/* Second way in: decks become searchable posts. A button, not a nav row, because it starts work. */}
          <Button fullWidth variant="outlined" component={RouterLink} to={`${base}/import`} onClick={onNavigate} startIcon={<SlideshowOutlined />} sx={{ mt: 1, justifyContent: "flex-start" }}>
            Import slides
          </Button>
        </Box>
      )}
      <Box sx={{ flex: 1, overflow: "auto", px: 1 }}>
        <List dense disablePadding component="nav" aria-label="Workspace">
          <NavItem to={base} end icon={<HomeOutlined />} label="Home" onClick={onNavigate} />
          {/* Search is the all-posts list; it's "current" unless a pinned view/collection is. */}
          <NavItem to={`${base}/search`} icon={<SearchRounded />} label="Search" active={onSearch && !pinActive} onClick={onNavigate} />
          <NavItem to={`${base}/activity`} icon={<NotificationsNoneRounded />} label="Activity" badge={unread} onClick={onNavigate} />
          <NavItem to={`${base}/library`} icon={<LibraryBooksOutlined />} label="Library" onClick={onNavigate} />
        </List>
        {/* Favorites: what *you* starred (the API calls them pins). Hidden until there's one. */}
        {pins.length > 0 && (
          <List
            dense
            disablePadding
            aria-label="Favorites"
            subheader={
              <ListSubheader sx={{ bgcolor: "transparent", lineHeight: "28px", mt: 1, fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.06em", display: "flex", alignItems: "center", gap: 0.5 }}>
                <StarRounded sx={{ fontSize: 13 }} /> Favorites
              </ListSubheader>
            }
          >
            {shownPins.map((item) => (
              <NavItem
                key={`${item.kind}-${item.id}`}
                id={favoriteDomId(item.kind, item.id)}
                to={libraryHref(base, item)}
                active={item.kind === "notebook" ? undefined : pinIsActive(item)}
                icon={KINDS[item.kind].icon}
                label={item.name}
                onClick={onNavigate}
              />
            ))}
            {pins.length > PINS_SHOWN && (
              <Typography component={RouterLink} to={`${base}/library`} onClick={onNavigate} variant="caption" color="text.secondary" sx={{ display: "block", px: 2, py: 0.5 }}>
                {pins.length - PINS_SHOWN} more in Library
              </Typography>
            )}
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
        <Box component="aside" data-print-hide sx={{ width: RAIL_WIDTH, flexShrink: 0, borderRight: 1, borderColor: "divider", bgcolor: "background.paper", position: "sticky", top: 0, height: "100dvh" }}>
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
      <SlideDrop />
    </Box>
  );
}
