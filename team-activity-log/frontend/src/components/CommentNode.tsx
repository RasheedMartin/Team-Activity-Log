import { Box } from "@mui/material";
import { useState } from "react";
import { ReplyBox } from "./ReplyBox";
import { getUser, timeAgo } from "../utilities/helpers";
import { Av } from "./AvatarComponent";
import type {
  CommentType,
  UserData,
} from "../interfaces/TeamActivityLogInterfaces";

interface CommentNodeProps {
  comment: CommentType;
  depth: number;
  onReply: (parentId: number, text: string) => void;
  users: UserData[];
}

// ─── RECURSIVE COMMENT NODE ───────────────────────────────────────────────────
export const CommentNode = ({
  comment,
  depth = 0,
  onReply,
  users,
}: CommentNodeProps) => {
  const [showReplies, setShowReplies] = useState(true);
  const [replying, setReplying] = useState(false);
  const hasReplies = comment.replies?.length > 0;
  const indent = depth * 20;

  const user = users ? getUser(users, comment.userId) : null;

  return (
    <Box style={{ marginLeft: indent, marginTop: depth === 0 ? 10 : 6 }}>
      {/* Thread line */}
      <Box style={{ display: "flex", gap: 8 }}>
        {depth > 0 && (
          <Box
            style={{
              width: 2,
              background: "#ffffff08",
              borderRadius: 2,
              flexShrink: 0,
              alignSelf: "stretch",
              marginLeft: 10,
            }}
          />
        )}
        <Box style={{ flex: 1 }}>
          <Box style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
            <Av user={user} size={depth === 0 ? 28 : 22} />
            <Box style={{ flex: 1, minWidth: 0 }}>
              {/* Comment header */}
              <Box
                style={{
                  display: "flex",
                  gap: 8,
                  alignItems: "baseline",
                  flexWrap: "wrap",
                }}
              >
                <span
                  style={{
                    fontSize: depth === 0 ? ".82rem" : ".78rem",
                    fontWeight: 700,
                    color: "#e2e8f0",
                  }}
                >
                  {user?.name}
                </span>
                <span
                  style={{
                    fontSize: ".65rem",
                    color: "#334155",
                    fontFamily: "monospace",
                  }}
                >
                  {timeAgo(comment.time)} ago
                </span>
              </Box>
              {/* Comment body */}
              <p
                style={{
                  margin: "2px 0 4px",
                  fontSize: depth === 0 ? ".82rem" : ".78rem",
                  color: "#94a3b8",
                  lineHeight: 1.6,
                }}
              >
                {comment.text}
              </p>
              {/* Comment actions */}
              <Box
                style={{
                  display: "flex",
                  gap: 10,
                  alignItems: "center",
                  flexWrap: "wrap",
                }}
              >
                {/* Inline reactions */}

                <button
                  onClick={() => setReplying(!replying)}
                  style={{
                    background: "none",
                    border: "none",
                    color: "#334155",
                    cursor: "pointer",
                    fontSize: ".72rem",
                    fontFamily: "inherit",
                    padding: "1px 0",
                  }}
                >
                  {replying ? "Cancel" : "Reply"}
                </button>
                {hasReplies && (
                  <button
                    onClick={() => setShowReplies(!showReplies)}
                    style={{
                      background: "none",
                      border: "none",
                      color: "#334155",
                      cursor: "pointer",
                      fontSize: ".72rem",
                      fontFamily: "inherit",
                      padding: "1px 0",
                    }}
                  >
                    {showReplies
                      ? `▾ Hide ${comment.replies.length}`
                      : `▸ Show ${comment.replies.length} ${comment.replies.length === 1 ? "reply" : "replies"}`}
                  </button>
                )}
              </Box>
              {users && replying && (
                <ReplyBox
                  placeholder={`Reply to ${user?.name}…`}
                  onSubmit={(text: string) => {
                    onReply(comment.id, text);
                    setReplying(false);
                  }}
                  onCancel={() => setReplying(false)}
                  users={users}
                />
              )}
            </Box>
          </Box>
          {/* Nested replies */}
          {showReplies && hasReplies && (
            <Box style={{ marginLeft: depth === 0 ? 36 : 20 }}>
              {comment.replies.map((r) => (
                <CommentNode
                  key={r.id}
                  comment={r}
                  depth={depth + 1}
                  onReply={onReply}
                  users={users}
                />
              ))}
            </Box>
          )}
        </Box>
      </Box>
    </Box>
  );
};
