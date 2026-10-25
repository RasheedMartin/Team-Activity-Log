import { CollectionsBookmarkOutlined, ManageSearchRounded, SlideshowRounded, UploadFileOutlined } from "@mui/icons-material";
import { Box, Button, ButtonBase, Chip, Skeleton, Stack, Typography } from "@mui/material";
import { useMemo } from "react";
import { Link as RouterLink, useParams } from "react-router-dom";
import type { PostDetail } from "../../api/contract";
import { useCollection, usePostDetails } from "../../api/hooks";
import { useOrigin } from "../../app/origin";
import { useWs, wsPath } from "../../app/session";
import { RichText } from "../../components/RichText";
import { SlideCanvas } from "../../components/SlideCanvas";
import { EmptyState, ErrorState } from "../../components/ui";
import { blockDocs } from "../../lib/blocks";
import { formatDay } from "../../lib/dates";
import { docText } from "../../lib/prosemirror";
import { FavoriteButton } from "./FavoriteButton";
import { collectionParams } from "./libraryLinks";

/** A small picture of a post: its first designed slide, else its first picture, else its opening text. */
function Preview({ d }: { d: PostDetail }) {
  const images = useMemo(() => new Map(d.images.map((i) => [i.id, i])), [d.images]);
  const slide = d.post.blocks.find((b) => b.type === "slide");
  if (slide?.type === "slide") return <SlideCanvas design={slide.design} images={images} label={`Slide preview: ${d.post.title}`} />;
  const first = d.images[0];
  const thumb = first?.asset.variants.find((v) => v.name === "small") ?? first?.asset.variants[0];
  if (thumb) return <Box component="img" src={thumb.url} alt="" sx={{ width: "100%", aspectRatio: "16 / 9", objectFit: "cover", display: "block", borderRadius: 1, bgcolor: "action.hover" }} />;
  const text = blockDocs(d.post.blocks)[0];
  return (
    <Box sx={{ aspectRatio: "16 / 9", overflow: "hidden", borderRadius: 1, bgcolor: "action.hover", p: 1.25, fontSize: 11, maskImage: "linear-gradient(#000 70%, transparent)" }}>
      {text && docText(text).trim() ? <RichText doc={text} sx={{ fontSize: 11, "& p, & li": { my: 0.25 } }} /> : <Typography variant="caption" color="text.disabled">No text</Typography>}
    </Box>
  );
}

/**
 * A collection's own page: its posts in order as slide-like cards (an imported deck reads like
 * the deck), with Present, Favorite, the import it came from, and Search within for filtering.
 */
export default function CollectionPage() {
  const { id = "" } = useParams();
  const { org, ws } = useWs();
  const base = wsPath(org, ws);
  const c = useCollection(org.id, ws.id, id);
  const origin = useOrigin(c.data?.name ?? "collection"); // Back from a post or draft returns here
  const details = usePostDetails(org.id, c.data?.postIds ?? []);
  const loaded = details.filter((q) => q.data).map((q) => q.data!);
  const deck = c.data?.kind === "deck_import";
  const importJobId = loaded.find((d) => d.post.source?.kind === "import")?.post.source?.importJobId;
  const drafts = loaded.filter((d) => d.post.status === "draft").length;

  if (c.error) return <ErrorState error={c.error} onRetry={() => c.refetch()} />;
  if (!c.data) return <Skeleton variant="rounded" height={240} sx={{ m: 3 }} />;
  const coll = c.data;
  return (
    <Box sx={{ maxWidth: 1200, width: "100%", mx: "auto", px: { xs: 1.5, sm: 3 }, py: 3 }}>
      <Stack direction="row" alignItems="flex-start" spacing={1} useFlexGap sx={{ flexWrap: "wrap", mb: 2 }}>
        <Box sx={{ flex: 1, minWidth: 240 }}>
          <Stack direction="row" spacing={0.75} alignItems="center" sx={{ color: "text.secondary", mb: 0.5 }}>
            {deck ? <UploadFileOutlined sx={{ fontSize: 16 }} /> : <CollectionsBookmarkOutlined sx={{ fontSize: 16 }} />}
            <Typography variant="caption">{deck ? "Imported slides" : "Collection"}</Typography>
          </Stack>
          <Typography variant="h1" sx={{ fontSize: "1.6rem", wordBreak: "break-word" }}>{coll.name}</Typography>
          <Typography variant="body2" color="text.secondary">
            {coll.postIds.length} post{coll.postIds.length === 1 ? "" : "s"}
            {drafts > 0 && ` · ${drafts} still draft${drafts === 1 ? "" : "s"}`}
            {coll.updatedAt && ` · updated ${formatDay(coll.updatedAt.slice(0, 10))}`}
          </Typography>
        </Box>
        <Stack direction="row" spacing={1} useFlexGap alignItems="center" sx={{ flexWrap: "wrap" }}>
          <Button variant="contained" startIcon={<SlideshowRounded />} component={RouterLink} to={`${base}/present?collection=${coll.id}`} disabled={!coll.postIds.length}>
            Present
          </Button>
          {deck && importJobId && (
            <Button component={RouterLink} to={`${base}/import?job=${importJobId}`} startIcon={<UploadFileOutlined />}>
              Open import
            </Button>
          )}
          <Button component={RouterLink} to={`${base}/search?${collectionParams(coll.id)}`} startIcon={<ManageSearchRounded />}>
            Search within
          </Button>
          <FavoriteButton kind="collection" id={coll.id} name={coll.name} />
        </Stack>
      </Stack>

      {!coll.postIds.length ? (
        <EmptyState icon={<CollectionsBookmarkOutlined />} title="Nothing here yet" body="Posts added to this collection show up here, in order." />
      ) : (
        <Box component="ol" aria-label="Posts in this collection" sx={{ listStyle: "none", p: 0, m: 0, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 2 }}>
          {details.map((q, i) =>
            q.data ? (
              <Box component="li" key={q.data.post.id}>
                <ButtonBase
                  component={RouterLink}
                  to={q.data.post.status === "draft" ? `${base}/p/${q.data.post.id}/edit` : `${base}/p/${q.data.post.id}`}
                  state={origin}
                  sx={{ display: "block", width: "100%", textAlign: "left", borderRadius: 1.5, p: 1, border: 1, borderColor: "divider", bgcolor: "background.paper", "&:hover": { borderColor: "primary.main" } }}
                >
                  <Box sx={{ pointerEvents: "none" }}>
                    <Preview d={q.data} />
                  </Box>
                  <Stack direction="row" alignItems="center" spacing={1} sx={{ mt: 1 }}>
                    <Typography variant="caption" color="text.secondary" sx={{ fontVariantNumeric: "tabular-nums" }}>
                      {q.data.post.source?.slide ?? i + 1}
                    </Typography>
                    <Typography variant="body2" sx={{ fontWeight: 600, flex: 1, minWidth: 0 }} noWrap>
                      {q.data.post.title || "Untitled"}
                    </Typography>
                    {q.data.post.status === "draft" && <Chip size="small" label="Draft" color="warning" variant="outlined" />}
                  </Stack>
                </ButtonBase>
              </Box>
            ) : q.isPending ? (
              <Box component="li" key={i}>
                <Skeleton variant="rounded" sx={{ aspectRatio: "16 / 11", height: "auto" }} />
              </Box>
            ) : null,
          )}
        </Box>
      )}
    </Box>
  );
}
