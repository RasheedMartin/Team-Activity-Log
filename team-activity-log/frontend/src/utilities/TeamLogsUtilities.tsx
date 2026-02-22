import { createTheme } from "@mui/material";
import type {
  CommentType,
  UserData,
  PartialComment,
} from "../interfaces/TeamActivityLogInterfaces";

// ─── MUI THEME ────────────────────────────────────────────────────────────────
export const theme = createTheme({
  palette: {
    mode: "dark",
    primary: { main: "#1976d2" }, // MUI blue
    secondary: { main: "#9c27b0" },
    error: { main: "#d32f2f" }, // MUI red
    warning: { main: "#ed6c02" },
    info: { main: "#0288d1" },
    success: { main: "#2e7d32" }, // MUI green
    background: { default: "#0b0f18", paper: "#1a1f2e" },
    text: { primary: "#e2e8f0", secondary: "#90a4ae" },
    grey: {
      50: "#fafafa",
      100: "#f5f5f5",
      200: "#eeeeee",
      300: "#e0e0e0",
      400: "#bdbdbd",
      500: "#9e9e9e",
      600: "#757575",
      700: "#616161",
      800: "#424242",
      900: "#212121",
    },
    divider: "rgba(255,255,255,0.08)",
  },
  shape: { borderRadius: 10 },
  typography: {
    fontFamily: "'IBM Plex Sans', sans-serif",
    overline: { fontFamily: "'IBM Plex Mono', monospace", letterSpacing: 3 },
  },
  components: {
    MuiPaper: { styleOverrides: { root: { backgroundImage: "none" } } },
    MuiButton: {
      styleOverrides: { root: { textTransform: "none", fontWeight: 600 } },
    },
    MuiChip: {
      styleOverrides: {
        root: { fontFamily: "'IBM Plex Mono', monospace", fontSize: "0.7rem" },
      },
    },
  },
});

// ─── HELPERS ──────────────────────────────────────────────────────────────────
export const timeAgo = (d: string | number | Date) => {
  const newDate = new Date(d);
  const s = Math.floor((Date.now() - newDate.getTime()) / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return newDate.toLocaleDateString();
};

// ─── TINY COMPONENTS ──────────────────────────────────────────────────────────

export const countComments = (comments: CommentType[]): number => {
  if (!comments?.length) return 0;
  return comments.reduce((sum, c) => sum + 1 + countComments(c.replies), 0);
};

// ─── ADD REPLY DEEP INTO TREE ─────────────────────────────────────────────────
export const addReplyToTree = (
  comments: CommentType[],
  parentId: number,
  newReply: CommentType,
): CommentType[] => {
  return comments.map((c: CommentType) => {
    if (c.id === parentId) return { ...c, replies: [...c.replies, newReply] };
    if (c.replies?.length)
      return { ...c, replies: addReplyToTree(c.replies, parentId, newReply) };
    return c;
  });
};

export const flattenComments = (
  comments: CommentType[] = [],
): CommentType[] => {
  return comments.flatMap((c) => [c, ...flattenComments(c.replies)]);
};

export const getUser = (users: UserData[], id: number) =>
  users.find((u) => u.id === id) || users[0];

// ─── STYLE UTILS ──────────────────────────────────────────────────────────────
export const sBtn = {
  background: "#ffffff08",
  border: "1px solid #ffffff12",
  borderRadius: 6,
  color: "#94a3b8",
  padding: "5px 11px",
  cursor: "pointer",
  fontSize: ".78rem",
  fontFamily: "'IBM Plex Sans',sans-serif",
};

// Thread structure: comments have id, userId, text, time, replies[] (recursive)
export const mkComment = ({
  id,
  userId,
  text,
  parentId = null,
  postId,
  minsAgo = 0,
  replies = [],
}: PartialComment): CommentType => ({
  id,
  userId,
  postId,
  parentId,
  text,
  time: new Date(Date.now() - minsAgo * 60000),
  replies,
});

// In TeamLogsUtilities.ts
export const mergeCodeBlocks = (html: string): string => {
  // Replace </pre>\n<pre> boundaries with just a newline inside one pre
  return html.replace(/<\/pre>\s*<pre[^>]*>/g, "\n");
};
