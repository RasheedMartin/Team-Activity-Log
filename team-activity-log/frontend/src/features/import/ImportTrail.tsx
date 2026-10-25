import { ArrowBackRounded, ChevronLeftRounded, ChevronRightRounded, SlideshowRounded } from "@mui/icons-material";
import { Box, Button, Stack, Typography } from "@mui/material";
import { Link as RouterLink, useLocation } from "react-router-dom";
import type { ID, PostSource } from "../../api/contract";
import { useImportPosts } from "../../api/hooks";
import { useWs, wsPath } from "../../app/session";

/**
 * Where an imported draft came from, and the way back: "From deck.pptx · slide 3 of 12",
 * Back to import, and Previous / Next among that import's drafts still to review (slide order).
 */
export function ImportTrail({ source, postId }: { source: PostSource; postId: ID }) {
  const { org, ws } = useWs();
  const location = useLocation(); // Prev/Next keep where the review started, so Back returns there
  const posts = useImportPosts(org.id, source.importJobId);
  const siblings = (posts.data ?? []).filter((d) => d.status === "draft");
  const at = siblings.findIndex((d) => d.id === postId);
  // A draft just published leaves the list: step relative to its slide instead.
  const prev = at >= 0 ? siblings[at - 1] : [...siblings].reverse().find((d) => (d.source?.slide ?? 0) < source.slide);
  const next = at >= 0 ? siblings[at + 1] : siblings.find((d) => (d.source?.slide ?? 0) > source.slide);
  const edit = (id: ID) => wsPath(org, ws, `/p/${id}/edit`);
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
      </Typography>
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
      <Button size="small" variant="outlined" component={RouterLink} to={`${wsPath(org, ws, "/import")}?job=${source.importJobId}`} startIcon={<ArrowBackRounded />}>
        Back to import
      </Button>
    </Stack>
  );
}
