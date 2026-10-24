import { AddRounded, DeleteOutlineRounded, EditNoteRounded, ImageOutlined } from "@mui/icons-material";
import { Button, IconButton, List, ListItem, ListItemButton, ListItemText, Paper, Skeleton, Stack, Tooltip, Typography } from "@mui/material";
import { useNavigate } from "react-router-dom";
import { useDrafts, usePostAction } from "../../api/hooks";
import { useWs, wsPath } from "../../app/session";
import { useNotify } from "../../components/notify";
import { EmptyState, ErrorState, Kbd } from "../../components/ui";
import { timeAgo } from "../../lib/dates";
import { errorMessage } from "../../lib/format";
import { ActivityPanel } from "./Section";

/** My drafts (§W2.5): private to the author; discard with undo. */
export default function DraftsTab() {
  const { org, ws } = useWs();
  const drafts = useDrafts(org.id, ws.id);
  const action = usePostAction(org.id);
  const notify = useNotify();
  const navigate = useNavigate();
  const list = drafts.data ?? [];
  const discard = (id: string, title: string) =>
    action.mutate(
      { id, action: "delete" },
      { onSuccess: () => notify(`Discarded “${title || "Untitled"}”`, () => action.mutate({ id, action: "restore" })), onError: (e) => notify(errorMessage(e)) },
    );
  return (
    <ActivityPanel
      label="Drafts"
      sub="Only you can see these."
      actions={<Button startIcon={<AddRounded />} onClick={() => navigate(wsPath(org, ws, "/new"))}>New post</Button>}
    >
      {drafts.isPending ? (
        <Stack spacing={1}>{[0, 1].map((i) => <Skeleton key={i} variant="rounded" height={56} />)}</Stack>
      ) : drafts.error ? (
        <ErrorState error={drafts.error} onRetry={() => drafts.refetch()} />
      ) : !list.length ? (
        <EmptyState icon={<EditNoteRounded />} title="No drafts" body={<>Press <Kbd>C</Kbd> to start one.</>} />
      ) : (
        <Paper variant="outlined">
          <List disablePadding>
            {list.map((d, i) => (
              <ListItem
                key={d.id}
                disablePadding
                divider={i < list.length - 1}
                secondaryAction={
                  <Tooltip title="Discard draft">
                    <IconButton edge="end" onClick={() => discard(d.id, d.title)} aria-label={`Discard ${d.title || "untitled draft"}`}>
                      <DeleteOutlineRounded fontSize="small" />
                    </IconButton>
                  </Tooltip>
                }
              >
                <ListItemButton onClick={() => navigate(wsPath(org, ws, `/p/${d.id}/edit`))}>
                  <ListItemText
                    primary={d.title || <Typography component="span" color="text.disabled">Untitled</Typography>}
                    secondary={
                      <Stack direction="row" spacing={1.5} component="span" alignItems="center">
                        <span>Edited {timeAgo(d.updatedAt)}</span>
                        {d.imageCount > 0 && (
                          <Stack direction="row" spacing={0.25} component="span" alignItems="center">
                            <ImageOutlined sx={{ fontSize: 14 }} />
                            <span>{d.imageCount}</span>
                          </Stack>
                        )}
                      </Stack>
                    }
                  />
                </ListItemButton>
              </ListItem>
            ))}
          </List>
        </Paper>
      )}
    </ActivityPanel>
  );
}
