import { CheckCircleRounded, CloseRounded, RadioButtonUncheckedRounded } from "@mui/icons-material";
import { Box, IconButton, List, ListItemButton, ListItemIcon, ListItemText, Paper, Typography } from "@mui/material";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMembers } from "../../api/hooks";
import { can, useWs, wsPath } from "../../app/session";

const key = (userId: string) => `tal.onboarding-dismissed.${userId}`;
const readDismissed = (userId: string) => {
  try {
    return localStorage.getItem(key(userId)) === "1";
  } catch {
    return false;
  }
};

/** §W1.1: a dismissible checklist in an empty workspace (invite · write · import). Shown once. */
export function OnboardingChecklist({ hasPosts }: { hasPosts: boolean }) {
  const { me, org, ws, role } = useWs();
  const navigate = useNavigate();
  const [dismissed, setDismissed] = useState(() => readDismissed(me.user.id));
  const { data: members } = useMembers(org.id);
  if (dismissed || !can(role, "member")) return null;
  const invited = (members?.length ?? 0) > 1;
  const items = [
    ...(can(role, "admin") ? [{ label: "Invite teammates", done: invited, to: `/o/${org.slug}/admin/members` }] : []),
    { label: "Write your first post", done: hasPosts, to: wsPath(org, ws, "/new") },
    { label: "Import slides from PowerPoint", done: false, to: wsPath(org, ws, "/import") },
  ];
  const dismiss = () => {
    try {
      localStorage.setItem(key(me.user.id), "1");
    } catch {
      // storage blocked: dismissal lasts for this session only
    }
    setDismissed(true);
  };
  return (
    <Paper variant="outlined" sx={{ p: 2, mb: 2, position: "relative" }}>
      <IconButton size="small" onClick={dismiss} aria-label="Dismiss getting started" sx={{ position: "absolute", top: 8, right: 8 }}>
        <CloseRounded fontSize="small" />
      </IconButton>
      <Typography variant="h4">Get started in {ws.name}</Typography>
      <Box>
        <List dense disablePadding sx={{ mt: 1 }}>
          {items.map((i) => (
            <ListItemButton key={i.label} onClick={() => navigate(i.to)} sx={{ borderRadius: 1 }}>
              <ListItemIcon sx={{ minWidth: 30 }}>
                {i.done ? <CheckCircleRounded color="success" fontSize="small" /> : <RadioButtonUncheckedRounded fontSize="small" color="disabled" />}
              </ListItemIcon>
              <ListItemText primary={i.label} sx={{ textDecoration: i.done ? "line-through" : undefined, color: i.done ? "text.secondary" : undefined }} />
            </ListItemButton>
          ))}
        </List>
      </Box>
    </Paper>
  );
}
