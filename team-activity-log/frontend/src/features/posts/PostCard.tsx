import { ChatBubbleOutlineRounded, CollectionsOutlined, FileUploadOutlined } from "@mui/icons-material";
import { Box, Checkbox, Stack, Typography, useTheme } from "@mui/material";
import { memo, type ReactNode } from "react";
import { Link as RouterLink } from "react-router-dom";
import type { SearchHit, Tag, User } from "../../api/contract";
import { blockDocs } from "../../lib/blocks";
import { formatDay } from "../../lib/dates";
import { docText } from "../../lib/prosemirror";
import { StatusPill, TagChip, UserAvatar } from "../../components/ui";

/** Render an engine snippet ("…<mark>x</mark>…") as text nodes — never as HTML. */
export function Highlighted({ snippet }: { snippet: string }) {
  const unescape = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
  const parts = snippet.split(/(<mark>.*?<\/mark>)/g);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith("<mark>") ? <mark key={i}>{unescape(p.slice(6, -7))}</mark> : <span key={i}>{unescape(p)}</span>,
      )}
    </>
  );
}

export function Thumb({ url, width, height, color, size, label, more = 0 }: { url: string; width: number; height: number; color?: string; size: number; label?: string; more?: number }) {
  // Reserve layout from stored dimensions; dominant-color placeholder until the image arrives (§A4 Images).
  const w = Math.round(Math.min(size * 1.6, Math.max(size * 0.7, (size * width) / height)));
  return (
    <Box sx={{ position: "relative", width: w, height: size, flexShrink: 0, borderRadius: 1, overflow: "hidden", bgcolor: color ?? "action.hover", border: 1, borderColor: "divider" }}>
      <Box component="img" src={url} alt={label ?? ""} loading="lazy" decoding="async" width={w} height={size} sx={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
      {more > 0 && (
        // More images than shown: a scrim with the real count, not a decorative icon.
        <Box aria-label={`${more} more images`} sx={{ position: "absolute", inset: 0, bgcolor: "rgba(15,17,21,0.62)", color: "#fff", display: "grid", placeItems: "center", fontWeight: 600, fontSize: size > 70 ? "1.05rem" : "0.85rem" }}>
          +{more}
        </Box>
      )}
    </Box>
  );
}

interface Props {
  hit: SearchHit;
  href: string;
  author?: User;
  tags: Map<string, Tag>;
  focused?: boolean;
  comfortable?: boolean;
  onTagClick?: (tagId: string) => void;
  extra?: ReactNode;
  /** Selection mode (§W5.2): a checkbox that doesn't navigate. */
  selected?: boolean;
  onToggleSelect?: () => void;
  /** Router state for the link (where the post was opened from). */
  linkState?: unknown;
}

export const PostCard = memo(function PostCard({ hit, href, author, tags, focused, comfortable, onTagClick, selected, onToggleSelect, linkState }: Props) {
  const theme = useTheme();
  const { post } = hit;
  const body = hit.highlights.find((h) => h.field !== "title");
  const titleHl = hit.highlights.find((h) => h.field === "title");
  const plain = post.summary ?? docText(blockDocs(post.blocks)[0] ?? null);
  const pool = hit.imageHits?.length ? hit.images.filter((i) => hit.imageHits!.some((h) => h.imageInstanceId === i.imageInstanceId)) : hit.images;
  const maxThumbs = comfortable ? 4 : 3;
  const thumbs = pool.slice(0, maxThumbs);
  const totalImages = Math.max(post.counts.images, hit.images.length);
  const hiddenImages = Math.max(0, (hit.imageHits?.length ? pool.length : totalImages) - thumbs.length);
  const thumbSize = comfortable ? 88 : 56;
  const reactions = Object.values(post.reactions ?? {}).reduce((n, a) => n + a.length, 0);
  return (
    <Box
      component={RouterLink}
      to={href}
      state={linkState}
      data-post-id={post.id}
      // The selection checkbox lives inside the card link: let it toggle without navigating.
      onClick={(e: React.MouseEvent) => (e.target as HTMLElement).closest("input[type=checkbox]") && e.preventDefault()}
      aria-current={focused ? "true" : undefined}
      sx={{
        display: "block",
        textDecoration: "none",
        color: "inherit",
        px: 2,
        py: comfortable ? 1.75 : 1.25,
        borderBottom: 1,
        borderColor: "divider",
        bgcolor: focused ? "action.selected" : "background.paper",
        boxShadow: focused ? `inset 3px 0 0 ${theme.palette.primary.main}` : "none",
        "&:hover": { bgcolor: focused ? "action.selected" : "action.hover" },
        "&:focus-visible": { outlineOffset: -2 },
      }}
    >
      <Stack direction="row" spacing={2} alignItems="flex-start">
        {onToggleSelect && (
          <Checkbox
            checked={!!selected}
            size="small"
            sx={{ p: 0.25, mt: 0.25, mr: -1 }}
            inputProps={{ "aria-label": `Select ${post.title}` }}
            onChange={onToggleSelect}
            onClick={(e) => e.stopPropagation()}
          />
        )}
        <Box sx={{ flex: 1, minWidth: 0 }}>
          {/* Title line: title left, work date pinned top-right. */}
          <Stack direction="row" spacing={1} alignItems="baseline" sx={{ mb: 0.25 }}>
            <Typography variant="subtitle1" component="h3" sx={{ fontWeight: 600, fontSize: comfortable ? "1rem" : "0.92rem", lineHeight: 1.3, flex: 1, minWidth: 0 }} noWrap={!comfortable}>
              {titleHl ? <Highlighted snippet={titleHl.snippet} /> : post.title || "Untitled"}
            </Typography>
            {post.visibility === "hidden" && <StatusPill status="hidden" />}
            {post.status === "draft" && <StatusPill status="draft" />}
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ flexShrink: 0, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}
              title={`Work date ${post.workDate}${post.workDateSource !== "user" ? " (guessed)" : ""}`}
            >
              {formatDay(post.workDate)}
              {post.workDateSource !== "user" && "?"}
            </Typography>
          </Stack>

          {/* Body: excerpt left, thumbnails right. */}
          <Stack direction="row" spacing={2} alignItems="flex-start">
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="body2" color="text.secondary" sx={{ display: "-webkit-box", WebkitLineClamp: comfortable ? 3 : 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                {body ? <Highlighted snippet={body.snippet} /> : plain}
              </Typography>
              {hit.matchedIn.length > 0 && !(hit.matchedIn.length === 1 && hit.matchedIn[0] === "title") && (
                <Typography variant="caption" color="text.disabled" sx={{ display: "block", mt: 0.25 }}>
                  matched in: {hit.matchedIn.join(" · ")}
                </Typography>
              )}
            </Box>
            {thumbs.length > 0 && (
              <Stack direction="row" spacing={0.75} sx={{ display: { xs: "none", sm: "flex" }, pt: 0.25 }}>
                {thumbs.map((t, i) => (
                  <Thumb key={t.imageInstanceId} url={t.thumbUrl} width={t.width} height={t.height} color={t.dominantColor} size={thumbSize} more={i === thumbs.length - 1 ? hiddenImages : 0} />
                ))}
              </Stack>
            )}
          </Stack>

          {/* Footer spans the whole card, so counts line up whether or not a post has images. */}
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 0.75, flexWrap: "wrap", rowGap: 0.5, color: "text.secondary" }}>
            <Stack direction="row" spacing={0.75} alignItems="center">
              <UserAvatar user={author} size={18} />
              <Typography variant="caption" color="text.primary" sx={{ fontWeight: 500 }}>
                {author?.name ?? "…"}
                {post.coAuthorIds.length > 0 && ` +${post.coAuthorIds.length}`}
              </Typography>
            </Stack>
            {post.tagIds.slice(0, 4).map((id) => {
              const t = tags.get(id);
              return t ? (
                <Box key={id} component="span" onClick={onTagClick ? (e) => (e.preventDefault(), e.stopPropagation(), onTagClick(id)) : undefined}>
                  <TagChip tag={t} />
                </Box>
              ) : null;
            })}
            {post.tagIds.length > 4 && <Typography variant="caption">+{post.tagIds.length - 4}</Typography>}
            <Box sx={{ flex: 1 }} />
            {post.source && (
              <Stack direction="row" spacing={0.25} alignItems="center" title={`From "${post.source.fileName}" · slide ${post.source.slide}`}>
                <FileUploadOutlined sx={{ fontSize: 14 }} />
                <Typography variant="caption">slide {post.source.slide}</Typography>
              </Stack>
            )}
            {totalImages > 0 && (
              // Shown on narrow screens (thumbnails hidden) and on image-less hits with images.
              <Stack direction="row" spacing={0.25} alignItems="center" aria-label={`${totalImages} images`} sx={{ display: thumbs.length ? { xs: "flex", sm: "none" } : "flex" }}>
                <CollectionsOutlined sx={{ fontSize: 14 }} />
                <Typography variant="caption">{totalImages}</Typography>
              </Stack>
            )}
            <Stack direction="row" spacing={0.25} alignItems="center" aria-label={`${reactions} reactions`} sx={{ minWidth: 32, justifyContent: "flex-end", visibility: reactions ? "visible" : "hidden" }}>
              <Typography variant="caption">{Object.keys(post.reactions)[0] ?? "👍"}</Typography>
              <Typography variant="caption" sx={{ fontVariantNumeric: "tabular-nums" }}>{reactions}</Typography>
            </Stack>
            <Stack direction="row" spacing={0.25} alignItems="center" aria-label={`${post.counts.comments} comments`} sx={{ minWidth: 32, justifyContent: "flex-end", visibility: post.counts.comments ? "visible" : "hidden" }}>
              <ChatBubbleOutlineRounded sx={{ fontSize: 14 }} />
              <Typography variant="caption" sx={{ fontVariantNumeric: "tabular-nums" }}>{post.counts.comments}</Typography>
            </Stack>
          </Stack>
        </Box>
      </Stack>
    </Box>
  );
});
