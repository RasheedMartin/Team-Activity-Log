import { ArrowBackRounded, CallSplitRounded, ChevronLeftRounded, ChevronRightRounded, SlideshowRounded } from "@mui/icons-material";
import { Box, Button, Stack, Typography } from "@mui/material";
import { Link as RouterLink, useLocation, useNavigate } from "react-router-dom";
import type { ID, PostSource } from "../../api/contract";
import { useImportPosts, useSplitDraft } from "../../api/hooks";
import { useWs, wsPath } from "../../app/session";
import { useNotify } from "../../components/notify";
import { deckHref } from "../collections/libraryLinks";

/**
 * Where an imported draft came from, and the way back: "From deck.pptx · slide 3 of 12",
 * Back to the deck (where imported slides are reviewed), and Previous / Next among that import's
 * drafts still to review (slide order).
 */
export function ImportTrail({ source, postId, deckId }: { source: PostSource; postId: ID; deckId?: ID | null }) {
  const { org, ws } = useWs();
  const location = useLocation(); // Prev/Next keep where the review started, so Back returns there
  const posts = useImportPosts(org.id, source.importJobId);
  const siblings = (posts.data ?? []).filter((d) => d.status === "draft");
  const at = siblings.findIndex((d) => d.id === postId);
  // A draft just published leaves the list: step relative to its slide instead.
  const prev = at >= 0 ? siblings[at - 1] : [...siblings].reverse().find((d) => (d.source?.slide ?? 0) < source.slide);
  const next = at >= 0 ? siblings[at + 1] : siblings.find((d) => (d.source?.slide ?? 0) > source.slide);
  const edit = (id: ID) => wsPath(org, ws, `/p/${id}/edit`);
  const back = deckId ? deckHref(wsPath(org, ws), deckId, true) : `${wsPath(org, ws, "/import")}?job=${source.importJobId}`;
  const split = useSplitDraft(org.id);
  const navigate = useNavigate();
  const notify = useNotify();
  const merged = source.mergedFrom ?? [];
  return (
    <Stack direction="row" alignItems="center" useFlexGap spacing={1} sx={{ flexWrap: "wrap", mb: 2, px: 1.5, py: 0.75, borderRadius: 1, bgcolor: "action.hover" }} component="nav" aria-label="Import">
      <SlideshowRounded fontSize="small" sx={{ color: "text.secondary" }} />
      <Typography variant="body2" sx={{ flex: 1, minWidth: 160 }}>
        From “{source.fileName}” · slide {source.slide} of {source.slideCount}
        {siblings.length > 0 && (
          <Box component="span" sx={{ color: "text.secondary" }}>
            {" "}
            · {siblings.length} draft{siblings.length === 1 ? "" : "s"} to review
          </Box>
        )}
        {merged.length > 0 && (
          <Box component="span" sx={{ display: "block", color: "text.secondary" }}>
            Combined with {merged.map((x) => (x.slide ? `slide ${x.slide}` : `“${x.title || "Untitled"}”`)).join(", ")}
          </Box>
        )}
      </Typography>
      {merged.length > 0 && (
        <Button size="small" startIcon={<CallSplitRounded />} disabled={split.isPending} onClick={() => split.mutate(postId, { onSuccess: () => (navigate(back), notify("Split back into separate slides")), onError: (e) => notify(e.message) })}>
          Split back
        </Button>
      )}
      {prev ? (
        <Button size="small" component={RouterLink} to={edit(prev.id)} state={location.state} startIcon={<ChevronLeftRounded />} aria-label="Previous imported draft">
          Prev
        </Button>
      ) : (
        <Button size="small" disabled startIcon={<ChevronLeftRounded />} aria-label="Previous imported draft">
          Prev
        </Button>
      )}
      {next ? (
        <Button size="small" component={RouterLink} to={edit(next.id)} state={location.state} endIcon={<ChevronRightRounded />} aria-label="Next imported draft">
          Next
        </Button>
      ) : (
        <Button size="small" disabled endIcon={<ChevronRightRounded />} aria-label="Next imported draft">
          Next
        </Button>
      )}
      <Button size="small" variant="outlined" component={RouterLink} to={back} startIcon={<ArrowBackRounded />}>
        Back to deck
      </Button>
    </Stack>
  );
}
