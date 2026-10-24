import {
  ArrowBackRounded,
  BrushOutlined,
  CloseRounded,
  EditOutlined,
  FileUploadOutlined,
  HistoryRounded,
  InfoOutlined,
  LinkRounded,
  MoreHorizRounded,
  SlideshowRounded,
  VisibilityOffOutlined,
  VisibilityOutlined,
} from "@mui/icons-material";
import {
  Alert,
  AvatarGroup,
  Box,
  Button,
  Dialog,
  Divider,
  Drawer,
  IconButton,
  List,
  ListItemButton,
  ListItemText,
  Menu,
  MenuItem,
  Popover,
  Skeleton,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import { useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Link as RouterLink, useLocation, useNavigate, useParams } from "react-router-dom";
import { ApiError } from "../../api/client";
import type { Block, ImageView, Post, PostRevision, Shape } from "../../api/contract";
import { patchImageInCaches, useComments, usePeople, usePost, usePostAction, useRevisions, useSaveAnnotation, useTags } from "../../api/hooks";
import { can, useWs, wsPath } from "../../app/session";
import { AnnotationLayer } from "../../components/AnnotationLayer";
import { useNotify } from "../../components/notify";
import { RichText } from "../../components/RichText";
import { SlideCanvas } from "../../components/SlideCanvas";
import { designDocs } from "../../lib/blocks";
import { EmptyState, ErrorState, StatusPill, TagChip, UserAvatar } from "../../components/ui";
import { formatDay, timeAgo } from "../../lib/dates";
import { lineDiff } from "../../lib/diff";
import type { Origin } from "../../app/origin";
import { useFit } from "../../lib/useFit";
import { toSearchParams, toggleFacetValue } from "../../lib/filterSpec";
import { errorMessage } from "../../lib/format";
import { docText } from "../../lib/prosemirror";
import { Annotator } from "./Annotator";
import { ImageMetadataDrawer } from "./ImageMetadataDrawer";
import { ReactionBar } from "../discussion/ReactionBar";
import { ThreadView } from "../discussion/ThreadView";
import { PinnableImage } from "../discussion/Pins";
import { flashElement } from "../discussion/threads";

export default function PostDetailPage() {
  const { postId = "" } = useParams();
  const { org, ws } = useWs();
  const q = usePost(org.id, postId);
  if (q.isPending)
    return (
      <Box sx={{ maxWidth: 860, mx: "auto", p: 3, width: "100%" }}>
        <Skeleton variant="text" height={44} width="70%" />
        <Skeleton variant="text" width="40%" />
        <Skeleton variant="rounded" height={260} sx={{ mt: 2 }} />
      </Box>
    );
  if (q.error)
    return q.error instanceof ApiError && q.error.status === 404 ? (
      <EmptyState title="This post isn't available" body="It may have been deleted, hidden, or you may not have access." action={<Button component={RouterLink} to={wsPath(org, ws)}>Back to Home</Button>} />
    ) : (
      <ErrorState error={q.error} onRetry={() => q.refetch()} />
    );
  return <PostView post={q.data.post} images={q.data.images} />;
}

/** Plain text of a block list (for the revision diff). */
const blocksText = (blocks: Block[]) =>
  blocks.map((b) => (b.type === "text" || b.type === "table" ? docText(b.doc) : b.type === "image" ? "[image]" : b.type === "slide" ? ["— designed slide —", ...designDocs(b.design).map(docText)].join("\n") : "— slide —")).join("\n");

function RevisionDrawer({ post, open, onClose }: { post: Post; open: boolean; onClose: () => void }) {
  const { org } = useWs();
  const { data: revs = [] } = useRevisions(org.id, post.id, open);
  const { data: people = [] } = usePeople(org.id);
  const [sel, setSel] = useState(0);
  const cur: PostRevision | undefined = revs[sel];
  const prev: PostRevision | undefined = revs[sel + 1];
  const diff = cur ? lineDiff(prev ? `${prev.title}\n${blocksText(prev.blocks)}` : "", `${cur.title}\n${blocksText(cur.blocks)}`) : [];
  return (
    <Drawer anchor="right" open={open} onClose={onClose} slotProps={{ paper: { sx: { width: { xs: "100%", sm: 560 } } } }}>
      <Stack direction="row" alignItems="center" sx={{ px: 2, py: 1.5, borderBottom: 1, borderColor: "divider" }}>
        <Typography variant="h3" sx={{ flex: 1 }}>Revision history</Typography>
        <IconButton onClick={onClose} aria-label="Close revision history"><CloseRounded /></IconButton>
      </Stack>
      <Stack direction={{ xs: "column", sm: "row" }} sx={{ flex: 1, minHeight: 0 }}>
        <List dense sx={{ width: { sm: 190 }, borderRight: { sm: 1 }, borderColor: "divider", overflow: "auto", flexShrink: 0 }}>
          {revs.map((r, i) => (
            <ListItemButton key={r.revision} selected={i === sel} onClick={() => setSel(i)}>
              <ListItemText primary={`Revision ${r.revision}${i === 0 ? " · current" : ""}`} secondary={`${people.find((p) => p.id === r.editedBy)?.name ?? "Someone"} · ${timeAgo(r.editedAt)}`} />
            </ListItemButton>
          ))}
        </List>
        <Box sx={{ flex: 1, overflow: "auto", p: 2, fontFamily: "'IBM Plex Mono', monospace", fontSize: "0.78rem" }}>
          {!prev && cur && <Typography variant="caption" color="text.secondary" sx={{ fontFamily: "inherit" }}>First published version</Typography>}
          {diff.map((d, i) => (
            <Box key={i} sx={{ whiteSpace: "pre-wrap", px: 1, bgcolor: d.kind === "add" ? "rgba(26,127,55,0.12)" : d.kind === "del" ? "rgba(207,34,46,0.12)" : "transparent", textDecoration: d.kind === "del" ? "line-through" : "none", color: d.kind === "same" ? "text.secondary" : "text.primary" }}>
              {d.kind === "add" ? "+ " : d.kind === "del" ? "− " : "  "}
              {d.text || " "}
            </Box>
          ))}
        </Box>
      </Stack>
    </Drawer>
  );
}

/** Full-screen image view with annotations, metadata, and (for editors) the annotator. */
function ImageViewer({ image, onClose, canEdit }: { image: ImageView; onClose: () => void; canEdit: boolean }) {
  const { org } = useWs();
  const qc = useQueryClient();
  const notify = useNotify();
  const save = useSaveAnnotation(org.id);
  const [annotating, setAnnotating] = useState(false);
  const [details, setDetails] = useState(false);
  const a = image.asset;
  const fit = useFit<HTMLDivElement>(a.width / a.height);
  return (
    <Dialog open fullScreen onClose={onClose} slotProps={{ paper: { "aria-label": "Image viewer", sx: { bgcolor: "#0d0f12", color: "#e6e8eb" } } as object }}>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ px: 2, py: 1 }}>
        <Typography variant="body2" sx={{ flex: 1 }} noWrap>
          {image.figureLabel && <b>{image.figureLabel} </b>}
          {image.caption}
        </Typography>
        <Button size="small" startIcon={<InfoOutlined />} onClick={() => setDetails(true)} sx={{ color: "#c2c7cf" }}>Details</Button>
        {canEdit && <Button size="small" startIcon={<BrushOutlined />} onClick={() => setAnnotating(true)} sx={{ color: "#c2c7cf" }}>Annotate</Button>}
        <IconButton onClick={onClose} sx={{ color: "#c2c7cf" }} aria-label="Close image"><CloseRounded /></IconButton>
      </Stack>
      <Box ref={fit.ref} sx={{ flex: 1, display: "grid", placeItems: "center", m: 2, minHeight: 0 }} onClick={onClose}>
        <Box onClick={(e) => e.stopPropagation()} sx={{ position: "relative", width: fit.width, height: fit.height }}>
          <Box component="img" src={(a.variants.find((v) => v.name === "original") ?? a.variants[0])?.url} alt={image.altText ?? ""} sx={{ width: "100%", height: "100%", display: "block", bgcolor: a.dominantColors[0] }} />
          <AnnotationLayer shapes={image.annotation?.shapes ?? []} width={a.width} height={a.height} />
        </Box>
      </Box>
      {annotating && (
        <Annotator
          image={image}
          open
          saving={save.isPending}
          onClose={() => setAnnotating(false)}
          onSave={(shapes: Shape[]) =>
            save.mutate(
              { id: image.id, shapes, version: image.annotation?.version ?? 0 },
              { onSuccess: (img) => (patchImageInCaches(qc, org.id, img), setAnnotating(false)), onError: (e) => notify(errorMessage(e)) },
            )
          }
        />
      )}
      <ImageMetadataDrawer orgId={org.id} image={image} open={details} onClose={() => setDetails(false)} readOnly={!canEdit} />
    </Dialog>
  );
}

function PostView({ post, images }: { post: Post; images: ImageView[] }) {
  const { org, ws, me, role } = useWs();
  const navigate = useNavigate();
  const notify = useNotify();
  const action = usePostAction(org.id);
  const { data: people = [] } = usePeople(org.id);
  const { data: tagData } = useTags(org.id);
  const tags = useMemo(() => new Map(tagData?.tags.map((t) => [t.id, t])), [tagData]);
  const imgs = useMemo(() => new Map(images.map((i) => [i.id, i])), [images]);
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const [hideAnchor, setHideAnchor] = useState<HTMLElement | null>(null);
  const [reason, setReason] = useState("");
  const [history, setHistory] = useState(false);
  const [viewing, setViewing] = useState<string | null>(null);
  const [focusComment, setFocusComment] = useState<string | null>(null);
  const { data: comments = [] } = useComments(org.id, post.id, post.status === "published");

  const isAuthor = post.authorId === me.user.id || post.coAuthorIds.includes(me.user.id);
  const isAdmin = can(role, "admin");
  const canEdit = can(role, "member") && (isAuthor || (isAdmin && post.status === "published")) && !post.deletedAt;
  const author = people.find((p) => p.id === post.authorId);
  const coAuthors = post.coAuthorIds.map((id) => people.find((p) => p.id === id)).filter((u) => !!u);
  const hasActivity = post.counts.comments > 0 || Object.values(post.reactions).some((r) => r.length);
  const base = wsPath(org, ws);
  // Back returns to where you came from: a labeled origin (e.g. a notebook) if one was passed,
  // else browser history within the app, else the feed (direct visits / shared links).
  const location = useLocation();
  const origin = location.state as Partial<Origin> | null;
  const canGoBack = (window.history.state as { idx?: number } | null)?.idx ? true : false;
  const backLabel = origin?.label ? `Back to ${origin.label}` : canGoBack ? "Back" : "Home";
  // Prefer real history: it returns to the exact page with its scroll position restored.
  const goBack = () => (canGoBack ? navigate(-1) : origin?.from ? navigate(origin.from) : navigate(base));
  const showFeedLink = (canGoBack || !!origin?.from) && origin?.label !== "all posts";

  const run = (a: Parameters<typeof action.mutate>[0], done?: string, undo?: () => void) =>
    action.mutate(a, { onSuccess: () => done && notify(done, undo), onError: (e) => notify(errorMessage(e)) });

  return (
    <Box sx={{ maxWidth: 860, width: "100%", mx: "auto", px: { xs: 1.5, sm: 3 }, py: 2 }}>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1.5 }}>
        <Button startIcon={<ArrowBackRounded />} size="small" sx={{ ml: -1 }} onClick={goBack}>{backLabel}</Button>
        {showFeedLink && (
          <Button component={RouterLink} to={`${base}/search`} size="small" color="inherit" sx={{ color: "text.secondary", fontWeight: 500 }}>
            All posts
          </Button>
        )}
        <Box sx={{ flex: 1 }} />
        {canEdit && <Button startIcon={<EditOutlined />} onClick={() => navigate(`${base}/p/${post.id}/edit`)}>Edit</Button>}
        {post.status === "published" && <Button startIcon={<SlideshowRounded />} onClick={() => navigate(`${base}/p/${post.id}/present`)}>Present</Button>}
        <IconButton onClick={(e) => setMenu(e.currentTarget)} aria-label="More actions"><MoreHorizRounded /></IconButton>
        <Menu anchorEl={menu} open={!!menu} onClose={() => setMenu(null)}>
          <MenuItem onClick={() => (setMenu(null), navigator.clipboard?.writeText(window.location.href).then(() => notify("Link copied")))}><LinkRounded fontSize="small" sx={{ mr: 1 }} /> Copy link</MenuItem>
          {post.revision > 1 && <MenuItem onClick={() => (setMenu(null), setHistory(true))}><HistoryRounded fontSize="small" sx={{ mr: 1 }} /> Revision history</MenuItem>}
          {canEdit && post.status === "published" && post.visibility === "visible" && (
            <MenuItem onClick={(e) => (setHideAnchor(menu ?? e.currentTarget), setMenu(null))}><VisibilityOffOutlined fontSize="small" sx={{ mr: 1 }} /> Hide…</MenuItem>
          )}
          {canEdit && post.visibility === "hidden" && (
            <MenuItem onClick={() => (setMenu(null), run({ id: post.id, action: "show" }, "Post is visible again"))}><VisibilityOutlined fontSize="small" sx={{ mr: 1 }} /> Show</MenuItem>
          )}
          {canEdit && post.status === "published" && (
            <Tooltip title={hasActivity ? "Posts with comments or reactions can't go back to draft. Hide it instead." : ""} placement="left">
              <span>
                <MenuItem disabled={hasActivity} onClick={() => (setMenu(null), run({ id: post.id, action: "unpublish" }, "Moved back to drafts"))}>Unpublish to draft</MenuItem>
              </span>
            </Tooltip>
          )}
          {canEdit && (
            <MenuItem
              sx={{ color: "error.main" }}
              onClick={() => {
                setMenu(null);
                action.mutate(
                  { id: post.id, action: "delete" },
                  { onSuccess: () => (navigate(base), notify("Post deleted", () => action.mutate({ id: post.id, action: "restore" }))), onError: (e) => notify(errorMessage(e)) },
                );
              }}
            >
              Delete
            </MenuItem>
          )}
        </Menu>
        <Popover open={!!hideAnchor} anchorEl={hideAnchor} onClose={() => setHideAnchor(null)} anchorOrigin={{ vertical: "bottom", horizontal: "right" }} transformOrigin={{ vertical: "top", horizontal: "right" }}>
          <Stack spacing={1.5} sx={{ p: 2, width: 320 }} component="form" onSubmit={(e) => {
            e.preventDefault();
            setHideAnchor(null);
            run({ id: post.id, action: "hide", reason }, "Post hidden", () => run({ id: post.id, action: "show" }));
            setReason("");
          }}>
            <Typography variant="subtitle2">Hide this post?</Typography>
            <Typography variant="body2" color="text.secondary">It disappears from the feed and search. You and admins can still see it and show it again. Its comments become read-only.</Typography>
            <TextField size="small" label="Reason (optional)" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus placeholder="Superseded by…" />
            <Stack direction="row" justifyContent="flex-end" spacing={1}>
              <Button onClick={() => setHideAnchor(null)}>Cancel</Button>
              <Button type="submit" variant="contained">Hide</Button>
            </Stack>
          </Stack>
        </Popover>
      </Stack>

      {post.deletedAt && (
        <Alert severity="error" sx={{ mb: 2 }} action={isAdmin && <Button size="small" onClick={() => run({ id: post.id, action: "restore" }, "Post restored")}>Restore</Button>}>
          Deleted {timeAgo(post.deletedAt)}. Only admins can see it.
        </Alert>
      )}
      {post.visibility === "hidden" && (
        <Alert severity="info" icon={<VisibilityOffOutlined />} sx={{ mb: 2 }} action={canEdit && <Button size="small" onClick={() => run({ id: post.id, action: "show" }, "Post is visible again")}>Show</Button>}>
          Hidden{post.hiddenBy && ` by ${people.find((p) => p.id === post.hiddenBy)?.name ?? "someone"}`}
          {post.hiddenAt && ` ${timeAgo(post.hiddenAt)}`}
          {post.hiddenReason && `: “${post.hiddenReason}”`}. Only the author and admins can see it.
        </Alert>
      )}
      {post.status === "draft" && (
        <Alert severity="warning" sx={{ mb: 2 }} action={<Button size="small" onClick={() => navigate(`${base}/p/${post.id}/edit`)}>Continue editing</Button>}>
          Draft: only you can see this.
        </Alert>
      )}

      <Box component="article" aria-labelledby="post-title">
        <Typography id="post-title" variant="h1" sx={{ fontSize: { xs: "1.4rem", sm: "1.75rem" }, mb: 1 }}>
          {post.title || "Untitled"}
        </Typography>
        <Stack direction="row" spacing={1.5} alignItems="center" sx={{ flexWrap: "wrap", rowGap: 1, mb: 1.5, color: "text.secondary" }}>
          <Stack direction="row" spacing={1} alignItems="center">
            <AvatarGroup max={4} sx={{ "& .MuiAvatar-root": { width: 26, height: 26, fontSize: 11 } }}>
              {[author, ...coAuthors].filter(Boolean).map((u) => <UserAvatar key={u!.id} user={u!} size={26} />)}
            </AvatarGroup>
            <Typography variant="body2" color="text.primary" sx={{ fontWeight: 500 }}>
              {[author?.name ?? "…", ...coAuthors.map((u) => u!.name)].join(", ")}
            </Typography>
          </Stack>
          <Typography variant="body2" title={post.workDateSource === "user" ? "Work date" : `Work date (${post.workDateSource === "guessed" ? "guessed from the slide" : "import fallback"})`}>
            {formatDay(post.workDate)}
            {post.workDateSource !== "user" && <Box component="span" sx={{ color: "warning.main" }}> (date guessed)</Box>}
          </Typography>
          {post.publishedAt && <Typography variant="caption">published {timeAgo(post.publishedAt)}</Typography>}
          {post.revision > 1 && (
            <Button size="small" variant="text" onClick={() => setHistory(true)} sx={{ minWidth: 0, p: 0, color: "text.secondary", fontWeight: 400 }}>
              <StatusPill status="edited" />
            </Button>
          )}
        </Stack>
        {(post.tagIds.length > 0 || post.source) && (
          <Stack direction="row" spacing={0.75} alignItems="center" sx={{ flexWrap: "wrap", rowGap: 0.75, mb: 2 }}>
            {post.tagIds.map((id) => tags.get(id)).filter((t) => !!t).map((t) => (
              <TagChip key={t!.id} tag={t!} onClick={() => navigate(`${base}/search?${toSearchParams(toggleFacetValue({}, "tag", t!.id, "include"))}`)} />
            ))}
            {post.source && (
              <Stack direction="row" spacing={0.5} alignItems="center" sx={{ color: "text.secondary", ml: 1 }}>
                <FileUploadOutlined sx={{ fontSize: 15 }} />
                <Typography variant="caption">From “{post.source.fileName}” · slide {post.source.slide} of {post.source.slideCount}</Typography>
              </Stack>
            )}
          </Stack>
        )}
        {post.summary && <Typography sx={{ color: "text.secondary", mb: 2, fontSize: "1.02rem" }}>{post.summary}</Typography>}
        <Stack spacing={2}>
          {post.blocks.map((b) => {
            if (b.type === "text" || b.type === "table") return <RichText key={b.id} doc={b.doc} />;
            if (b.type === "slide_break") return <Divider key={b.id} sx={{ borderStyle: "dashed" }} />;
            if (b.type === "slide") return <SlideCanvas key={b.id} design={b.design} images={imgs} />;
            const img = imgs.get(b.imageInstanceId);
            if (!img) return null;
            return (
              <Box component="figure" key={b.id} sx={{ m: 0 }}>
                <PinnableImage post={post} image={img} comments={comments} images={images} maxHeight={560} onImageClick={() => setViewing(img.id)} onOpenThread={(id) => setFocusComment(id + ":" + Date.now())} />
                {(img.caption || img.figureLabel) && (
                  <Typography component="figcaption" variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5 }}>
                    {img.figureLabel && <b>{img.figureLabel}. </b>}
                    {img.caption}
                  </Typography>
                )}
              </Box>
            );
          })}
        </Stack>
      </Box>

      {post.status === "published" && (
        <>
          <Box sx={{ mt: 3 }}>
            <ReactionBar post={post} />
          </Box>
          <Divider sx={{ my: 3 }} />
          <ThreadView post={post} images={images} focusComment={focusComment?.split(":")[0]} onPinClick={(id) => flashElement(`pin-${id}`)} />
        </>
      )}

      <RevisionDrawer post={post} open={history} onClose={() => setHistory(false)} />
      {viewing && imgs.get(viewing) && <ImageViewer image={imgs.get(viewing)!} canEdit={canEdit} onClose={() => setViewing(null)} />}
    </Box>
  );
}
