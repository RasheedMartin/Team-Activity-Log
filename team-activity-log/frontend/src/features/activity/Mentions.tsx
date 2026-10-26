import { AlternateEmailRounded, DoneAllRounded, InboxOutlined, NotificationsActiveRounded, ReplyRounded } from "@mui/icons-material";
import { Avatar, Box, Button, List, ListItemButton, ListItemAvatar, ListItemText, Paper, Skeleton, Stack, ToggleButton, ToggleButtonGroup, Typography } from "@mui/material";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMarkRead, useNotifications, usePeople } from "../../api/hooks";
import { useOrigin } from "../../app/origin";
import { useWs, wsPath } from "../../app/session";
import { EmptyState, ErrorState, UserAvatar } from "../../components/ui";
import { timeAgo } from "../../lib/dates";
import { ActivityPanel } from "./Section";

/** Mentions, replies, and saved-search alerts (§W3.5). Quiet: no push, no red badges — a dot in
 * the rail at most. */
export default function MentionsTab() {
  const { org, ws } = useWs();
  const q = useNotifications(org.id);
  const origin = useOrigin("Activity");
  const mark = useMarkRead(org.id);
  const navigate = useNavigate();
  const { data: people = [] } = usePeople(org.id);
  const [filter, setFilter] = useState<"unread" | "all">("unread");
  const all = (q.data ?? []).filter((n) => n.workspaceId === ws.id);
  const list = filter === "unread" ? all.filter((n) => !n.readAt) : all;
  const unread = all.filter((n) => !n.readAt).length;
  return (
    <ActivityPanel
      label="Mentions & alerts"
      sub="@mentions, replies to you, and new posts in saved searches you follow."
      actions={
        <Stack direction="row" spacing={1} alignItems="center">
          <ToggleButtonGroup size="small" exclusive value={filter} onChange={(_, v) => v && setFilter(v)} aria-label="Show">
            <ToggleButton value="unread">Unread{unread ? ` (${unread})` : ""}</ToggleButton>
            <ToggleButton value="all">All</ToggleButton>
          </ToggleButtonGroup>
          <Button startIcon={<DoneAllRounded />} disabled={!unread} onClick={() => mark.mutate(all.filter((n) => !n.readAt).map((n) => n.id))}>
            Mark all read
          </Button>
        </Stack>
      }
    >
      {q.isPending ? (
        <Stack spacing={1}>{[0, 1].map((i) => <Skeleton key={i} variant="rounded" height={64} />)}</Stack>
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !list.length ? (
        <EmptyState icon={<InboxOutlined />} title={filter === "unread" ? "You're all caught up" : "Nothing yet"} />
      ) : (
        <Paper variant="outlined">
          <List disablePadding>
            {list.map((n, i) => {
              const actor = people.find((p) => p.id === n.actorId);
              const alert = n.kind === "alert";
              const many = alert && (n.count ?? 1) > 1;
              return (
                <ListItemButton
                  key={n.id}
                  divider={i < list.length - 1}
                  onClick={() => {
                    if (!n.readAt) mark.mutate([n.id]);
                    // An alert for several posts opens the saved search (newest first); one opens the post.
                    if (many) navigate(`${wsPath(org, ws, "/search")}?view=${n.savedViewId}`);
                    else navigate(`${wsPath(org, ws, `/p/${n.postId}`)}${n.commentId ? `#comment-${n.commentId}` : ""}`, { state: origin });
                  }}
                  sx={{ alignItems: "flex-start", py: 1.25 }}
                >
                  <ListItemAvatar sx={{ minWidth: 44, mt: 0.25 }}>
                    {alert ? (
                      <Avatar sx={{ width: 30, height: 30, bgcolor: "action.selected", color: "primary.main" }}>
                        <NotificationsActiveRounded sx={{ fontSize: 17 }} />
                      </Avatar>
                    ) : (
                      <UserAvatar user={actor} size={30} />
                    )}
                  </ListItemAvatar>
                  <ListItemText
                    primary={
                      <Stack direction="row" spacing={0.75} alignItems="center" component="span">
                        {alert ? null : n.kind === "mention" ? <AlternateEmailRounded sx={{ fontSize: 15, color: "text.secondary" }} /> : <ReplyRounded sx={{ fontSize: 15, color: "text.secondary" }} />}
                        <Typography component="span" variant="body2" sx={{ fontWeight: n.readAt ? 400 : 600 }}>
                          {alert
                            ? `${many ? `${n.count} new posts match` : "New post matches"} “${n.viewName ?? "a saved search"}”`
                            : `${actor?.name ?? "Someone"} ${n.kind === "mention" ? "mentioned you" : "replied"} in “${n.postTitle ?? "a post"}”`}
                        </Typography>
                      </Stack>
                    }
                    secondary={alert ? `${many ? "Newest: " : ""}${n.postTitle ?? "Untitled"}` : n.excerpt}
                    slotProps={{ secondary: { sx: { mt: 0.25, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" } } }}
                  />
                  <Stack alignItems="flex-end" spacing={0.75} sx={{ ml: 1, flexShrink: 0 }}>
                    <Typography variant="caption" color="text.secondary">{timeAgo(n.createdAt)}</Typography>
                    {!n.readAt && <Box aria-label="Unread" sx={{ width: 8, height: 8, borderRadius: "50%", bgcolor: "primary.main" }} />}
                  </Stack>
                </ListItemButton>
              );
            })}
          </List>
        </Paper>
      )}
    </ActivityPanel>
  );
}
