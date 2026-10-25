import { AddRounded, ChevronRightRounded, EditNoteRounded, UploadFileOutlined } from "@mui/icons-material";
import { Button, List, ListItem, ListItemButton, ListItemIcon, ListItemText, Paper, Skeleton, Stack, Typography } from "@mui/material";
import { Link as RouterLink, useNavigate } from "react-router-dom";
import { useDrafts, useMyImports } from "../../api/hooks";
import { useWs, wsPath } from "../../app/session";
import { EmptyState, ErrorState, Kbd } from "../../components/ui";
import { importHome } from "../collections/libraryLinks";
import { DraftList } from "./DraftList";
import { ActivityPanel } from "./Section";

/**
 * My drafts (§W2.5): private to the author; select some or all to publish or discard together.
 * Slides from an import aren't listed one by one (owner request): each unfinished import is one
 * row that opens its deck, where those slides are reviewed.
 */
export default function DraftsTab() {
  const { org, ws } = useWs();
  const base = wsPath(org, ws);
  const drafts = useDrafts(org.id, ws.id);
  const imports = useMyImports(org.id, ws.id);
  const navigate = useNavigate();
  const all = drafts.data ?? [];
  const decks = (imports.data ?? []).filter((i) => i.status === "done" && i.drafts > 0 && i.collectionId);
  const inDeck = new Set(decks.map((i) => i.id));
  const list = all.filter((d) => !d.source || !inDeck.has(d.source.importJobId)); // (a deck we can't link to keeps its drafts here)
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
      ) : !list.length && !decks.length ? (
        <EmptyState icon={<EditNoteRounded />} title="No drafts" body={<>Press <Kbd>C</Kbd> to start one.</>} />
      ) : (
        <Stack spacing={2}>
          {decks.length > 0 && (
            <Paper variant="outlined">
              <List disablePadding aria-label="Unfinished imports">
                {decks.map((i, k) => (
                  <ListItem key={i.id} disablePadding divider={k < decks.length - 1}>
                    <ListItemButton component={RouterLink} to={importHome(base, i.collectionId!, i.fileKind, true)}>
                      <ListItemIcon sx={{ minWidth: 40 }}><UploadFileOutlined sx={{ color: "primary.main" }} /></ListItemIcon>
                      <ListItemText
                        primary={i.sourceFilename}
                        secondary={<Typography component="span" variant="body2" sx={{ color: "warning.main", fontWeight: 600 }}>{i.drafts} of {i.drafts + i.published} {i.fileKind === "pdf" || i.fileKind === "docx" ? "pages" : "slides"} to review</Typography>}
                      />
                      <ChevronRightRounded sx={{ color: "text.secondary" }} />
                    </ListItemButton>
                  </ListItem>
                ))}
              </List>
            </Paper>
          )}
          {list.length > 0 && <DraftList drafts={list} />}
        </Stack>
      )}
    </ActivityPanel>
  );
}
