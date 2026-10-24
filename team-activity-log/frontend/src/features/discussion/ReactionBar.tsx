import { AddReactionOutlined } from "@mui/icons-material";
import { Box, ButtonBase, IconButton, Popover, Stack, Tooltip } from "@mui/material";
import { useState } from "react";
import type { Comment, ID, Post } from "../../api/contract";
import { usePeople, useToggleReaction } from "../../api/hooks";
import { useWs } from "../../app/session";

const EMOJI = ["👍", "🎉", "👀", "🔥", "❤️", "🤔", "✅", "😄"];

/** Emoji toggles with who-reacted on hover (§W3.4). Viewers may react (decision C2.4). */
export function ReactionBar({ post, comment, compact }: { post: Post; comment?: Comment; compact?: boolean }) {
  const { org, me } = useWs();
  const toggle = useToggleReaction(org.id, me.user.id);
  const { data: people = [] } = usePeople(org.id);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const reactions = comment ? comment.reactions : post.reactions;
  const name = (id: ID) => (id === me.user.id ? "You" : people.find((p) => p.id === id)?.name ?? "Someone");
  const readOnly = post.visibility === "hidden" || !!comment?.deletedAt;
  const fire = (emoji: string) => toggle.mutate({ targetType: comment ? "comment" : "post", targetId: comment?.id ?? post.id, postId: post.id, emoji });
  const entries = Object.entries(reactions).filter(([, ids]) => ids.length);
  return (
    <Stack direction="row" spacing={0.5} alignItems="center" sx={{ flexWrap: "wrap", rowGap: 0.5 }}>
      {entries.map(([emoji, ids]) => {
        const mine = ids.includes(me.user.id);
        return (
          <Tooltip key={emoji} title={`${ids.map(name).join(", ")} reacted ${emoji}`}>
            <ButtonBase
              onClick={() => !readOnly && fire(emoji)}
              aria-pressed={mine}
              aria-label={`${emoji} ${ids.length}${mine ? ", including you" : ""}`}
              sx={{
                px: 0.75,
                py: compact ? 0 : 0.25,
                borderRadius: 999,
                border: 1,
                borderColor: mine ? "primary.main" : "divider",
                bgcolor: mine ? "action.selected" : "transparent",
                fontSize: compact ? "0.75rem" : "0.82rem",
                gap: 0.5,
              }}
            >
              <span>{emoji}</span>
              <Box component="span" sx={{ color: "text.secondary", fontVariantNumeric: "tabular-nums" }}>{ids.length}</Box>
            </ButtonBase>
          </Tooltip>
        );
      })}
      {!readOnly && (
        <>
          <Tooltip title="Add reaction">
            <IconButton size="small" onClick={(e) => setAnchor(e.currentTarget)} aria-label="Add reaction" sx={{ color: "text.disabled" }}>
              <AddReactionOutlined sx={{ fontSize: compact ? 16 : 18 }} />
            </IconButton>
          </Tooltip>
          <Popover open={!!anchor} anchorEl={anchor} onClose={() => setAnchor(null)} anchorOrigin={{ vertical: "top", horizontal: "left" }} transformOrigin={{ vertical: "bottom", horizontal: "left" }}>
            <Stack direction="row" sx={{ p: 0.5 }}>
              {EMOJI.map((e) => (
                <IconButton key={e} onClick={() => (fire(e), setAnchor(null))} aria-label={`React ${e}`} sx={{ fontSize: 18 }}>
                  {e}
                </IconButton>
              ))}
            </Stack>
          </Popover>
        </>
      )}
    </Stack>
  );
}
