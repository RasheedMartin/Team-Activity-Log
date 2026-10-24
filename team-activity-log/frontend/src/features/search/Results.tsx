import { ChatBubbleOutlineRounded, CloseRounded, OpenInNewRounded } from "@mui/icons-material";
import { Box, Button, Dialog, IconButton, Skeleton, Stack, Typography } from "@mui/material";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link as RouterLink } from "react-router-dom";
import type { GalleryImage, ID, SearchHit, Tag, User } from "../../api/contract";
import { useImage, usePost } from "../../api/hooks";
import { useWs, wsPath } from "../../app/session";
import { AnnotationLayer } from "../../components/AnnotationLayer";
import { RichText } from "../../components/RichText";
import { TagChip, UserAvatar } from "../../components/ui";
import { formatDay } from "../../lib/dates";
import { useFit } from "../../lib/useFit";
import { AnnotatedImage } from "../posts/editor/ImageBlock";
import { PostCard } from "../posts/PostCard";

/** Offset of an element from the top of the document (for window virtualization). */
function useScrollMargin(ref: React.RefObject<HTMLElement | null>) {
  const [m, setM] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setM(el.getBoundingClientRect().top + window.scrollY);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(document.body);
    return () => ro.disconnect();
  }, [ref]);
  return m;
}

interface ListProps {
  hits: SearchHit[];
  people: Map<ID, User>;
  tags: Map<ID, Tag>;
  focused: number;
  setFocused: (i: number) => void;
  comfortable: boolean;
  onEndReached: () => void;
  onTagClick: (id: ID) => void;
}

export function ResultsList({ hits, people, tags, focused, setFocused, comfortable, onEndReached, onTagClick }: ListProps) {
  const { org, ws } = useWs();
  const ref = useRef<HTMLDivElement>(null);
  const scrollMargin = useScrollMargin(ref);
  const v = useWindowVirtualizer({ count: hits.length, estimateSize: () => (comfortable ? 140 : 96), overscan: 8, scrollMargin });
  const items = v.getVirtualItems();
  const last = items[items.length - 1]?.index ?? 0;
  useEffect(() => {
    if (hits.length && last >= hits.length - 6) onEndReached();
  }, [last, hits.length, onEndReached]);
  useEffect(() => {
    if (focused >= 0) v.scrollToIndex(focused, { align: "auto" });
  }, [focused, v]);
  return (
    <Box ref={ref} role="feed" aria-label="Search results" aria-busy={false} sx={{ position: "relative", height: v.getTotalSize(), border: 1, borderColor: "divider", borderRadius: 1, overflow: "hidden", bgcolor: "background.paper" }}>
      {items.map((it) => {
        const h = hits[it.index];
        return (
          <Box
            key={h.post.id}
            data-index={it.index}
            ref={v.measureElement}
            role="article"
            aria-posinset={it.index + 1}
            aria-setsize={-1}
            onFocusCapture={() => setFocused(it.index)}
            sx={{ position: "absolute", top: 0, left: 0, width: "100%", transform: `translateY(${it.start - scrollMargin}px)` }}
          >
            <PostCard hit={h} href={wsPath(org, ws, `/p/${h.post.id}`)} author={people.get(h.post.authorId)} tags={tags} focused={it.index === focused} comfortable={comfortable} onTagClick={onTagClick} />
          </Box>
        );
      })}
    </Box>
  );
}

export function GalleryGrid({ images, onEndReached, onOpen }: { images: GalleryImage[]; onEndReached: () => void; onOpen: (img: GalleryImage) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const scrollMargin = useScrollMargin(ref);
  const [width, setWidth] = useState(800);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const cols = Math.max(2, Math.floor(width / 210));
  const tile = (width - (cols - 1) * 8) / cols;
  const rows = Math.ceil(images.length / cols);
  const v = useWindowVirtualizer({ count: rows, estimateSize: () => tile * 0.75 + 52, overscan: 4, scrollMargin });
  const items = v.getVirtualItems();
  const last = items[items.length - 1]?.index ?? 0;
  useEffect(() => {
    if (rows && last >= rows - 3) onEndReached();
  }, [last, rows, onEndReached]);
  return (
    <Box ref={ref} sx={{ position: "relative", height: v.getTotalSize() }} role="list" aria-label="Images">
      {items.map((row) => (
        <Stack key={row.index} direction="row" spacing={1} sx={{ position: "absolute", top: 0, left: 0, width: "100%", transform: `translateY(${row.start - scrollMargin}px)` }}>
          {images.slice(row.index * cols, row.index * cols + cols).map((img) => (
            <Box
              key={img.imageInstanceId}
              role="listitem"
              component="button"
              onClick={() => onOpen(img)}
              aria-label={`${img.figureLabel ? `${img.figureLabel} ` : ""}${img.caption ?? "Image"} from ${img.postTitle}`}
              sx={{ width: tile, flexShrink: 0, p: 0, border: 1, borderColor: "divider", borderRadius: 1, overflow: "hidden", bgcolor: "background.paper", cursor: "zoom-in", textAlign: "left", font: "inherit", color: "inherit", "&:hover img": { transform: "scale(1.02)" } }}
            >
              <Box sx={{ aspectRatio: "4 / 3", bgcolor: img.dominantColor ?? "action.hover", overflow: "hidden" }}>
                <Box component="img" src={img.thumbUrl} alt="" loading="lazy" sx={{ width: "100%", height: "100%", objectFit: "cover", display: "block", transition: "transform 150ms" }} />
              </Box>
              <Box sx={{ px: 1, py: 0.75 }}>
                <Typography variant="caption" sx={{ fontWeight: 600 }} noWrap component="div">
                  {img.figureLabel && `${img.figureLabel} · `}
                  {img.caption ?? "Untitled image"}
                </Typography>
                <Typography variant="caption" color="text.secondary" noWrap component="div">{img.postTitle}</Typography>
              </Box>
            </Box>
          ))}
        </Stack>
      ))}
    </Box>
  );
}

export function GalleryViewer({ img, onClose }: { img: GalleryImage | null; onClose: () => void }) {
  const { org, ws } = useWs();
  const { data } = useImage(org.id, img?.imageInstanceId);
  const fit = useFit<HTMLDivElement>(img ? img.width / img.height : 1);
  if (!img) return null;
  return (
    <Dialog open fullScreen onClose={onClose} slotProps={{ paper: { "aria-label": "Image viewer", sx: { bgcolor: "#0d0f12", color: "#e6e8eb" } } as object }}>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ px: 2, py: 1 }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="body2" noWrap>{img.figureLabel && <b>{img.figureLabel} </b>}{img.caption}</Typography>
          <Typography variant="caption" sx={{ color: "#9aa3ad" }} noWrap component="div">From “{img.postTitle}”</Typography>
        </Box>
        <Button component={RouterLink} to={wsPath(org, ws, `/p/${img.postId}`)} startIcon={<OpenInNewRounded />} sx={{ color: "#c2c7cf" }}>Open post</Button>
        <IconButton onClick={onClose} sx={{ color: "#c2c7cf" }} aria-label="Close image"><CloseRounded /></IconButton>
      </Stack>
      <Box ref={fit.ref} sx={{ flex: 1, display: "grid", placeItems: "center", m: 2, minHeight: 0 }} onClick={onClose}>
        <Box onClick={(e) => e.stopPropagation()} sx={{ position: "relative", width: fit.width, height: fit.height, bgcolor: img.dominantColor }}>
          <Box component="img" src={(data?.asset.variants.find((v) => v.name === "original") ?? null)?.url ?? img.thumbUrl} alt={data?.altText ?? ""} sx={{ width: "100%", height: "100%", display: "block" }} />
          {data && <AnnotationLayer shapes={data.annotation?.shapes ?? []} width={data.asset.width} height={data.asset.height} />}
        </Box>
      </Box>
    </Dialog>
  );
}

/** Space opens a quick preview without leaving the list (§A4). */
export function PeekPane({ postId, people, tags, onClose }: { postId: ID; people: Map<ID, User>; tags: Map<ID, Tag>; onClose: () => void }) {
  const { org, ws } = useWs();
  const { data, isPending } = usePost(org.id, postId);
  const post = data?.post;
  const firstText = useMemo(() => post?.blocks.find((b) => b.type === "text"), [post]);
  const images = data?.images ?? [];
  return (
    <Box component="aside" aria-label="Preview" sx={{ position: "sticky", top: 16, maxHeight: "calc(100dvh - 32px)", overflow: "auto", border: 1, borderColor: "divider", borderRadius: 1, bgcolor: "background.paper" }}>
      <Stack direction="row" alignItems="center" sx={{ px: 2, py: 1, borderBottom: 1, borderColor: "divider", position: "sticky", top: 0, bgcolor: "background.paper", zIndex: 1 }}>
        <Typography variant="overline" color="text.secondary" sx={{ flex: 1 }}>Preview · Space</Typography>
        <Button size="small" component={RouterLink} to={wsPath(org, ws, `/p/${postId}`)}>Open</Button>
        <IconButton size="small" onClick={onClose} aria-label="Close preview"><CloseRounded fontSize="small" /></IconButton>
      </Stack>
      {isPending || !post ? (
        <Box sx={{ p: 2 }}>
          <Skeleton variant="text" height={32} />
          <Skeleton variant="rounded" height={160} />
        </Box>
      ) : (
        <Box sx={{ p: 2 }}>
          <Typography variant="h3" sx={{ mb: 0.75 }}>{post.title}</Typography>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1, color: "text.secondary" }}>
            <UserAvatar user={people.get(post.authorId)} size={20} />
            <Typography variant="caption">{people.get(post.authorId)?.name} · {formatDay(post.workDate)}</Typography>
            {post.counts.comments > 0 && (
              <Stack direction="row" spacing={0.25} alignItems="center">
                <ChatBubbleOutlineRounded sx={{ fontSize: 14 }} />
                <Typography variant="caption">{post.counts.comments}</Typography>
              </Stack>
            )}
          </Stack>
          <Stack direction="row" spacing={0.5} sx={{ flexWrap: "wrap", rowGap: 0.5, mb: 1.5 }}>
            {post.tagIds.map((id) => tags.get(id)).filter((t) => !!t).map((t) => <TagChip key={t!.id} tag={t!} />)}
          </Stack>
          {post.summary && <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>{post.summary}</Typography>}
          {firstText && firstText.type === "text" && <RichText doc={firstText.doc} sx={{ fontSize: "0.85rem", maxHeight: 220, overflow: "hidden", maskImage: "linear-gradient(#000 70%, transparent)" }} />}
          <Stack spacing={1} sx={{ mt: 1.5 }}>
            {images.slice(0, 4).map((img) => <AnnotatedImage key={img.id} image={img} maxHeight={200} variant="small" />)}
          </Stack>
        </Box>
      )}
    </Box>
  );
}
