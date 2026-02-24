import {
  Add,
  ArrowDownward,
  ArrowRight,
  Share,
  Comment,
} from "@mui/icons-material";
import { Box, Button, Collapse } from "@mui/material";
import { useEffect, useRef, useState } from "react";
import { ReplyBox } from "./ReplyBox";
import {
  getUser,
  countComments,
  timeAgo,
  sBtn,
  mergeCodeBlocks,
} from "../utilities/helpers";
import { Av } from "./AvatarComponent";
import { CommentNode } from "./CommentNode";
import { ImageAnnotator } from "./ImageAnnotator";
import type {
  CommentType,
  PostType,
  TagsType,
  UserData,
} from "../interfaces/TeamActivityLogInterfaces";
import { Tag } from "./Tags";

interface PostCardType {
  post: PostType;
  onReact: (postId: number, emoji: string) => void;
  onAddComment: (postId: number, text: string) => void;
  onAddReply: (postId: number, parentId: number, text: string) => void;

  onUpdateImage: (postId: number, imgIdx: number, dataUrl: string) => void;
  users?: UserData[];
  tags?: TagsType[];
}

// ─── POST CARD ────────────────────────────────────────────────────────────────
export const PostCard = ({
  post,
  onReact,
  onAddComment,
  onAddReply,

  onUpdateImage,
  users,
  tags,
}: PostCardType) => {
  const [showComments, setShowComments] = useState(false);
  const [commenting, setCommenting] = useState(false);
  const [annotatingImg, setAnnotatingImg] = useState<{
    src: string;
    blockIdx: number;
  } | null>(null);
  const [collapsed, setCollapsed] = useState(true);
  const COLLAPSE_HEIGHT = 300; // px — enough to show ~2 blocks

  const user = users ? getUser(users, post.userId) : null;

  const currentUser = users ? users[0] : null;

  const contentRef = useRef<HTMLDivElement>(null);

  const commentCount = countComments(post.comments);
  const [needsCollapse, setNeedsCollapse] = useState(false);

  function ExpandToggle({
    collapsed,
    setCollapsed,
    contentRef,
  }: {
    collapsed: boolean;
    setCollapsed: (v: boolean) => void;
    contentRef: React.RefObject<HTMLDivElement | null>;
  }) {
    useEffect(() => {
      if (contentRef.current) {
        setNeedsCollapse(contentRef.current.scrollHeight > COLLAPSE_HEIGHT);
      }
    }, [contentRef]);

    if (!needsCollapse) return null;

    return (
      <button
        onClick={() => setCollapsed(!collapsed)}
        style={{
          width: "100%",
          background: "none",
          border: "none",
          color: "#475569",
          cursor: "pointer",
          padding: "6px 0",
          fontSize: ".78rem",
          fontFamily: "'IBM Plex Sans', sans-serif",
        }}
      >
        {collapsed ? "▸ Show more" : "▴ Show less"}
      </button>
    );
  }

  return (
    <article
      style={{
        background: "#171b26",
        border: "1px solid #ffffff0c",
        borderRadius: 10,
        marginBottom: 12,
        overflow: "visible",
        transition: "border-color .2s",
        minWidth: 300,
      }}
      onMouseEnter={(e) => (e.currentTarget.style.borderColor = "#ffffff18")}
      onMouseLeave={(e) => (e.currentTarget.style.borderColor = "#ffffff0c")}
    >
      {/* Header */}
      <Box
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          padding: "14px 16px 8px",
        }}
      >
        <Box style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <Av user={user} size={38} />
          <Box>
            <Box style={{ display: "flex", gap: 7, alignItems: "center" }}>
              <span
                style={{
                  fontWeight: 700,
                  fontSize: ".9rem",
                  color: "#f1f5f9",
                }}
              >
                {user?.name}
              </span>
              <span
                style={{
                  fontSize: ".65rem",
                  padding: "1px 6px",
                  borderRadius: 3,
                  fontFamily: "monospace",
                  background: `${user?.color}22`,
                  color: user?.color ?? "default",
                }}
              >
                {user?.role}
              </span>
            </Box>
            <span
              style={{
                fontSize: ".68rem",
                color: "#334155",
                fontFamily: "monospace",
              }}
            >
              {post && timeAgo(post.timestamp)} ago
            </span>
          </Box>
        </Box>
      </Box>
      {/* Content */}
      {/* Blocks with collapse */}
      <Box sx={{ position: "relative" }}>
        <Box
          sx={{
            maxHeight: collapsed ? COLLAPSE_HEIGHT : "none",
            overflow: "hidden",
            transition: "max-height .3s ease",
          }}
          className="post-content"
          ref={contentRef}
        >
          {/* Sequential blocks — text and images in order */}
          {post.blocks.map((block, i) => {
            if (block.type === "text") {
              return (
                <div
                  className="post-content-block"
                  key={i}
                  style={{
                    padding: "0 16px",
                    fontSize: ".88rem",
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
                <Box key={i} style={{ padding: "0 16px 10px" }}>
                  <Box
                    component="img"
                    src={block.src}
                    onClick={() =>
                      setAnnotatingImg({ src: block.src, blockIdx: i })
                    }
                    sx={{
                      width: "auto",
                      maxWidth: "100%",
                      maxHeight: 400,
                      borderRadius: 1.5,
                      display: "block",
                      cursor: "pointer",
                      objectFit: "contain",
                      margin: 2,
                      "&:hover": { opacity: 0.9 },
                    }}
                  />
                  {block.caption && (
                    <Box
                      style={{
                        fontSize: ".72rem",
                        color: "#475569",
                        marginTop: 4,
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
        {/* Fade overlay — only shows when collapsed and content is tall */}
        {collapsed && needsCollapse && (
          <Box
            sx={{
              position: "absolute",
              bottom: 0,
              left: 0,
              right: 0,
              height: 80,
              background: "linear-gradient(transparent, #171b26)", // match card bg
              pointerEvents: "none",
            }}
          />
        )}
        {/* Expand/collapse toggle — only render if content is actually tall */}
      </Box>
      <ExpandToggle
        collapsed={collapsed}
        setCollapsed={setCollapsed}
        contentRef={contentRef}
      />
      {/* Tags */}
      {post.tags.length > 0 && (
        <Box
          style={{
            padding: "0 16px 10px",
            display: "flex",
            gap: 5,
            flexWrap: "wrap",
            marginTop: 20,
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
        {/* Comment */}
        <Box style={{ flex: 1, borderRight: "1px solid #ffffff08" }}>
          <Button
            sx={{
              color: "text.secondary",
              flex: 1,
              "&:hover": {
                color: "#818cf8",
                bgcolor: "rgba(255,255,255,0.04)",
              },
            }}
            startIcon={<Comment />}
            fullWidth
            onClick={() => {
              setShowComments(true);
              setCommenting(true);
            }}
            // sx={{ hoverColor: "#818cf8" }}
          >
            {" "}
            {commentCount > 0 ? `${commentCount} ` : ""}Comment
            {commentCount !== 1 ? "s" : ""}
          </Button>
        </Box>
        {/* Toggle thread */}
        {commentCount > 0 && (
          <Box style={{ flex: 1 }}>
            <Button
              onClick={() => {
                const value = !showComments;
                setShowComments(value);

                if (!value) {
                  setCommenting(value);
                }
              }}
              sx={{
                color: "text.secondary",
                flex: 1,
                "&:hover": {
                  color: "#34d399",
                  bgcolor: "rgba(255,255,255,0.04)",
                },
              }}
              startIcon={showComments ? <ArrowDownward /> : <ArrowRight />}
              fullWidth
            >
              {showComments ? "Hide thread" : "View thread"}
            </Button>
          </Box>
        )}
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
          }}
        >
          Share
        </Button>
      </Box>

      {/* Thread */}
      <Collapse in={showComments || commenting}>
        <Box
          style={{
            padding: "4px 16px 14px",
            borderTop: "1px solid #ffffff08",
          }}
        >
          {currentUser &&
            users &&
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
            <Box style={{ marginTop: 10 }}>
              <ReplyBox
                placeholder="Add a comment… (Enter to post)"
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
              style={{ ...sBtn, marginTop: 10, fontSize: ".75rem" }}
            >
              <Add /> Add comment
            </Button>
          )}
        </Box>
      </Collapse>
      {/* Annotator for post images (saves back into post) */}
      {annotatingImg !== null && (
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
    </article>
  );
};
