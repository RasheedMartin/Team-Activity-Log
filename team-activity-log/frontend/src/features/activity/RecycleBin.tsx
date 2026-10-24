import { DeleteOutlineRounded } from "@mui/icons-material";
import { Box, Button, Chip, List, ListItem, ListItemText, Paper, Skeleton, Stack } from "@mui/material";
import { Navigate, Link as RouterLink } from "react-router-dom";
import { usePeople, usePostAction, useTrash } from "../../api/hooks";
import { useOrigin } from "../../app/origin";
import { can, useWs, wsPath } from "../../app/session";
import { useNotify } from "../../components/notify";
import { EmptyState, ErrorState } from "../../components/ui";
import { timeAgo } from "../../lib/dates";
import { errorMessage } from "../../lib/format";
import { ActivityPanel } from "./Section";

/** Admin view of deleted and hidden posts (§W2.8, §A5), under the name people already know. */
export default function RecycleBinTab() {
  const { org, ws, role } = useWs();
  const isAdmin = can(role, "admin");
  const trash = useTrash(org.id, ws.id, isAdmin);
  const origin = useOrigin("Recycle bin");
  const action = usePostAction(org.id);
  const notify = useNotify();
  const { data: people = [] } = usePeople(org.id);
  const name = (id?: string) => people.find((p) => p.id === id)?.name ?? "someone";
  const rows = [...(trash.data?.deleted ?? []).map((p) => ({ p, kind: "deleted" as const })), ...(trash.data?.hidden ?? []).map((p) => ({ p, kind: "hidden" as const }))];
  if (!isAdmin) return <Navigate to=".." relative="path" replace />;
  return (
    <ActivityPanel label="Recycle bin" sub="Deleted posts are kept for 30 days.">
      {trash.isPending ? (
        <Skeleton variant="rounded" height={56} />
      ) : trash.error ? (
        <ErrorState error={trash.error} onRetry={() => trash.refetch()} />
      ) : !rows.length ? (
        <EmptyState icon={<DeleteOutlineRounded />} title="The recycle bin is empty" />
      ) : (
        <Paper variant="outlined">
          <List disablePadding>
            {rows.map(({ p, kind }, i) => (
              <ListItem
                key={p.id}
                divider={i < rows.length - 1}
                secondaryAction={
                  <Button size="small" onClick={() => action.mutate({ id: p.id, action: kind === "deleted" ? "restore" : "show" }, { onSuccess: () => notify("Restored"), onError: (e) => notify(errorMessage(e)) })}>
                    Restore
                  </Button>
                }
              >
                <ListItemText
                  primary={
                    <Stack direction="row" spacing={1} alignItems="center" component="span">
                      <Box component={RouterLink} to={wsPath(org, ws, `/p/${p.id}`)} state={origin} sx={{ color: "inherit" }}>{p.title || "Untitled"}</Box>
                      <Chip size="small" variant="outlined" label={kind === "deleted" ? "Deleted" : "Hidden"} component="span" />
                    </Stack>
                  }
                  secondary={kind === "deleted" ? `by ${name(p.authorId)} · deleted ${timeAgo(p.deletedAt!)}` : `by ${name(p.authorId)} · hidden by ${name(p.hiddenBy)}${p.hiddenReason ? `: “${p.hiddenReason}”` : ""}`}
                  sx={{ pr: 10 }}
                />
              </ListItem>
            ))}
          </List>
        </Paper>
      )}
    </ActivityPanel>
  );
}
