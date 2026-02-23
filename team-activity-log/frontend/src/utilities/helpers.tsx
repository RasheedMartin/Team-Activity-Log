import type {
  CommentType,
  UserData,
  PartialComment,
} from "../interfaces/TeamActivityLogInterfaces";

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
