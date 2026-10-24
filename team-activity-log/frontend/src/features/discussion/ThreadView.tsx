import {
  ArrowBackRounded,
  CheckCircleRounded,
  ExpandLessRounded,
  ExpandMoreRounded,
  HelpOutlineRounded,
  LinkRounded,
  MoreHorizRounded,
  PlaceOutlined,
  ReplyRounded,
  SouthRounded,
  VisibilityOffOutlined,
} from "@mui/icons-material";
import { Alert, Box, Button, Chip, IconButton, Menu, MenuItem, Skeleton, Stack, Typography } from "@mui/material";
import { useEffect, useMemo, useState } from "react";
import type { Comment, ID, ImageView, Post, User } from "../../api/contract";
import { useAddComment, useCommentAction, useComments, useImage, usePeople } from "../../api/hooks";
import { can, useWs } from "../../app/session";
import { useNotify } from "../../components/notify";
import { RichText } from "../../components/RichText";
import { ErrorState, StatusPill, UserAvatar } from "../../components/ui";
import { timeAgo } from "../../lib/dates";
import { errorMessage } from "../../lib/format";
import { CommentEditor } from "./CommentEditor";
import { ReactionBar } from "./ReactionBar";
import { flashElement, pinNumbers } from "./threads";

const MAX_DEPTH = 4; // deeper replies collapse behind "Continue thread →" (§W3.2)
const PAGE = 30;

function CommentImage({ id }: { id: ID }) {
  const { org } = useWs();
  const { data } = useImage(org.id, id);
  if (!data) return <Skeleton variant="rounded" width={120} height={80} />;
  return (
    <Box component="a" href={data.asset.variants.find((v) => v.name === "original")?.url} target="_blank" rel="noopener noreferrer">
      <Box component="img" src={data.asset.variants.find((v) => v.name === "small")?.url ?? data.asset.variants[0]?.url} alt={data.altText ?? ""} sx={{ maxWidth: 240, maxHeight: 160, borderRadius: 0.5, border: 1, borderColor: "divider", display: "block" }} />
    </Box>
  );
}

interface Ctx {
  post: Post;
  byParent: Map<string, Comment[]>;
  people: Map<ID, User>;
  pins: Map<ID, { n: number; image?: ImageView }>;
  collapsed: Set<ID>;
  toggle: (id: ID) => void;
  setFocusRoot: (id: ID | null) => void;
  readOnly: boolean;
  canComment: boolean;
  onPinClick?: (commentId: ID) => void;
}

function CommentItem({ c, depth, ctx }: { c: Comment; depth: number; ctx: Ctx }) {
  const { org, me, role } = useWs();
  const notify = useNotify();
  const add = useAddComment(org.id, ctx.post.id, me.user.id);
  const act = useCommentAction(org.id, ctx.post.id);
  const [replying, setReplying] = useState(false);
  const [editing, setEditing] = useState(false);
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const kids = ctx.byParent.get(c.id) ?? [];
  const author = ctx.people.get(c.authorId);
  const mine = c.authorId === me.user.id;
  const isAdmin = can(role, "admin");
  const parent = c.parentId ? ctx.byParent.get("__all__")?.find((x) => x.id === c.parentId) : undefined;
  const isAccepted = parent?.acceptedAnswerId === c.id;
  const fresh = !mine && Date.now() - new Date(c.createdAt).getTime() < 15_000;
  const pin = ctx.pins.get(c.id);
  const optimistic = c.id.startsWith("optimistic-");
  const run = (p: Promise<unknown>, done?: string) => p.then(() => done && notify(done)).catch((e) => notify(errorMessage(e)));

  return (
    <Box id={`comment-${c.id}`} sx={{ position: "relative", scrollMarginTop: 80 }}>
      <Stack direction="row" spacing={1.25} sx={{ py: 1, px: 1, borderRadius: 1, bgcolor: fresh ? "action.selected" : isAccepted ? "rgba(26,127,55,0.06)" : "transparent", transition: "background-color 1.5s", opacity: optimistic ? 0.65 : 1 }}>
        <UserAvatar user={author} size={28} />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: "wrap", rowGap: 0.25 }}>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>{author?.name ?? "Someone"}</Typography>
            <Typography variant="caption" color="text.secondary" title={new Date(c.createdAt).toLocaleString()}>{optimistic ? "sending…" : timeAgo(c.createdAt)}</Typography>
            {c.editedAt && !c.deletedAt && <StatusPill status="edited" />}
            {c.isQuestion && (
              <Chip size="small" icon={c.resolved ? <CheckCircleRounded /> : <HelpOutlineRounded />} label={c.resolved ? "Resolved" : "Question"} color={c.resolved ? "success" : "default"} variant="outlined" sx={{ height: 20 }} />
            )}
            {isAccepted && <Chip size="small" icon={<CheckCircleRounded />} label="Accepted answer" color="success" variant="outlined" sx={{ height: 20 }} />}
            {pin && (
              <Chip size="small" icon={<PlaceOutlined />} label={`Pin ${pin.n}${pin.image?.figureLabel ? ` on ${pin.image.figureLabel}` : " on image"}`} onClick={() => ctx.onPinClick?.(c.id)} sx={{ height: 20 }} />
            )}
            {c.hidden && <Chip size="small" icon={<VisibilityOffOutlined />} label="Hidden by an admin" variant="outlined" sx={{ height: 20 }} />}
          </Stack>
          {c.deletedAt ? (
            <Typography variant="body2" color="text.disabled" sx={{ fontStyle: "italic", py: 0.25 }}>This comment was deleted.</Typography>
          ) : editing ? (
            <Box sx={{ mt: 0.5 }}>
              <CommentEditor
                orgId={org.id}
                postId={ctx.post.id}
                people={[...ctx.people.values()]}
                initialDoc={c.doc}
                autoFocus
                submitLabel="Save"
                onCancel={() => setEditing(false)}
                onSubmit={(d) => (run(act.mutateAsync({ id: c.id, action: "edit", doc: d.doc, version: c.version })), setEditing(false))}
              />
            </Box>
          ) : (
            <Box sx={{ opacity: c.hidden ? 0.55 : 1 }}>
              <RichText doc={c.doc} sx={{ fontSize: "0.9rem", "& p": { my: 0.25 } }} />
              {c.imageInstanceIds.length > 0 && (
                <Stack direction="row" spacing={1} sx={{ mt: 0.75, flexWrap: "wrap", rowGap: 1 }}>
                  {c.imageInstanceIds.map((id) => <CommentImage key={id} id={id} />)}
                </Stack>
              )}
            </Box>
          )}
          {!c.deletedAt && !optimistic && (
            <Stack direction="row" spacing={0.5} alignItems="center" sx={{ mt: 0.25, ml: -0.75 }}>
              {ctx.canComment && !ctx.readOnly && (
                <Button size="small" startIcon={<ReplyRounded sx={{ fontSize: 16 }} />} onClick={() => setReplying(!replying)} sx={{ color: "text.secondary", minWidth: 0, fontWeight: 500 }}>
                  Reply
                </Button>
              )}
              <ReactionBar post={ctx.post} comment={c} compact />
              {c.isQuestion && ctx.canComment && !ctx.readOnly && (
                <Button size="small" onClick={() => run(act.mutateAsync({ id: c.id, action: "resolve", resolved: !c.resolved }), c.resolved ? "Question reopened" : "Marked resolved")} sx={{ color: "text.secondary", fontWeight: 500 }}>
                  {c.resolved ? "Reopen" : "Mark resolved"}
                </Button>
              )}
              {parent?.isQuestion && !isAccepted && ctx.canComment && !ctx.readOnly && (parent.authorId === me.user.id || isAdmin) && (
                <Button size="small" onClick={() => run(act.mutateAsync({ id: parent.id, action: "resolve", resolved: true, acceptedAnswerId: c.id }), "Answer accepted")} sx={{ color: "text.secondary", fontWeight: 500 }}>
                  Accept answer
                </Button>
              )}
              <IconButton size="small" onClick={(e) => setMenu(e.currentTarget)} aria-label="Comment actions" sx={{ color: "text.disabled" }}>
                <MoreHorizRounded sx={{ fontSize: 18 }} />
              </IconButton>
              <Menu anchorEl={menu} open={!!menu} onClose={() => setMenu(null)}>
                <MenuItem onClick={() => (setMenu(null), navigator.clipboard?.writeText(`${location.origin}${location.pathname}#comment-${c.id}`).then(() => notify("Link copied")))}>
                  <LinkRounded fontSize="small" sx={{ mr: 1 }} /> Copy link
                </MenuItem>
                {mine && !ctx.readOnly && <MenuItem onClick={() => (setMenu(null), setEditing(true))}>Edit</MenuItem>}
                {mine && !ctx.readOnly && !c.parentId && (
                  <MenuItem onClick={() => (setMenu(null), run(act.mutateAsync({ id: c.id, action: "question", isQuestion: !c.isQuestion, version: c.version })))}>
                    {c.isQuestion ? "Not a question" : "Mark as question"}
                  </MenuItem>
                )}
                {isAdmin && !ctx.readOnly && <MenuItem onClick={() => (setMenu(null), run(act.mutateAsync({ id: c.id, action: "hide", hidden: !c.hidden }), c.hidden ? "Comment shown" : "Comment hidden"))}>{c.hidden ? "Unhide" : "Hide"}</MenuItem>}
                {(mine || isAdmin) && (
                  <MenuItem sx={{ color: "error.main" }} onClick={() => (setMenu(null), run(act.mutateAsync({ id: c.id, action: "delete" }), "Comment deleted"))}>
                    Delete
                  </MenuItem>
                )}
              </Menu>
            </Stack>
          )}
          {replying && (
            <Box sx={{ mt: 0.5 }}>
              <CommentEditor
                orgId={org.id}
                postId={ctx.post.id}
                people={[...ctx.people.values()]}
                autoFocus
                compact={false}
                placeholder={`Reply to ${author?.name.split(" ")[0] ?? "comment"}…`}
                submitLabel="Reply"
                onCancel={() => setReplying(false)}
                onSubmit={(d) => {
                  add.mutate({ ...d, parentId: c.id, isQuestion: false }, { onError: (e) => notify(errorMessage(e)) });
                  setReplying(false);
                }}
              />
            </Box>
          )}
        </Box>
      </Stack>
      {kids.length > 0 && (
        <Box sx={{ ml: 2.5, pl: 1.5, borderLeft: 2, borderColor: "divider" }}>
          {depth + 1 >= MAX_DEPTH ? (
            <Button size="small" onClick={() => ctx.setFocusRoot(c.id)} sx={{ my: 0.5 }}>
              Continue thread → ({countDescendants(c.id, ctx.byParent)} {countDescendants(c.id, ctx.byParent) === 1 ? "reply" : "replies"})
            </Button>
          ) : ctx.collapsed.has(c.id) ? (
            <Button size="small" startIcon={<ExpandMoreRounded />} onClick={() => ctx.toggle(c.id)} sx={{ my: 0.25, color: "text.secondary" }}>
              Show {countDescendants(c.id, ctx.byParent)} {countDescendants(c.id, ctx.byParent) === 1 ? "reply" : "replies"}
            </Button>
          ) : (
            <>
              {kids.length > 1 && (
                <Button size="small" startIcon={<ExpandLessRounded />} onClick={() => ctx.toggle(c.id)} sx={{ color: "text.disabled", fontSize: "0.72rem", minHeight: 0, py: 0 }}>
                  Collapse
                </Button>
              )}
              {kids.map((k) => <CommentItem key={k.id} c={k} depth={depth + 1} ctx={ctx} />)}
            </>
          )}
        </Box>
      )}
    </Box>
  );
}

function countDescendants(id: ID, byParent: Map<string, Comment[]>): number {
  const kids = byParent.get(id) ?? [];
  return kids.reduce((n, k) => n + 1 + countDescendants(k.id, byParent), 0);
}

/** Threaded discussion (§W3). Comments are Postgres-owned; this reads them directly, not from search. */
export function ThreadView({ post, images, focusComment, onPinClick }: { post: Post; images: ImageView[]; focusComment?: ID | null; onPinClick?: (commentId: ID) => void }) {
  const { org, me, role } = useWs();
  const q = useComments(org.id, post.id);
  const add = useAddComment(org.id, post.id, me.user.id);
  const notify = useNotify();
  const { data: peopleList = [] } = usePeople(org.id);
  const people = useMemo(() => new Map(peopleList.map((p) => [p.id, p])), [peopleList]);
  const [collapsed, setCollapsed] = useState<Set<ID>>(new Set());
  const [focusRoot, setFocusRoot] = useState<ID | null>(null);
  const [shown, setShown] = useState(PAGE);
  const comments = useMemo(() => q.data ?? [], [q.data]);
  const byParent = useMemo(() => {
    const m = new Map<string, Comment[]>();
    for (const c of comments) {
      const k = c.parentId ?? "__root__";
      m.set(k, [...(m.get(k) ?? []), c]);
    }
    m.set("__all__", comments);
    return m;
  }, [comments]);
  const pins = useMemo(() => pinNumbers(comments, images), [comments, images]);
  const roots = byParent.get("__root__") ?? [];
  const readOnly = post.visibility === "hidden" || !!post.deletedAt;
  const canComment = can(role, "member");
  const live = comments.filter((c) => !c.deletedAt).length;

  // Deep links (#comment-id) and "jump to" requests expand the path and flash the comment.
  const reveal = (id: ID) => {
    const chain: ID[] = [];
    let cur = comments.find((c) => c.id === id);
    let depth = 0;
    while (cur?.parentId) {
      chain.push(cur.parentId);
      cur = comments.find((c) => c.id === cur!.parentId);
      depth++;
    }
    setCollapsed((s) => new Set([...s].filter((x) => !chain.includes(x))));
    const rootIndex = roots.findIndex((r) => r.id === (chain[chain.length - 1] ?? id));
    if (rootIndex >= shown) setShown(rootIndex + PAGE);
    if (depth >= MAX_DEPTH) setFocusRoot(chain[MAX_DEPTH - 1] ?? null);
    setTimeout(() => flashElement(`comment-${id}`), 60);
  };
  useEffect(() => {
    const target = focusComment ?? (location.hash.startsWith("#comment-") ? location.hash.slice(9) : null);
    if (target && comments.some((c) => c.id === target)) reveal(target);
    // reveal depends on comments; run when the target or data arrives
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusComment, comments.length]);

  const latest = comments.filter((c) => !c.deletedAt).reduce<Comment | undefined>((m, c) => (!m || c.createdAt > m.createdAt ? c : m), undefined);
  const ctx: Ctx = {
    post,
    byParent,
    people,
    pins,
    collapsed,
    toggle: (id) => setCollapsed((s) => (s.has(id) ? new Set([...s].filter((x) => x !== id)) : new Set([...s, id]))),
    setFocusRoot,
    readOnly,
    canComment,
    onPinClick,
  };
  const focusNode = focusRoot ? comments.find((c) => c.id === focusRoot) : null;

  return (
    <Box component="section" aria-labelledby="discussion-title">
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1.5 }}>
        <Typography id="discussion-title" variant="h3" sx={{ flex: 1 }}>
          Discussion {live > 0 && <Typography component="span" color="text.secondary">({live})</Typography>}
        </Typography>
        {latest && live > 3 && (
          <Button size="small" startIcon={<SouthRounded />} onClick={() => reveal(latest.id)}>
            Jump to latest
          </Button>
        )}
      </Stack>

      {readOnly ? (
        <Alert severity="info" sx={{ mb: 2 }}>This post is hidden, so its discussion is read-only.</Alert>
      ) : canComment ? (
        <Box sx={{ mb: 2 }}>
          <CommentEditor
            orgId={org.id}
            postId={post.id}
            people={peopleList}
            compact
            allowQuestion
            onSubmit={(d) => add.mutate(d, { onError: (e) => notify(errorMessage(e)) })}
          />
        </Box>
      ) : (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>Viewers can react to comments but not reply.</Typography>
      )}

      {q.isPending ? (
        <Stack spacing={1}>{[0, 1, 2].map((i) => <Skeleton key={i} variant="rounded" height={56} />)}</Stack>
      ) : q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : focusNode ? (
        <Box>
          <Button size="small" startIcon={<ArrowBackRounded />} onClick={() => setFocusRoot(null)} sx={{ mb: 1 }}>
            Back to the full discussion
          </Button>
          <CommentItem c={focusNode} depth={0} ctx={ctx} />
        </Box>
      ) : roots.length === 0 ? (
        <Typography variant="body2" color="text.secondary">No comments yet.</Typography>
      ) : (
        <Stack divider={<Box sx={{ borderTop: 1, borderColor: "divider" }} />}>
          {roots.slice(0, shown).map((c) => <CommentItem key={c.id} c={c} depth={0} ctx={ctx} />)}
        </Stack>
      )}
      {roots.length > shown && !focusNode && (
        <Button fullWidth sx={{ mt: 1 }} onClick={() => setShown(shown + PAGE)}>
          Show {Math.min(PAGE, roots.length - shown)} more of {roots.length - shown} threads
        </Button>
      )}
    </Box>
  );
}
