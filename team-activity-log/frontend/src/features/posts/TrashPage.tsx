import { Box, Button, List, ListItem, ListItemText, Paper, Stack, Typography } from "@mui/material";
import { Link as RouterLink, Navigate } from "react-router-dom";
import type { Post } from "../../api/contract";
import { usePeople, usePostAction, useTrash } from "../../api/hooks";
import { can, useWs, wsPath } from "../../app/session";
import { useNotify } from "../../components/notify";
import { ErrorState, PageHeader } from "../../components/ui";
import { timeAgo } from "../../lib/dates";
import { errorMessage } from "../../lib/format";
import { useOrigin } from "../../app/origin";

/** Admin view of hidden and deleted posts (§W2.8, §A5). */
export default function TrashPage() {
  const { org, ws, role } = useWs();
  const trash = useTrash(org.id, ws.id);
  const action = usePostAction(org.id);
  const notify = useNotify();
  const { data: people = [] } = usePeople(org.id);
  const origin = useOrigin("Hidden & deleted");
  if (!can(role, "admin")) return <Navigate to={wsPath(org, ws)} replace />;
  const name = (id?: string) => people.find((p) => p.id === id)?.name ?? "someone";
  const section = (title: string, list: Post[], kind: "deleted" | "hidden") => (
    <Box sx={{ mb: 3 }}>
      <Typography variant="h3" sx={{ mb: 1 }}>{title} <Typography component="span" color="text.secondary">({list.length})</Typography></Typography>
      {!list.length ? (
        <Typography variant="body2" color="text.secondary">Nothing here.</Typography>
      ) : (
        <Paper variant="outlined">
          <List disablePadding>
            {list.map((p, i) => (
              <ListItem
                key={p.id}
                divider={i < list.length - 1}
                secondaryAction={
                  <Button size="small" onClick={() => action.mutate({ id: p.id, action: kind === "deleted" ? "restore" : "show" }, { onSuccess: () => notify(kind === "deleted" ? "Restored" : "Visible again"), onError: (e) => notify(errorMessage(e)) })}>
                    {kind === "deleted" ? "Restore" : "Show"}
                  </Button>
                }
              >
                <ListItemText
                  primary={<RouterLink to={wsPath(org, ws, `/p/${p.id}`)} state={origin} style={{ color: "inherit" }}>{p.title || "Untitled"}</RouterLink>}
                  secondary={kind === "deleted" ? `by ${name(p.authorId)} · deleted ${timeAgo(p.deletedAt!)}` : `by ${name(p.authorId)} · hidden by ${name(p.hiddenBy)}${p.hiddenReason ? `: “${p.hiddenReason}”` : ""}`}
                  sx={{ pr: 10 }}
                />
              </ListItem>
            ))}
          </List>
        </Paper>
      )}
    </Box>
  );
  return (
    <Box sx={{ maxWidth: 860, width: "100%", mx: "auto", px: { xs: 1.5, sm: 3 }, py: 3 }}>
      <PageHeader title="Hidden & deleted" sub="Deleted posts can be restored for 30 days, then they're purged." />
      {trash.error ? (
        <ErrorState error={trash.error} onRetry={() => trash.refetch()} />
      ) : (
        <Stack>
          {section("Hidden", trash.data?.hidden ?? [], "hidden")}
          {section("Deleted", trash.data?.deleted ?? [], "deleted")}
        </Stack>
      )}
    </Box>
  );
}
