import { CheckRounded, NotificationsActiveRounded, NotificationsNoneRounded } from "@mui/icons-material";
import { Box, IconButton, ListItemIcon, ListItemText, Menu, MenuItem, Tooltip, Typography } from "@mui/material";
import { useState } from "react";
import type { AlertMode, SavedView } from "../../api/contract";
import { useSetAlert } from "../../api/hooks";
import { useWs } from "../../app/session";
import { useNotify } from "../../components/notify";
import { errorMessage } from "../../lib/format";

const OPTIONS: { mode: AlertMode | "off"; label: string; sub?: string; done: string }[] = [
  { mode: "instant", label: "As they're published", sub: "In Activity", done: "You'll see new matches in Activity" },
  { mode: "daily", label: "Daily digest", sub: "In Activity, and by email once a day", done: "You'll get a daily email when there's something new" },
  { mode: "weekly", label: "Weekly digest", sub: "In Activity, and by email once a week", done: "You'll get a weekly email when there's something new" },
  { mode: "off", label: "Off", done: "Alerts off for this search" },
];
const SHORT: Record<AlertMode, string> = { instant: "as they're published", daily: "daily", weekly: "weekly" };

/** Follow a saved search: hear about new posts that match it (owner request: saved-search alerts). */
export function AlertButton({ view }: { view: SavedView }) {
  const { org, ws } = useWs();
  const notify = useNotify();
  const set = useSetAlert(org.id, ws.id);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const on = view.alert;
  return (
    <>
      <Tooltip title={on ? `Alerts on: ${SHORT[on]}` : "Get alerts for new matches"}>
        <IconButton size="small" onClick={(e) => setAnchor(e.currentTarget)} aria-label={on ? `Alerts: ${SHORT[on]}` : "Alerts"} aria-haspopup="menu" color={on ? "primary" : "default"}>
          {on ? <NotificationsActiveRounded fontSize="small" /> : <NotificationsNoneRounded fontSize="small" />}
        </IconButton>
      </Tooltip>
      <Menu anchorEl={anchor} open={!!anchor} onClose={() => setAnchor(null)} slotProps={{ paper: { sx: { maxWidth: 320 } } }}>
        <Box sx={{ px: 2, pt: 0.5, pb: 1 }}>
          <Typography sx={{ fontWeight: 600 }}>Tell me about new posts</Typography>
          <Typography variant="caption" color="text.secondary">Posts published from now on that match “{view.name}”. Your own posts don't count.</Typography>
        </Box>
        {OPTIONS.map((o) => {
          const selected = (on ?? "off") === o.mode;
          return (
            <MenuItem
              key={o.mode}
              selected={selected}
              disabled={set.isPending}
              onClick={() => {
                setAnchor(null);
                if (!selected) set.mutateAsync({ id: view.id, mode: o.mode }).then(() => notify(o.done), (e) => notify(errorMessage(e)));
              }}
            >
              <ListItemIcon>{selected && <CheckRounded fontSize="small" />}</ListItemIcon>
              <ListItemText primary={o.label} secondary={o.sub} />
            </MenuItem>
          );
        })}
      </Menu>
    </>
  );
}
