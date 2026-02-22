import { ThemeProvider } from "@emotion/react";
import { CssBaseline, Box, GlobalStyles } from "@mui/material";

import { useEffect, useRef, useState } from "react";
import { mkComment } from "../utilities/TeamLogsUtilities";
import { addReplyToTree, theme } from "../utilities/TeamLogsUtilities";
import { LeftPanel } from "../components/LeftPanel";
import { PostCard } from "../components/PostCard";
import { RightPanel } from "../components/RightPanel";
import type {
  CommentReactType,
  PostRequest,
  PostType,
  TagsType,
  UserData,
} from "../interfaces/TeamActivityLogInterfaces";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "../api/client";

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
export const TeamActivityLog = () => {
  const [newPosts, setNewPost] = useState<PostType[]>();
  const [search, setSearch] = useState<string>("");
  const [filterUser, setFilterUser] = useState<number | null>(null);
  const [filterTags, setFilterTags] = useState<string[]>([]);
  // Per-post, per-comment reactions: { postId: { commentId: { emoji: [userId] } } }
  const [commentRx, setCommentRx] = useState<CommentReactType>({});
  const postRefs = useRef<Record<number, HTMLElement | null>>({});

  const {
    data: users,
    isPending: usersIsPending,
    error: usersError,
  } = useQuery({
    queryKey: ["users"],
    queryFn: () => apiFetch<UserData[]>("/users"),
  });
  const {
    data: tags,
    isPending: tagsPending,
    error: tagsError,
  } = useQuery({
    queryKey: ["tags"],
    queryFn: () => apiFetch<TagsType[]>("/tags"),
  });
  const {
    data: posts,
    isPending: postsPending,
    error: postsError,
  } = useQuery({
    queryKey: ["posts"],
    queryFn: () => apiFetch<PostType[]>("/posts"),
  });

  const ME = users?.[0];

  useEffect(() => {
    if (posts) {
      setNewPost(posts);
    }
  }, [posts]);

  const handlePost = ({ blocks, tags }: PostRequest) => {
    if (!ME) return;
    setNewPost((p) => [
      {
        id: Date.now(),
        userId: ME.id,
        timestamp: new Date(),
        tags,
        reactions: {},
        comments: [],
        blocks,
      },
      ...(p?.length ? p : []),
    ]);
  };

  const handleReact = (postId: number, emoji: string) => {
    if (!ME) return;
    // Change to a mutation later
    setNewPost((p) =>
      p?.map((post) => {
        if (post.id !== postId) return post;
        const curr = post.reactions[emoji] || [];
        return {
          ...post,
          reactions: {
            ...post.reactions,
            [emoji]: curr.includes(ME.id)
              ? curr.filter((i) => i !== ME.id)
              : [...curr, ME.id],
          },
        };
      }),
    );
  };

  const handleAddComment = (postId: number, text: string) => {
    if (!ME) return;
    const c = mkComment({
      id: 150,
      userId: ME.id,
      parentId: null,
      text: text,
      postId: postId,
    });
    setNewPost((p) =>
      p?.map((post) =>
        post.id !== postId
          ? post
          : { ...post, comments: [...post.comments, c] },
      ),
    );
  };

  const handleAddReply = (postId: number, parentId: number, text: string) => {
    if (!ME) return;

    const reply = mkComment({
      id: 596,
      postId: postId,
      parentId: parentId,
      userId: ME.id,
      text: text,
    });
    setNewPost((p) =>
      p?.map((post) =>
        post.id !== postId
          ? post
          : {
              ...post,
              comments: addReplyToTree(post.comments, parentId, reply),
            },
      ),
    );
  };

  const handleCommentReact = (
    postId: number,
    commentId: number,
    emoji: string,
  ) => {
    if (!ME) return;

    setCommentRx((prev) => {
      const postRx = prev[postId] || {};
      const cRx = postRx[commentId] || {};
      const curr = cRx[emoji] || [];
      return {
        ...prev,
        [postId]: {
          ...postRx,
          [commentId]: {
            ...cRx,
            [emoji]: curr.includes(ME.id)
              ? curr.filter((i: number) => i !== ME.id)
              : [...curr, ME.id],
          },
        },
      };
    });
  };
  // Update a single image in a post (after annotating from the feed)
  const handleUpdateImage = (
    postId: number,
    blockIdx: number,
    dataUrl: string,
  ) => {
    setNewPost((p) =>
      p?.map((post) =>
        post.id !== postId
          ? post
          : {
              ...post,
              blocks: post.blocks.map((block, i) =>
                i === blockIdx && block.type === "image"
                  ? { ...block, src: dataUrl }
                  : block,
              ),
            },
      ),
    );
  };

  const toggleTag = (tag: string) =>
    setFilterTags((post) =>
      post.includes(tag) ? post.filter((x) => x !== tag) : [...post, tag],
    );

  const filtered =
    newPosts?.filter((p) => {
      if (filterUser && p.userId !== filterUser) return false;
      if (filterTags.length > 0 && !filterTags.some((t) => p.tags.includes(t)))
        return false;
      if (search) {
        const q = search.toLowerCase();
        // Concatenate all text blocks to search across the whole post
        const txt = p.blocks
          .filter((b) => b.type === "text")
          .map((b) => b.html.replace(/<[^>]+>/g, ""))
          .join(" ")
          .toLowerCase();
        if (!txt.includes(q) && !p.tags.some((t) => t.includes(q)))
          return false;
      }
      return true;
    }) ?? [];

  // TeamActivityLog.tsx
  const focusPost = (postId: number) => {
    // Find the post to get its userId and tags
    const post = newPosts?.find((p) => p.id === postId);
    if (!post) return;

    setFilterUser(post.userId); // filter by author
    // optionally filter by first tag too:
    // setFilterTags(post.tags.slice(0, 1));

    setTimeout(() => {
      postRefs.current[postId]?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }, 50);
  };

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />

      <GlobalStyles
        styles={{
          ".ProseMirror, .post-content": {
            outline: "none",
            color: "#e2e8f0",
            fontFamily: "'IBM Plex Sans', sans-serif",
            fontSize: ".88rem",
            lineHeight: 1.8,
          },
          ".ProseMirror p, .post-content p": { margin: "0" },
          ".ProseMirror p:last-child, .post-content p:last-child": {
            marginBottom: 0,
          },

          // Inline code
          ".ProseMirror code, .post-content code": {
            background: "rgba(255,255,255,.09)",
            padding: "1px 6px",
            borderRadius: 4,
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: ".82em",
            color: "#90caf9",
          },

          // Code block
          ".ProseMirror pre": {
            background: "#0a0d14",
            padding: "10px 14px",
            overflowX: "auto",
            margin: "0",
          },

          ".post-content pre": {
            background: "#0a0d14",
            borderBottom: "none",
            borderRadius: 0,
            padding: "2px 14px",
            margin: "0 16px", // ← matches the text block padding
            overflowX: "auto",
          },
          ".ProseMirror pre code,  .post-content pre code": {
            background: "none",
            padding: 0,
            color: "#e2e8f0",
            fontSize: ".85em",
          },

          // Blockquote — visually distinct from code block
          ".ProseMirror blockquote, .post-content blockquote": {
            borderLeft: "3px solid #f59e0b",
            paddingLeft: 12,
            margin: "6px 0",
            color: "#90a4ae",
            fontStyle: "italic",
          },

          ".ProseMirror ul, .ProseMirror ol, .post-content ul, .post-content ol":
            {
              paddingLeft: 20,
              margin: "4px 0",
            },

          // Placeholder
          ".ProseMirror p.is-editor-empty:first-of-type::before, .post-content p.is-editor-empty:first-of-type::before":
            {
              content: "attr(data-placeholder)",
              color: "#334155",
              pointerEvents: "none",
              float: "left",
              height: 0,
              fontStyle: "italic",
            },
        }}
      />
      <Box
        style={{
          background: "#0b0f18",
          fontFamily: "'IBM Plex Sans',sans-serif",
          color: "#e2e8f0",
          boxSizing: "border-box",
          overflow: "hidden",
          flexDirection: "column",
          marginTop: 20,
        }}
      >
        {/* MAIN 3-COLUMN LAYOUT */}
        <Box
          style={{
            margin: "0",
            padding: "20px 12px",
            display: "flex",
            gap: 18,
            alignItems: "flex-start",
            height: "calc(100vh - 90px)",
            overflow: "hidden",
          }}
        >
          <Box
            style={{
              position: "sticky",
              top: 20,
              height: "calc(100vh - 130px)",
              overflowY: "auto",
              flexShrink: 0,
            }}
          >
            {" "}
            {/* LEFT PANEL */}
            <LeftPanel
              filterUser={filterUser}
              setFilterUser={setFilterUser}
              filterTags={filterTags}
              toggleTag={toggleTag}
              posts={posts}
              users={users}
              tags={tags}
              search={search}
              setSearch={setSearch}
              setFilterTags={setFilterTags}
            />
          </Box>
          <Box
            component="main"
            style={{
              flex: 1,
              minWidth: 0,
              height: "100%",
              overflowY: "auto",
              width: 800,
              paddingRight: 4,
            }}
          >
            {filtered.length === 0 ? (
              <Box
                style={{
                  textAlign: "center",
                  padding: "48px 0",
                  color: "#334155",
                  fontFamily: "monospace",
                }}
              >
                No logs match your filters.
              </Box>
            ) : (
              filtered.map((post) => (
                <PostCard
                  key={post.id}
                  post={post}
                  onReact={handleReact}
                  onAddComment={handleAddComment}
                  onAddReply={handleAddReply}
                  onUpdateImage={handleUpdateImage}
                  commentReactions={commentRx}
                  onCommentReact={handleCommentReact}
                  users={users}
                  tags={tags}
                  ref={(el) => {
                    postRefs.current[post.id] = el;
                  }}
                />
              ))
            )}
          </Box>
          {/* RIGHT PANEL — sticky */}
          <Box
            style={{
              position: "sticky",
              top: 20,
              height: "calc(100vh - 130px)",
              overflowY: "auto",
              flexShrink: 0,
            }}
          >
            <RightPanel
              posts={newPosts}
              users={users}
              handlePost={handlePost}
              tags={tags}
              onClick={focusPost}
            />
          </Box>
        </Box>
      </Box>
    </ThemeProvider>
  );
};
