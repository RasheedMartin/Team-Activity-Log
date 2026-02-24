import { ThemeProvider } from "@emotion/react";
import {
  CssBaseline,
  Box,
  GlobalStyles,
  useMediaQuery,
  Drawer,
  IconButton,
} from "@mui/material";
import { Menu, Add, Close, FilterList } from "@mui/icons-material";

import { useEffect, useRef, useState } from "react";
import { mkComment } from "../utilities/helpers";
import { addReplyToTree } from "../utilities/helpers";
import { LeftPanel } from "../components/LeftPanel";
import { RightPanel } from "../components/RightPanel";
import type {
  OpenPanel,
  PostRequest,
  PostType,
  TagsType,
  UserData,
} from "../interfaces/TeamActivityLogInterfaces";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "../api/client";
import { theme } from "../utilities/theme";
import { PreviewCard } from "../components/PreviewCard";

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
export const TeamActivityLog = () => {
  const [search, setSearch] = useState<string>("");
  const [filterUser, setFilterUser] = useState<number | null>(null);
  const [filterTags, setFilterTags] = useState<string[]>([]);
  const postRefs = useRef<Record<number, HTMLElement | null>>({});
  const [focusedPostId, setFocusedPostId] = useState<number | null>(null);
  const [openPanel, setOpenPanel] = useState<OpenPanel>("composer");

  // Mobile drawer state
  const [leftOpen, setLeftOpen] = useState(false);
  const [rightOpen, setRightOpen] = useState(false);

  // Breakpoints
  const isMobile = useMediaQuery("(max-width:768px)");
  const isTablet = useMediaQuery("(max-width:1424px)");

  const { data: users } = useQuery({
    queryKey: ["users"],
    queryFn: () => apiFetch<UserData[]>("/users"),
  });
  const { data: tags } = useQuery({
    queryKey: ["tags"],
    queryFn: () => apiFetch<TagsType[]>("/tags"),
  });
  const { data: posts } = useQuery({
    queryKey: ["posts"],
    queryFn: () => apiFetch<PostType[]>("/posts"),
  });

  const ME = users?.[0];
  const [newPosts, setNewPost] = useState<PostType[]>(() => posts ?? []);
  const didInit = useRef(false);

  useEffect(() => {
    if (!posts) return;
    if (!didInit.current) {
      setNewPost(posts);
      didInit.current = true;
    }
  }, [posts]);

  const handlePost = ({ title, blocks, tags }: PostRequest) => {
    if (!ME) return;
    setNewPost((p) => [
      {
        id: Date.now(),
        userId: ME.id,
        timestamp: new Date(),
        tags,
        comments: [],
        blocks,
        title,
      },
      ...(p?.length ? p : []),
    ]);
    // Close drawer on mobile after posting
    if (isMobile) setRightOpen(false);
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
    setFilterTags((prev) =>
      prev.includes(tag) ? prev.filter((x) => x !== tag) : [...prev, tag],
    );

  const filtered =
    newPosts?.filter((p) => {
      if (filterUser && p.userId !== filterUser) return false;
      if (filterTags.length > 0 && !filterTags.some((t) => p.tags.includes(t)))
        return false;
      if (search) {
        const q = search.toLowerCase();
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

  const focusPost = (postId: number) => {
    const post = newPosts?.find((p) => p.id === postId);
    if (!post) return;
    setFilterUser(post.userId);
    // Close drawers on mobile when navigating to a post
    setLeftOpen(false);
    setRightOpen(false);
    setTimeout(() => {
      postRefs.current[postId]?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }, 50);
  };
  const focusedPost = newPosts?.find((p) => p.id === focusedPostId) ?? null;

  const activeFilters = filterTags.length + (filterUser ? 1 : 0);

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
          ".ProseMirror code, .post-content code": {
            background: "rgba(255,255,255,.09)",
            padding: "1px 6px",
            borderRadius: 4,
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: ".82em",
            color: "#90caf9",
          },
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
            margin: "0 16px",
            overflowX: "auto",
          },
          ".ProseMirror pre code, .post-content pre code": {
            background: "none",
            padding: 0,
            color: "#e2e8f0",
            fontSize: ".85em",
          },
          ".ProseMirror blockquote, .post-content blockquote": {
            borderLeft: "3px solid #f59e0b",
            paddingLeft: 12,
            margin: "6px 0",
            color: "#90a4ae",
            fontStyle: "italic",
          },
          ".ProseMirror ul, .ProseMirror ol, .post-content ul, .post-content ol":
            { paddingLeft: 20, margin: "4px 0" },
          ".ProseMirror p.is-editor-empty:first-of-type::before": {
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
          height: "100vh",
          width: "100vw",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {/* ── TOP NAV ── */}
        <Box
          style={{
            flexShrink: 0,
            background: "rgba(11,15,24,.97)",
            backdropFilter: "blur(14px)",
            borderBottom: "1px solid #ffffff0a",
            padding: "10px 16px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
          }}
        >
          {/* Left: hamburger (mobile/tablet) + logo */}
          <Box style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {(isMobile || isTablet) && (
              <IconButton
                size="small"
                onClick={() => setLeftOpen(true)}
                sx={{ color: activeFilters > 0 ? "#f59e0b" : "text.secondary" }}
              >
                {activeFilters > 0 ? (
                  <FilterList fontSize="small" />
                ) : (
                  <Menu fontSize="small" />
                )}
              </IconButton>
            )}
            <Box>
              <Box
                style={{
                  fontFamily: "'IBM Plex Mono',monospace",
                  color: "#f59e0b",
                  fontWeight: 700,
                  letterSpacing: 3,
                  fontSize: ".85rem",
                }}
              >
                TEAM LOG
              </Box>
              <Box
                style={{
                  fontFamily: "monospace",
                  color: "#334155",
                  fontSize: ".58rem",
                }}
              >
                {new Date().toLocaleDateString("en-US", {
                  weekday: "long",
                  month: "long",
                  day: "numeric",
                })}
              </Box>
            </Box>
          </Box>

          {/* Right: compose button (mobile/tablet) */}
          {(isMobile || isTablet) && (
            <IconButton
              size="small"
              onClick={() => setRightOpen(true)}
              sx={{
                bgcolor: "#f59e0b",
                color: "#0b0f18",
                "&:hover": { bgcolor: "#d97706" },
                width: 32,
                height: 32,
              }}
            >
              <Add fontSize="small" />
            </IconButton>
          )}
        </Box>

        {/* ── MAIN LAYOUT ── */}
        <Box
          style={{
            flex: 1,
            overflow: "hidden",
            display: "flex",
            gap: isMobile ? 0 : 18,
            padding: isMobile ? "12px 8px" : "20px 12px",
            alignItems: "flex-start",
          }}
        >
          {/* LEFT PANEL — desktop inline, mobile/tablet drawer */}
          {!isMobile && !isTablet ? (
            <Box
              style={{
                flexShrink: 0,
                height: "100%",
                overflowY: "auto",
              }}
            >
              <LeftPanel
                filterUser={filterUser}
                setFilterUser={setFilterUser}
                filterTags={filterTags}
                toggleTag={toggleTag}
                posts={newPosts}
                users={users}
                tags={tags}
                search={search}
                setSearch={setSearch}
                setFilterTags={setFilterTags}
                isMobile={isMobile}
                isTablet={isTablet}
              />
            </Box>
          ) : (
            <Drawer
              anchor="left"
              open={leftOpen}
              onClose={() => setLeftOpen(false)}
              PaperProps={{
                sx: {
                  bgcolor: "#0b0f18",
                  width: 260,
                  p: 2,
                  borderRight: "1px solid #ffffff0c",
                },
              }}
            >
              <Box
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: 12,
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
                  FILTERS
                </Box>
                <IconButton
                  size="small"
                  onClick={() => setLeftOpen(false)}
                  sx={{ color: "text.secondary" }}
                >
                  <Close fontSize="small" />
                </IconButton>
              </Box>
              <LeftPanel
                filterUser={filterUser}
                setFilterUser={setFilterUser}
                filterTags={filterTags}
                toggleTag={toggleTag}
                posts={newPosts}
                users={users}
                tags={tags}
                search={search}
                setSearch={setSearch}
                setFilterTags={setFilterTags}
                isMobile={isMobile}
                isTablet={isTablet}
              />
            </Drawer>
          )}

          {/* CENTER FEED */}
          <Box
            component="main"
            style={{
              flex: 1,
              height: "100%",
              overflowY: "auto",
              paddingRight: isMobile ? 0 : 4,
              minWidth: 550,
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
                <PreviewCard
                  key={post.id}
                  post={post}
                  onViewPost={(p) => setFocusedPostId(p.id)}
                  users={users}
                  tags={tags}
                  isActive={focusedPostId === post.id}
                  ref={(el) => {
                    postRefs.current[post.id] = el;
                  }}
                  setOpenPanel={setOpenPanel}
                  isMobile={isMobile}
                  isTablet={isTablet}
                  setRightOpen={setRightOpen}
                />
              ))
            )}
          </Box>

          {/* RIGHT PANEL — desktop inline, mobile/tablet drawer */}
          {!isMobile && !isTablet ? (
            <Box
              style={{
                height: "100%",
                overflowY: "auto",
              }}
            >
              <RightPanel
                posts={newPosts}
                users={users}
                handlePost={handlePost}
                tags={tags}
                onClick={focusPost}
                focusedPost={focusedPost}
                onClearPost={() => setFocusedPostId(null)}
                onAddComment={handleAddComment}
                onAddReply={handleAddReply}
                onUpdateImage={handleUpdateImage}
                openPanel={openPanel}
                setOpenPanel={setOpenPanel}
                setFocusedPostId={setFocusedPostId}
                isMobile={isMobile}
                isTablet={isTablet}
              />
            </Box>
          ) : (
            <Drawer
              anchor="right"
              open={rightOpen}
              onClose={() => setRightOpen(false)}
              PaperProps={{
                sx: {
                  bgcolor: "#0b0f18",
                  width: isMobile ? "100vw" : 320,
                  borderLeft: "1px solid #ffffff0c",
                },
              }}
            >
              <Box
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "12px 16px",
                  borderBottom: "1px solid #ffffff0c",
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
                  MENU
                </Box>
                <IconButton
                  size="small"
                  onClick={() => setRightOpen(false)}
                  sx={{ color: "text.secondary" }}
                >
                  <Close fontSize="small" />
                </IconButton>
              </Box>
              <Box style={{ overflowY: "auto", flex: 1 }}>
                <RightPanel
                  posts={newPosts}
                  users={users}
                  handlePost={handlePost}
                  tags={tags}
                  onClick={focusPost}
                  focusedPost={focusedPost}
                  onClearPost={() => setFocusedPostId(null)}
                  onAddComment={handleAddComment}
                  onAddReply={handleAddReply}
                  onUpdateImage={handleUpdateImage}
                  openPanel={openPanel}
                  setOpenPanel={setOpenPanel}
                  setFocusedPostId={setFocusedPostId}
                  isMobile={isMobile}
                  isTablet={isTablet}
                />
              </Box>
            </Drawer>
          )}
        </Box>
      </Box>
    </ThemeProvider>
  );
};
