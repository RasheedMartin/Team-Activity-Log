import { AddCommentOutlined, CloseRounded } from "@mui/icons-material";
import { Box, Button, ButtonBase, Popover, Stack, Typography } from "@mui/material";
import { useMemo, useState } from "react";
import type { Comment, ID, ImageView, Post } from "../../api/contract";
import { useAddComment, usePeople } from "../../api/hooks";
import { can, useWs } from "../../app/session";
import { useNotify } from "../../components/notify";
import { RichText } from "../../components/RichText";
import { UserAvatar } from "../../components/ui";
import { timeAgo } from "../../lib/dates";
import { errorMessage } from "../../lib/format";
import { AnnotatedImage } from "../posts/editor/ImageBlock";
import { CommentEditor } from "./CommentEditor";
import { pinNumbers } from "./threads";

/**
 * Wraps an image with numbered comment pins (§W3.3). Members can switch to pin mode, click a
 * spot, and comment there; pins open a preview and link to the thread (and back).
 */
export function PinnableImage({ post, image, comments, images, maxHeight, onImageClick, onOpenThread }: { post: Post; image: ImageView; comments: Comment[]; images: ImageView[]; maxHeight?: number; onImageClick: () => void; onOpenThread: (commentId: ID) => void }) {
  const { org, me, role } = useWs();
  const add = useAddComment(org.id, post.id, me.user.id);
  const notify = useNotify();
  const { data: people = [] } = usePeople(org.id);
  const [pinMode, setPinMode] = useState(false);
  const [draft, setDraft] = useState<{ x: number; y: number; el: HTMLElement } | null>(null);
  const [open, setOpen] = useState<{ c: Comment; el: HTMLElement } | null>(null);
  const numbers = useMemo(() => pinNumbers(comments, images), [comments, images]);
  const pins = comments.filter((c) => c.anchor?.imageInstanceId === image.id && !c.deletedAt);
  const canPin = can(role, "member") && post.visibility === "visible" && post.status === "published";
  const replies = (id: ID) => comments.filter((c) => c.parentId === id && !c.deletedAt).length;

  return (
    <Box sx={{ position: "relative" }}>
      <AnnotatedImage image={image} maxHeight={maxHeight} onClick={pinMode ? undefined : onImageClick}>
        {pinMode && (
          <Box
            aria-label="Click to place a comment pin"
            onClick={(e) => {
              const box = e.currentTarget.getBoundingClientRect();
              setDraft({ x: (e.clientX - box.left) / box.width, y: (e.clientY - box.top) / box.height, el: e.currentTarget });
            }}
            sx={{ position: "absolute", inset: 0, cursor: "crosshair", zIndex: 1, outline: "2px dashed", outlineColor: "primary.main", outlineOffset: -2 }}
          />
        )}
        {pins.map((c) => {
          const n = numbers.get(c.id)?.n ?? 0;
          return (
            <ButtonBase
              key={c.id}
              id={`pin-${c.id}`}
              aria-label={`Comment pin ${n}${c.isQuestion && !c.resolved ? ", open question" : ""}`}
              onClick={(e) => (e.stopPropagation(), setOpen({ c, el: e.currentTarget }))}
              sx={{
                position: "absolute",
                zIndex: 2,
                left: `${c.anchor!.x * 100}%`,
                top: `${c.anchor!.y * 100}%`,
                transform: "translate(-50%, -100%) rotate(-45deg)",
                transformOrigin: "50% 100%",
                width: 26,
                height: 26,
                borderRadius: "50% 50% 50% 0",
                bgcolor: c.resolved ? "success.main" : "primary.main",
                color: "primary.contrastText",
                boxShadow: 3,
                border: "2px solid #fff",
                "& span": { transform: "rotate(45deg)", fontSize: 12, fontWeight: 700 },
              }}
            >
              <span>{n}</span>
            </ButtonBase>
          );
        })}
        {draft && <Box sx={{ position: "absolute", zIndex: 2, left: `${draft.x * 100}%`, top: `${draft.y * 100}%`, width: 14, height: 14, borderRadius: "50%", bgcolor: "primary.main", border: "2px solid #fff", transform: "translate(-50%, -50%)", boxShadow: 3 }} />}
      </AnnotatedImage>
      {canPin && (
        <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 0.5 }}>
          <Button size="small" startIcon={pinMode ? <CloseRounded /> : <AddCommentOutlined />} onClick={() => (setPinMode(!pinMode), setDraft(null))} variant={pinMode ? "contained" : "text"} sx={{ fontSize: "0.75rem" }}>
            {pinMode ? "Cancel pin" : "Comment on image"}
          </Button>
          {pinMode && <Typography variant="caption" color="text.secondary">Click a spot on the image</Typography>}
        </Stack>
      )}
      <Popover open={!!draft} anchorEl={draft?.el} onClose={() => setDraft(null)} anchorOrigin={{ vertical: "bottom", horizontal: "left" }}>
        <Box sx={{ p: 1.5, width: 360 }}>
          <CommentEditor
            orgId={org.id}
            postId={post.id}
            people={people}
            autoFocus
            allowQuestion
            placeholder="Comment on this spot…"
            onCancel={() => setDraft(null)}
            onSubmit={(d) => {
              add.mutate({ ...d, anchor: { imageInstanceId: image.id, x: draft!.x, y: draft!.y } }, { onSuccess: () => notify("Pinned comment added"), onError: (e) => notify(errorMessage(e)) });
              setDraft(null);
              setPinMode(false);
            }}
          />
        </Box>
      </Popover>
      <Popover open={!!open} anchorEl={open?.el} onClose={() => setOpen(null)} anchorOrigin={{ vertical: "bottom", horizontal: "center" }} transformOrigin={{ vertical: "top", horizontal: "center" }}>
        {open && (
          <Box sx={{ p: 1.5, width: 340 }}>
            <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
              <UserAvatar user={people.find((p) => p.id === open.c.authorId)} size={22} />
              <Typography variant="body2" sx={{ fontWeight: 600, flex: 1 }}>{people.find((p) => p.id === open.c.authorId)?.name}</Typography>
              <Typography variant="caption" color="text.secondary">{timeAgo(open.c.createdAt)}</Typography>
            </Stack>
            <RichText doc={open.c.doc} sx={{ fontSize: "0.88rem" }} />
            <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mt: 1 }}>
              <Typography variant="caption" color="text.secondary">{replies(open.c.id)} {replies(open.c.id) === 1 ? "reply" : "replies"}</Typography>
              <Button size="small" onClick={() => (onOpenThread(open.c.id), setOpen(null))}>Open in discussion</Button>
            </Stack>
          </Box>
        )}
      </Popover>
    </Box>
  );
}
