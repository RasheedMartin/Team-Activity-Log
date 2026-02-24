import {
  Add,
  Close,
  ArrowDownward,
  ArrowRight,
  Share,
} from "@mui/icons-material";
import { Box, Button, Collapse, IconButton } from "@mui/material";
import { useEffect, useState } from "react";
import { ReplyBox } from "./ReplyBox";
import { getUser, countComments, timeAgo, sBtn } from "../utilities/helpers";
import { Av } from "./AvatarComponent";
import { CommentNode } from "./CommentNode";
import { ImageAnnotator } from "./ImageAnnotator";
import { Tag } from "./Tags";
import { mergeCodeBlocks } from "../utilities/helpers";
import type {
  CommentType,
  PostType,
  TagsType,
  UserData,
} from "../interfaces/TeamActivityLogInterfaces";

interface FullPostPanelProps {
  post: PostType;
  onClose: () => void;
  onAddComment: (postId: number, text: string) => void;
  onAddReply: (postId: number, parentId: number, text: string) => void;
  onUpdateImage: (postId: number, blockIdx: number, dataUrl: string) => void;
  users?: UserData[];
  tags?: TagsType[];
}

export const FullPostPanel = ({
  post,
  onClose,
  onAddComment,
  onAddReply,
  onUpdateImage,
  users,
  tags,
}: FullPostPanelProps) => {
  const [showComments, setShowComments] = useState(true);
  const [commenting, setCommenting] = useState(false);
  const [annotatingImg, setAnnotatingImg] = useState<{
    src: string;
    blockIdx: number;
  } | null>(null);

  const [user, setUser] = useState<UserData | null>(null);

  useEffect(() => {
    if (users) {
      setUser(getUser(users, post.userId));
    }
  }, [users, post.userId]);

  // Reset comment state when post changes
  useEffect(() => {
    setShowComments(true);
    setCommenting(false);
  }, [post.id]);

  const commentCount = countComments(post.comments);

  return (
    <Box
      style={{
        background: "#171b26",
        border: "1px solid #ffffff0c",
        borderRadius: 10,
        overflow: "hidden",
        marginBottom: 10,
      }}
    >
      {/* Panel header */}
      <Box
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "10px 14px",
          borderBottom: "1px solid #ffffff0c",
          background: "#1a1f30",
        }}
      >
        <Box
          style={{
            fontFamily: "monospace",
            fontSize: ".6rem",
            color: "#f59e0b",
            letterSpacing: 2,
            fontWeight: 700,
          }}
        >
          {post.title ?? ""}
        </Box>
        <IconButton
          size="small"
          onClick={onClose}
          sx={{ color: "#475569", "&:hover": { color: "#f1f5f9" } }}
        >
          <Close fontSize="small" />
        </IconButton>
      </Box>

      {/* Post author */}
      <Box
        style={{
          display: "flex",
          gap: 8,
          alignItems: "center",
          padding: "12px 14px 8px",
        }}
      >
        <Av user={user} size={32} />
        <Box>
          <Box style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <span
              style={{ fontWeight: 700, fontSize: ".85rem", color: "#f1f5f9" }}
            >
              {user?.name}
            </span>
            <span
              style={{
                fontSize: ".62rem",
                padding: "1px 5px",
                borderRadius: 3,
                fontFamily: "monospace",
                background: `${user?.color}22`,
                color: user?.color ?? "#94a3b8",
              }}
            >
              {user?.role}
            </span>
          </Box>
          <span
            style={{
              fontSize: ".65rem",
              color: "#334155",
              fontFamily: "monospace",
            }}
          >
            {timeAgo(post.timestamp)} ago
          </span>
        </Box>
      </Box>

      {/* Full blocks content */}
      <Box className="post-content">
        {post.blocks.map((block, i) => {
          if (block.type === "text") {
            return (
              <div
                key={i}
                className="post-content-block"
                style={{
                  padding: "0 14px 8px",
                  fontSize: ".85rem",
                  color: "#cbd5e1",
                }}
                dangerouslySetInnerHTML={{
                  __html: mergeCodeBlocks(block.html),
                }}
              />
            );
          }
          if (block.type === "image") {
            return (
              <Box key={i} style={{ padding: "4px 14px 8px" }}>
                <Box
                  component="img"
                  src={block.src}
                  onClick={() =>
                    setAnnotatingImg({ src: block.src, blockIdx: i })
                  }
                  sx={{
                    maxWidth: "100%",
                    width: "auto",
                    maxHeight: 300,
                    borderRadius: 1.5,
                    display: "block",
                    cursor: "pointer",
                    objectFit: "contain",
                    "&:hover": { opacity: 0.9 },
                  }}
                />
                {block.caption && (
                  <Box
                    style={{
                      fontSize: ".7rem",
                      color: "#475569",
                      marginTop: 3,
                      fontStyle: "italic",
                    }}
                  >
                    {block.caption}
                  </Box>
                )}
              </Box>
            );
          }
        })}
      </Box>

      {/* Tags */}
      {post.tags.length > 0 && (
        <Box
          style={{
            padding: "0 14px 8px",
            display: "flex",
            gap: 5,
            flexWrap: "wrap",
          }}
        >
          {tags &&
            post.tags.map((t: string) => (
              <Tag
                key={t}
                tag={t}
                active
                color={
                  tags.find((item) => item.label === t)?.color ?? "#94a3b8"
                }
              />
            ))}
        </Box>
      )}

      <Box style={{ height: 1, background: "#ffffff08" }} />

      {/* Action bar */}
      <Box style={{ display: "flex" }}>
        <Box style={{ flex: 1 }}>
          <Button
            fullWidth
            size="small"
            onClick={() => {
              setShowComments(!showComments);
            }}
            startIcon={showComments ? <ArrowDownward /> : <ArrowRight />}
            sx={{
              color: "text.secondary",
              "&:hover": {
                color: "#818cf8",
                bgcolor: "rgba(255,255,255,0.04)",
              },
              marginLeft: 1,
              marginRight: 1,
            }}
          >
            {commentCount > 0 ? `${commentCount} ` : ""}Comment
            {commentCount !== 1 ? "s" : ""}
          </Button>
        </Box>
        <Button
          size="small"
          startIcon={<Share fontSize="small" />}
          fullWidth
          sx={{
            color: "text.secondary",
            flex: 1,
            "&:hover": {
              color: "#2196f3",
              bgcolor: "rgba(255,255,255,0.04)",
            },
            marginLeft: 1,
            marginRight: 1,
          }}
        >
          Share
        </Button>
      </Box>

      {/* Comments */}
      <Collapse in={showComments}>
        <Box
          style={{ padding: "4px 14px 12px", borderTop: "1px solid #ffffff08" }}
        >
          {users &&
            post.comments.map((c: CommentType) => (
              <CommentNode
                key={c.id}
                comment={c}
                depth={0}
                onReply={(parentId: number, text: string) =>
                  onAddReply(post.id, parentId, text)
                }
                users={users}
              />
            ))}
          {users && commenting && (
            <Box style={{ marginTop: 8 }}>
              <ReplyBox
                placeholder="Add a comment…"
                onSubmit={(text: string) => {
                  onAddComment(post.id, text);
                  setCommenting(false);
                }}
                onCancel={() => setCommenting(false)}
                users={users}
              />
            </Box>
          )}
          {!commenting && (
            <Button
              onClick={() => setCommenting(true)}
              style={{ ...sBtn, marginTop: 8, fontSize: ".72rem" }}
            >
              <Add sx={{ fontSize: "0.9rem" }} /> Add comment
            </Button>
          )}
        </Box>
      </Collapse>

      {/* Image annotator */}
      {annotatingImg && (
        <ImageAnnotator
          imageSrc={annotatingImg.src}
          onSave={(dataUrl: string) => {
            onUpdateImage(post.id, annotatingImg.blockIdx, dataUrl);
            setAnnotatingImg(null);
          }}
          onClose={() => setAnnotatingImg(null)}
          onDelete={undefined}
        />
      )}
    </Box>
  );
};
