import { ArrowForwardRounded, ChatBubbleOutlineRounded, GridViewRounded, ImageOutlined, MenuBookOutlined, SearchRounded, SlideshowRounded } from "@mui/icons-material";
import { Box, Button, ButtonBase, Chip, InputBase, Paper, Skeleton, Stack, Typography } from "@mui/material";
import { useMemo, useState } from "react";
import { Link as RouterLink, useNavigate, useSearchParams } from "react-router-dom";
import type { ExploreShelf, FilterSpec, User } from "../../api/contract";
import type { Origin } from "../../app/origin";
import { ApiError } from "../../api/client";
import { collectPostIds, useCreateCollection, useExplore, usePeople } from "../../api/hooks";
import { useNotify } from "../../components/notify";
import { errorMessage } from "../../lib/format";
import { useWs, wsPath } from "../../app/session";
import { EmptyState, ErrorState, Kbd, TagDot, UserAvatar } from "../../components/ui";
import { formatDay, timeAgo } from "../../lib/dates";
import { toSearchParams, toggleFacetValue } from "../../lib/filterSpec";
import { useOrigin } from "../../app/origin";
import { OnboardingChecklist } from "../search/Onboarding";
import { ImageSlideshow } from "./ImageSlideshow";

const tagSpec = (tagId: string): FilterSpec => toggleFacetValue({ sort: "oldest" }, "tag", tagId, "include");

const CARD_W = 248;
const CARD_H = 252;
const COVER_H = 132;

/**
 * Uniform post card for shelves. With an image: cover + title + a line of text. Without: the same
 * footprint filled with more text, so image-light and image-rich shelves look equally deliberate.
 */
function PostTile({ post, author, origin }: { post: ExploreShelf["posts"][number]; author?: User; origin: Origin }) {
  const { org, ws } = useWs();
  const hasCover = !!post.thumbUrl;
  return (
    <ButtonBase
      component={RouterLink}
      to={wsPath(org, ws, `/p/${post.id}`)}
      state={origin}
      role="listitem"
      sx={{
        flexShrink: 0,
        width: CARD_W,
        height: CARD_H,
        borderRadius: 1.5,
        border: 1,
        borderColor: "divider",
        bgcolor: "background.paper",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        alignItems: "stretch",
        textAlign: "left",
        scrollSnapAlign: "start",
        "&:hover": { borderColor: "text.disabled", "& img": { transform: "scale(1.03)" } },
        "&:focus-visible": { outline: 2, outlineColor: "primary.main", outlineOffset: 2 },
      }}
    >
      {hasCover && (
        <Box sx={{ height: COVER_H, bgcolor: post.dominantColor ?? "action.hover", overflow: "hidden", position: "relative", flexShrink: 0 }}>
          <Box component="img" src={post.thumbUrl} alt="" loading="lazy" sx={{ width: "100%", height: "100%", objectFit: "cover", display: "block", transition: "transform 150ms" }} />
          {post.imageCount > 1 && (
            <Box sx={{ position: "absolute", right: 6, bottom: 6, px: 0.75, borderRadius: 0.5, bgcolor: "rgba(15,17,21,0.7)", color: "#fff", fontSize: 11, fontWeight: 600 }}>
              {post.imageCount} images
            </Box>
          )}
        </Box>
      )}
      <Stack sx={{ p: 1.5, flex: 1, minHeight: 0 }} spacing={0.5}>
        <Typography variant="caption" color="text.secondary">{formatDay(post.workDate)}</Typography>
        <Typography variant="body2" sx={{ fontWeight: 600, lineHeight: 1.35, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
          {post.title || "Untitled"}
        </Typography>
        {post.excerpt && (
          <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.45, display: "-webkit-box", WebkitLineClamp: hasCover ? 1 : 6, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
            {post.excerpt}
          </Typography>
        )}
        <Box sx={{ flex: 1 }} />
        <Stack direction="row" spacing={0.75} alignItems="center" sx={{ color: "text.secondary" }}>
          <UserAvatar user={author} size={16} />
          <Typography variant="caption" noWrap sx={{ flex: 1 }}>{author?.name ?? ""}</Typography>
          {!hasCover && post.imageCount > 0 && <Typography variant="caption">{post.imageCount} img</Typography>}
          {post.commentCount > 0 && (
            <Stack direction="row" spacing={0.25} alignItems="center">
              <ChatBubbleOutlineRounded sx={{ fontSize: 13 }} />
              <Typography variant="caption">{post.commentCount}</Typography>
            </Stack>
          )}
        </Stack>
      </Stack>
    </ButtonBase>
  );
}

function Shelf({ shelf, onSlideshow }: { shelf: ExploreShelf; onSlideshow: () => void }) {
  const { org, ws } = useWs();
  const { data: people = [] } = usePeople(org.id);
  const navigate = useNavigate();
  const origin = useOrigin("Home");
  const notify = useNotify();
  const create = useCreateCollection(org.id, ws.id);
  const [making, setMaking] = useState(false);
  const notebookName = `${shelf.tag.name} notebook`;
  const makeNotebook = async () => {
    // One notebook per tag (the server knows it by tag, even after a rename): open it if it exists.
    if (shelf.notebookId) return navigate(wsPath(org, ws, `/notebooks/${shelf.notebookId}`));
    setMaking(true);
    try {
      // Every post with this tag, oldest work date first: a running notebook of the topic.
      const ids = await collectPostIds(org.id, ws.id, { ...toggleFacetValue({}, "tag", shelf.tag.id, "include"), sort: "workDate" });
      const c = await create.mutateAsync({ name: notebookName, postIds: ids.reverse(), kind: "notebook", sourceTagId: shelf.tag.id });
      navigate(wsPath(org, ws, `/notebooks/${c.id}`));
    } catch (e) {
      const existingId = e instanceof ApiError ? (e.details as { existingId?: string } | undefined)?.existingId : undefined;
      if (existingId) navigate(wsPath(org, ws, `/notebooks/${existingId}`));
      else notify(errorMessage(e));
    } finally {
      setMaking(false);
    }
  };
  const searchUrl = (view?: "gallery") => `${wsPath(org, ws, "/search")}?${toSearchParams({ ...toggleFacetValue({}, "tag", shelf.tag.id, "include"), view })}`;
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
        <Button size="small" startIcon={<MenuBookOutlined />} onClick={makeNotebook} disabled={making}>{shelf.notebookId ? "Open notebook" : "Notebook"}</Button>
        <Button size="small" endIcon={<ArrowForwardRounded />} component={RouterLink} to={searchUrl()}>All posts</Button>
      </Stack>
      <Box sx={{ display: "flex", gap: 1.5, overflowX: "auto", scrollSnapType: "x mandatory", pb: 1 }} role="list" aria-label={`Posts tagged ${shelf.tag.name}`}>
        {shelf.posts.map((p) => (
          <PostTile key={p.id} post={p} author={people.find((u) => u.id === p.authorId)} origin={origin} />
        ))}
        {shelf.count > shelf.posts.length && (
          <ButtonBase component={RouterLink} to={searchUrl()} sx={{ flexShrink: 0, width: 140, height: CARD_H, borderRadius: 1.5, border: 1, borderStyle: "dashed", borderColor: "divider", color: "primary.main", fontWeight: 600, fontSize: "0.85rem", scrollSnapAlign: "start" }}>
            See all {shelf.count}
          </ButtonBase>
        )}
      </Box>
    </Box>
  );
}

/** Explore (owner request): discover by tag when you don't know what to search for. */
/** Home's first row: the newest posts, with a clear way into Search for everything. */
function LatestShelf({ posts, origin }: { posts: ExploreShelf["posts"]; origin: Origin }) {
  const { org, ws } = useWs();
  const { data: people = [] } = usePeople(org.id);
  return (
    <Box component="section" aria-label="Latest posts" sx={{ py: 2, borderBottom: 1, borderColor: "divider" }}>
      <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 1.25 }}>
        <Typography component="h2" sx={{ fontSize: "1.15rem", fontWeight: 600, letterSpacing: "-0.01em" }}>Latest posts</Typography>
        <Typography variant="body2" color="text.secondary">across every tag</Typography>
        <Box sx={{ flex: 1 }} />
        <Button size="small" endIcon={<ArrowForwardRounded />} component={RouterLink} to={wsPath(org, ws, "/search")}>See all in Search</Button>
      </Stack>
      <Box sx={{ display: "flex", gap: 1.5, overflowX: "auto", scrollSnapType: "x mandatory", pb: 1 }} role="list" aria-label="Latest posts">
        {posts.map((p) => <PostTile key={p.id} post={p} author={people.find((u) => u.id === p.authorId)} origin={origin} />)}
        <ButtonBase component={RouterLink} to={wsPath(org, ws, "/search")} sx={{ flexShrink: 0, width: 140, height: CARD_H, borderRadius: 1.5, border: 1, borderStyle: "dashed", borderColor: "divider", color: "primary.main", fontWeight: 600, fontSize: "0.85rem", scrollSnapAlign: "start" }}>
          All posts →
        </ButtonBase>
      </Box>
    </Box>
  );
}

/**
 * Home (owner request): discovery first. A search box and the latest posts lead into Search;
 * tag shelves below are for browsing when you don't know what to look for.
 */
export default function ExplorePage() {
  const { org, ws, me } = useWs();
  const navigate = useNavigate();
  const q = useExplore(org.id, ws.id);
  const [params, setParams] = useSearchParams();
  const [group, setGroup] = useState<string>("All");
  const [text, setText] = useState("");
  const origin = useOrigin("Home");
  const slideTag = params.get("slideshow");
  const groups = useMemo(() => ["All", ...new Set((q.data?.shelves ?? []).map((s) => s.groupName ?? "Other"))], [q.data]);
  const shelves = (q.data?.shelves ?? []).filter((s) => group === "All" || s.groupName === group);
  const slideShelf = q.data?.shelves.find((s) => s.tag.id === slideTag);
  const search = () => navigate(`${wsPath(org, ws, "/search")}${text.trim() ? `?${toSearchParams({ q: text.trim() })}` : ""}`);

  return (
    <Box sx={{ maxWidth: 1180, width: "100%", mx: "auto", px: { xs: 1.5, sm: 3 }, py: 3 }}>
      <Typography variant="h1" sx={{ mb: 0.5 }}>{ws.name}</Typography>
      <Typography color="text.secondary" sx={{ mb: 2 }}>Welcome back, {me.user.name.split(" ")[0]}. Search everything, or browse what's new.</Typography>
      <Paper
        component="form"
        variant="outlined"
        onSubmit={(e) => (e.preventDefault(), search())}
        sx={{ display: "flex", alignItems: "center", gap: 1, px: 1.5, py: 0.75, mb: 1, borderRadius: 2, maxWidth: 760, "&:focus-within": { borderColor: "primary.main", boxShadow: (t) => `0 0 0 1px ${t.palette.primary.main}` } }}
      >
        <SearchRounded sx={{ color: "text.secondary" }} />
        <InputBase fullWidth value={text} onChange={(e) => setText(e.target.value)} placeholder="Search all posts, comments, image text…" inputProps={{ "aria-label": "Search all posts" }} sx={{ fontSize: "1rem" }} />
        <Button type="submit" variant="contained" size="small">Search</Button>
      </Paper>
      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1 }}>
        Tip: <Kbd>/</Kbd> opens Search from anywhere. Try <code>drift OR noise</code> or <code>tag:calibration</code>.
      </Typography>

      {q.isPending ? (
        <Stack spacing={3} sx={{ mt: 2 }}>
          {[0, 1, 2].map((i) => (
            <Box key={i}>
              <Skeleton width={240} />
              <Stack direction="row" spacing={1}>{[0, 1, 2, 3, 4].map((j) => <Skeleton key={j} variant="rounded" width={CARD_W} height={CARD_H} />)}</Stack>
            </Box>
          ))}
        </Stack>
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <>
          {q.data.latest.length < 3 && <Box sx={{ mt: 2, maxWidth: 760 }}><OnboardingChecklist hasPosts={q.data.latest.length > 0} /></Box>}
          {q.data.latest.length > 0 ? (
            <LatestShelf posts={q.data.latest} origin={origin} />
          ) : (
            <EmptyState icon={<ImageOutlined />} title="Nothing here yet" body="Press C to write the first post, or import a PowerPoint deck." />
          )}
          {(q.data.shelves.length > 0) && (
            <>
              <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mt: 3, mb: 0.5, flexWrap: "wrap", rowGap: 1 }}>
                <Typography component="h2" variant="overline" color="text.secondary" sx={{ fontSize: "0.75rem" }}>Browse by tag</Typography>
                <Box sx={{ flex: 1 }} />
                <Stack direction="row" spacing={0.75} sx={{ flexWrap: "wrap", rowGap: 0.75 }} role="tablist" aria-label="Tag group">
                  {groups.map((g) => (
                    <Chip key={g} role="tab" aria-selected={g === group} label={g} onClick={() => setGroup(g)} color={g === group ? "primary" : "default"} variant={g === group ? "filled" : "outlined"} />
                  ))}
                </Stack>
              </Stack>
              {shelves.map((s) => <Shelf key={s.tag.id} shelf={s} onSlideshow={() => setParams({ slideshow: s.tag.id })} />)}
            </>
          )}
        </>
      )}
      {slideTag && slideShelf && <ImageSlideshow title={`#${slideShelf.tag.name}`} spec={tagSpec(slideTag)} onClose={() => setParams({})} />}
    </Box>
  );
}
