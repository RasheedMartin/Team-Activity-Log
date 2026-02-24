import { Box, Collapse } from "@mui/material";
import {
  flattenComments,
  countComments,
  getUser,
  timeAgo,
} from "../utilities/helpers";
import { Av } from "./AvatarComponent";
import type {
  CommentType,
  OpenPanel,
  PostRequest,
  PostType,
  TagsType,
  UserData,
} from "../interfaces/TeamActivityLogInterfaces";
import { PostComposer } from "./PostComposer";
import { FullPostPanel } from "./FullPostPanel";

interface RightPanelProps {
  posts?: PostType[];
  users?: UserData[];
  handlePost: ({ blocks, tags }: PostRequest) => void;
  tags?: TagsType[];
  onClick: (postId: number) => void;
  focusedPost?: PostType | null;
  onClearPost?: () => void;
  onAddComment: (postId: number, text: string) => void;
  onAddReply: (postId: number, parentId: number, text: string) => void;
  onUpdateImage: (postId: number, blockIdx: number, dataUrl: string) => void;
  openPanel: OpenPanel;
  setOpenPanel: React.Dispatch<React.SetStateAction<OpenPanel>>;
  setFocusedPostId: React.Dispatch<React.SetStateAction<number | null>>;
  isMobile: boolean;
  isTablet: boolean;
}

const SectionHeader = ({
  label,
  isOpen,
  onClick,
}: {
  label: string;
  isOpen: boolean;
  onClick: () => void;
}) => (
  <Box
    onClick={onClick}
    style={{
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      cursor: "pointer",
      userSelect: "none",
    }}
  >
    <Box
      style={{
        fontFamily: "monospace",
        fontSize: ".6rem",
        color: "#334155",
        letterSpacing: 2,
      }}
    >
      {label}
    </Box>
    <Box
      style={{
        fontSize: ".6rem",
        color: "#334155",
        fontFamily: "monospace",
        transition: "transform .2s",
        transform: isOpen ? "rotate(180deg)" : "rotate(0deg)",
      }}
    >
      ▾
    </Box>
  </Box>
);

// ─── RIGHT PANEL ──────────────────────────────────────────────────────────────
export const RightPanel: React.FC<RightPanelProps> = ({
  posts,
  users,
  handlePost,
  tags,
  onClick,
  focusedPost,
  onClearPost,
  onAddComment,
  onAddReply,
  onUpdateImage,
  openPanel,
  setOpenPanel,
  setFocusedPostId,
  isMobile,
  isTablet,
}) => {
  const toggle = (panel: OpenPanel) =>
    setOpenPanel((prev) => (prev === panel ? "composer" : panel));

  const today = posts?.filter(
    (p) => new Date(p.timestamp).toDateString() === new Date().toDateString(),
  );

  const recentPosts = posts?.sort(
    (a: PostType & { id: number }, b: PostType & { id: number }) => {
      return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
    },
  );
  const allComments = posts
    ?.flatMap((p) =>
      flattenComments(p.comments).map((c) => ({ ...c, postId: p.id })),
    )
    .sort(
      (
        a: CommentType & { postId: number },
        b: CommentType & { postId: number },
      ) => {
        return new Date(b.time).getTime() - new Date(a.time).getTime();
      },
    )
    .slice(0, 20);

  return (
    <Box
      component="aside"
      sx={{
        width: "100%", // always take full width of container
        maxWidth: 1400, // never exceed 1400px
        mx: "auto", // center horizontally
        display: "flex",
        flexDirection: "column",
        gap: 1,
        px: isMobile || isTablet ? 2 : 0, // optional padding on small screens
      }}
    >
      {/* Composer */}
      <Box
        style={{
          background: "#171b26",
          border: "1px solid #ffffff0c",
          borderRadius: 10,
          overflow: "hidden",
        }}
      >
        <Box
          style={{
            padding: "14px 14px",
            paddingBottom: openPanel === "composer" ? 0 : 14,
          }}
        >
          <SectionHeader
            label="NEW LOG"
            isOpen={openPanel === "composer"}
            onClick={() => toggle("composer")}
          />
        </Box>
        <Collapse in={openPanel === "composer"}>
          <PostComposer onPost={handlePost} tags={tags} users={users} />
        </Collapse>
      </Box>

      {/* Stats */}
      <Box
        style={{
          background: "#171b26",
          border: "1px solid #ffffff0c",
          borderRadius: 10,
          padding: "14px",
        }}
      >
        <SectionHeader
          label="TODAY'S ACTIVITY"
          isOpen={openPanel === "stats"}
          onClick={() => toggle("stats")}
        />
        <Collapse in={openPanel === "stats"}>
          <Box style={{ marginTop: 12 }}>
            {[
              { label: "Logs posted", value: today?.length },
              { label: "Total logs", value: posts?.length },
              {
                label: "Comments",
                value: posts?.reduce(
                  (s, p) => s + countComments(p.comments),
                  0,
                ),
              },
              { label: "Team members", value: users?.length ?? 0 },
            ].map(({ label, value }) => (
              <Box
                key={label}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "5px 0",
                  borderBottom: "1px solid #ffffff06",
                }}
              >
                <span style={{ fontSize: ".78rem", color: "#64748b" }}>
                  {label}
                </span>
                <span
                  style={{
                    fontSize: ".88rem",
                    fontWeight: 700,
                    color: "#f59e0b",
                    fontFamily: "monospace",
                  }}
                >
                  {value}
                </span>
              </Box>
            ))}
          </Box>
        </Collapse>
      </Box>

      {/* Recent comments */}
      <Box
        style={{
          background: "#171b26",
          border: "1px solid #ffffff0c",
          borderRadius: 10,
          padding: "14px",
        }}
      >
        <SectionHeader
          label="RECENT COMMENTS"
          isOpen={openPanel === "comments"}
          onClick={() => toggle("comments")}
        />
        <Collapse in={openPanel === "comments"}>
          <Box style={{ marginTop: 10 }}>
            {users &&
              allComments?.map((c) => {
                const u = getUser(users, c.userId);
                return (
                  <Box
                    key={c.id}
                    onClick={() => {
                      onClick(c.postId);
                      setFocusedPostId(c.postId);
                      setOpenPanel("fullpost");
                    }}
                    style={{
                      display: "flex",
                      gap: 7,
                      marginBottom: 10,
                      alignItems: "flex-start",
                      cursor: "pointer",
                      padding: "4px 6px",
                      borderRadius: 6,
                      transition: "background .15s",
                    }}
                    onMouseEnter={(e) =>
                      (e.currentTarget.style.background = "#ffffff08")
                    }
                    onMouseLeave={(e) =>
                      (e.currentTarget.style.background = "transparent")
                    }
                  >
                    <Av user={u} size={22} />
                    <Box>
                      <Box
                        style={{
                          fontSize: ".72rem",
                          fontWeight: 600,
                          color: "#94a3b8",
                        }}
                      >
                        {u.name}{" "}
                        <span
                          style={{
                            color: "#334155",
                            fontWeight: 400,
                            fontFamily: "monospace",
                          }}
                        >
                          {timeAgo(c.time)}
                        </span>
                      </Box>
                      <Box
                        style={{
                          fontSize: ".75rem",
                          color: "#475569",
                          lineHeight: 1.5,
                          marginTop: 1,
                        }}
                      >
                        {c.text.length > 60
                          ? c.text.slice(0, 60) + "…"
                          : c.text}
                      </Box>
                    </Box>
                  </Box>
                );
              })}
          </Box>
        </Collapse>
      </Box>
      {/* Recent posts */}
      <Box
        style={{
          background: "#171b26",
          border: "1px solid #ffffff0c",
          borderRadius: 10,
          padding: "14px",
        }}
      >
        <SectionHeader
          label="RECENT POSTS"
          isOpen={openPanel === "posts"}
          onClick={() => toggle("posts")}
        />
        <Collapse in={openPanel === "posts"}>
          <Box style={{ marginTop: 10 }}>
            {users &&
              recentPosts?.map((p) => {
                const u = getUser(users, p.userId);
                return (
                  <Box
                    key={p.id}
                    onClick={() => {
                      onClick(p.id);
                      setFocusedPostId(p.id);
                      setOpenPanel("fullpost");
                    }}
                    style={{
                      display: "flex",
                      gap: 7,
                      marginBottom: 10,
                      alignItems: "flex-start",
                      cursor: "pointer",
                      padding: "4px 6px",
                      borderRadius: 6,
                      transition: "background .15s",
                    }}
                    onMouseEnter={(e) =>
                      (e.currentTarget.style.background = "#ffffff08")
                    }
                    onMouseLeave={(e) =>
                      (e.currentTarget.style.background = "transparent")
                    }
                  >
                    <Av user={u} size={22} />
                    <Box>
                      <Box
                        style={{
                          fontSize: ".72rem",
                          fontWeight: 600,
                          color: "#94a3b8",
                        }}
                      >
                        {u.name}{" "}
                        <span
                          style={{
                            color: "#334155",
                            fontWeight: 400,
                            fontFamily: "monospace",
                          }}
                        >
                          {timeAgo(p.timestamp)}
                        </span>
                      </Box>
                      <Box
                        style={{
                          fontSize: ".75rem",
                          color: "#475569",
                          lineHeight: 1.5,
                          marginTop: 1,
                        }}
                      >
                        {(() => {
                          const firstText = p.blocks.find(
                            (b) => b.type === "text",
                          );
                          if (!firstText || firstText.type !== "text")
                            return null;
                          const plain = firstText.html.replace(/<[^>]+>/g, "");
                          return (
                            <span
                              style={{ color: "#64748b", fontSize: ".78rem" }}
                            >
                              {plain.length > 120
                                ? plain.slice(0, 120) + "…"
                                : plain}
                            </span>
                          );
                        })()}
                      </Box>
                    </Box>
                  </Box>
                );
              })}
          </Box>
        </Collapse>
      </Box>
      {focusedPost && (
        <Box
          style={{
            background: "#171b26",
            border: "1px solid #ffffff0c",
            borderRadius: 10,
            padding: "14px",
          }}
        >
          <SectionHeader
            label="FULL POST"
            isOpen={openPanel === "fullpost"}
            onClick={() => toggle("fullpost")}
          />
          <Collapse in={openPanel === "fullpost"}>
            <Box style={{ marginTop: 10 }}>
              {/* ── PINNED FULL POST — always at top when active ── */}
              <FullPostPanel
                post={focusedPost}
                onAddComment={onAddComment}
                onAddReply={onAddReply}
                onUpdateImage={onUpdateImage}
                users={users}
                tags={tags}
                onClose={onClearPost ?? (() => {})}
              />
            </Box>
          </Collapse>
        </Box>
      )}
    </Box>
  );
};
