import { AddRounded, EditNoteRounded } from "@mui/icons-material";
import { Button, Skeleton, Stack } from "@mui/material";
import { useNavigate } from "react-router-dom";
import { useDrafts } from "../../api/hooks";
import { useWs, wsPath } from "../../app/session";
import { EmptyState, ErrorState, Kbd } from "../../components/ui";
import { DraftList } from "./DraftList";
import { ActivityPanel } from "./Section";

/** My drafts (§W2.5): private to the author; select some or all to publish or discard together. */
export default function DraftsTab() {
  const { org, ws } = useWs();
  const drafts = useDrafts(org.id, ws.id);
  const navigate = useNavigate();
  const list = drafts.data ?? [];
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
        <DraftList drafts={list} />
      )}
    </ActivityPanel>
  );
}
