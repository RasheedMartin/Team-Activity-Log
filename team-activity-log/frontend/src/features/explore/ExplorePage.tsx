import { ArrowForwardRounded, GridViewRounded, ImageOutlined, MenuBookOutlined, SlideshowRounded } from "@mui/icons-material";
import { Box, Button, ButtonBase, Chip, Skeleton, Stack, Typography } from "@mui/material";
import { useMemo, useState } from "react";
import { Link as RouterLink, useNavigate, useSearchParams } from "react-router-dom";
import type { ExploreShelf, FilterSpec, GalleryImage } from "../../api/contract";
import { collectPostIds, useCollections, useCreateCollection, useExplore, usePeople } from "../../api/hooks";
import { useNotify } from "../../components/notify";
import { errorMessage } from "../../lib/format";
import { useWs, wsPath } from "../../app/session";
import { EmptyState, ErrorState, PageHeader, TagDot } from "../../components/ui";
import { formatDay, timeAgo } from "../../lib/dates";
import { toSearchParams, toggleFacetValue } from "../../lib/filterSpec";
import { GalleryViewer } from "../search/Results";
import { ImageSlideshow } from "./ImageSlideshow";

const tagSpec = (tagId: string): FilterSpec => toggleFacetValue({ sort: "oldest" }, "tag", tagId, "include");

function Tile({ img, onOpen }: { img: GalleryImage; onOpen: () => void }) {
  return (
    <ButtonBase
      onClick={onOpen}
      aria-label={`${img.caption ?? "Image"} from ${img.postTitle}`}
      sx={{ flexShrink: 0, width: 168, height: 126, borderRadius: 1, overflow: "hidden", bgcolor: img.dominantColor ?? "action.hover", border: 1, borderColor: "divider", scrollSnapAlign: "start", position: "relative", "&:hover img": { transform: "scale(1.03)" } }}
    >
      <Box component="img" src={img.thumbUrl} alt="" loading="lazy" sx={{ width: "100%", height: "100%", objectFit: "cover", transition: "transform 150ms" }} />
      {img.figureLabel && (
        <Box sx={{ position: "absolute", left: 6, bottom: 6, px: 0.5, borderRadius: 0.5, bgcolor: "rgba(0,0,0,0.6)", color: "#fff", fontSize: 11 }}>{img.figureLabel}</Box>
      )}
    </ButtonBase>
  );
}

function Shelf({ shelf, onSlideshow, onImage }: { shelf: ExploreShelf; onSlideshow: () => void; onImage: (img: GalleryImage) => void }) {
  const { org, ws } = useWs();
  const { data: people = [] } = usePeople(org.id);
  const navigate = useNavigate();
  const notify = useNotify();
  const create = useCreateCollection(org.id, ws.id);
  const [making, setMaking] = useState(false);
  const { data: collections = [] } = useCollections(org.id, ws.id);
  const notebookName = `${shelf.tag.name} notebook`;
  const existing = collections.find((c) => c.kind === "notebook" && c.name.toLowerCase() === notebookName.toLowerCase());
  const makeNotebook = async () => {
    // One notebook per tag: open it if it already exists instead of making a twin.
    if (existing) return navigate(wsPath(org, ws, `/notebooks/${existing.id}`));
    setMaking(true);
    try {
      // Every post with this tag, oldest work date first: a running notebook of the topic.
      const ids = await collectPostIds(org.id, ws.id, { ...toggleFacetValue({}, "tag", shelf.tag.id, "include"), sort: "workDate" });
      const c = await create.mutateAsync({ name: notebookName, postIds: ids.reverse(), kind: "notebook" });
      navigate(wsPath(org, ws, `/notebooks/${c.id}`));
    } catch (e) {
      notify(errorMessage(e));
    } finally {
      setMaking(false);
    }
  };
  const searchUrl = (view?: "gallery") => `${wsPath(org, ws, "/search")}?${toSearchParams({ ...toggleFacetValue({}, "tag", shelf.tag.id, "include"), view })}`;
  const postsWithoutImages = shelf.posts.filter((p) => !p.thumbUrl).slice(0, 6);
  return (
    <Box component="section" aria-label={`Tag ${shelf.tag.name}`} sx={{ py: 2, borderBottom: 1, borderColor: "divider" }}>
      <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 1.25, flexWrap: "wrap", rowGap: 1 }}>
        {/* The tag is the shelf's heading: a color dot for identity, the name at heading weight. */}
        <Stack direction="row" spacing={1} alignItems="center" component={RouterLink} to={searchUrl()} sx={{ color: "text.primary", textDecoration: "none", "&:hover h2": { textDecoration: "underline", textUnderlineOffset: 3 } }}>
          <TagDot color={shelf.tag.color} size={10} />
          <Typography component="h2" sx={{ fontSize: "1.15rem", fontWeight: 600, letterSpacing: "-0.01em" }}>{shelf.tag.name}</Typography>
        </Stack>
        <Typography variant="body2" color="text.secondary">
          {shelf.groupName && `${shelf.groupName} · `}
          {shelf.count.toLocaleString()} post{shelf.count === 1 ? "" : "s"}
          {shelf.imageCount > 0 && ` · ${shelf.imageCount.toLocaleString()} image${shelf.imageCount === 1 ? "" : "s"}`} · active {timeAgo(shelf.lastActivity)}
        </Typography>
        <Box sx={{ flex: 1 }} />
        {shelf.imageCount > 0 && (
          <>
            <Button size="small" startIcon={<SlideshowRounded />} onClick={onSlideshow}>Slideshow</Button>
            <Button size="small" startIcon={<GridViewRounded />} component={RouterLink} to={searchUrl("gallery")}>Gallery</Button>
          </>
        )}
        <Button size="small" startIcon={<MenuBookOutlined />} onClick={makeNotebook} disabled={making}>{existing ? "Open notebook" : "Notebook"}</Button>
        <Button size="small" endIcon={<ArrowForwardRounded />} component={RouterLink} to={searchUrl()}>All posts</Button>
      </Stack>
      <Box sx={{ display: "flex", gap: 1, overflowX: "auto", scrollSnapType: "x mandatory", pb: 0.5 }} role="list">
        {shelf.images.map((img) => (
          <Box role="listitem" key={img.imageInstanceId}>
            <Tile img={img} onOpen={() => onImage(img)} />
          </Box>
        ))}
        {postsWithoutImages.map((p) => (
          <ButtonBase
            role="listitem"
            key={p.id}
            component={RouterLink}
            to={wsPath(org, ws, `/p/${p.id}`)}
            sx={{ flexShrink: 0, width: 200, height: 126, borderRadius: 1, border: 1, borderColor: "divider", bgcolor: "background.paper", p: 1.25, display: "flex", flexDirection: "column", alignItems: "flex-start", justifyContent: "space-between", textAlign: "left", scrollSnapAlign: "start", "&:hover": { bgcolor: "action.hover" } }}
          >
            <Typography variant="body2" sx={{ fontWeight: 600, display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{p.title}</Typography>
            <Typography variant="caption" color="text.secondary">{people.find((u) => u.id === p.authorId)?.name.split(" ")[0]} · {formatDay(p.workDate)}</Typography>
          </ButtonBase>
        ))}
      </Box>
    </Box>
  );
}

/** Explore (owner request): discover by tag when you don't know what to search for. */
export default function ExplorePage() {
  const { org, ws } = useWs();
  const q = useExplore(org.id, ws.id);
  const [params, setParams] = useSearchParams();
  const [group, setGroup] = useState<string>("All");
  const [viewer, setViewer] = useState<GalleryImage | null>(null);
  const slideTag = params.get("slideshow");
  const groups = useMemo(() => ["All", ...new Set((q.data?.shelves ?? []).map((s) => s.groupName ?? "Other"))], [q.data]);
  const shelves = (q.data?.shelves ?? []).filter((s) => group === "All" || s.groupName === group);
  const slideShelf = q.data?.shelves.find((s) => s.tag.id === slideTag);

  return (
    <Box sx={{ maxWidth: 1180, width: "100%", mx: "auto", px: { xs: 1.5, sm: 3 }, py: 3 }}>
      <PageHeader title="Explore" sub="Browse by tag, newest activity first. Open a slideshow to flip through every figure on a topic." />
      <Stack direction="row" spacing={0.75} sx={{ mb: 1, flexWrap: "wrap", rowGap: 0.75 }} role="tablist" aria-label="Tag group">
        {groups.map((g) => (
          <Chip key={g} role="tab" aria-selected={g === group} label={g} onClick={() => setGroup(g)} color={g === group ? "primary" : "default"} variant={g === group ? "filled" : "outlined"} />
        ))}
      </Stack>
      {q.isPending ? (
        <Stack spacing={3} sx={{ mt: 2 }}>
          {[0, 1, 2].map((i) => (
            <Box key={i}>
              <Skeleton width={240} />
              <Stack direction="row" spacing={1}>{[0, 1, 2, 3, 4].map((j) => <Skeleton key={j} variant="rounded" width={168} height={126} />)}</Stack>
            </Box>
          ))}
        </Stack>
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !shelves.length ? (
        <EmptyState icon={<ImageOutlined />} title="Nothing to explore yet" body="Tag your posts and they'll show up here, grouped by topic." />
      ) : (
        shelves.map((s) => (
          <Shelf key={s.tag.id} shelf={s} onImage={setViewer} onSlideshow={() => setParams({ slideshow: s.tag.id })} />
        ))
      )}
      {slideTag && slideShelf && <ImageSlideshow title={`#${slideShelf.tag.name}`} spec={tagSpec(slideTag)} onClose={() => setParams({})} />}
      <GalleryViewer img={viewer} onClose={() => setViewer(null)} />
    </Box>
  );
}
