import {
  AddRounded,
  ArrowBackRounded,
  ArrowDownwardRounded,
  ArrowUpwardRounded,
  ChevronLeftRounded,
  ChevronRightRounded,
  CloseRounded,
  DeleteOutlineRounded,
  EditNoteRounded,
  FileDownloadOutlined,
  EditOutlined,
  LinkRounded,
  LockOutlined,
  PersonAddAltRounded,
  SellOutlined,
  UploadFileOutlined,
  MoreHorizRounded,
  PrintOutlined,
  SlideshowRounded,
} from "@mui/icons-material";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControlLabel,
  IconButton,
  InputBase,
  LinearProgress,
  List,
  Menu,
  MenuItem,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  ListSubheader,
  Skeleton,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from "@mui/material";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link as RouterLink, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import type { CollectionEntry, ID, PostDetail, Tag, User } from "../../api/contract";
import { useCollection, useCollectionEntries, useCreateCollection, useCreateDraft, useDeleteCollection, useImportAction, usePeople, usePostAction, usePostDetails, useTags, useUpdateCollection } from "../../api/hooks";
import type { Origin } from "../../app/origin";
import { isTypingTarget } from "../../app/shortcuts";
import { useWs, wsPath } from "../../app/session";
import { downloadFile } from "../../api/client";
import { useNotify } from "../../components/notify";
import { RichText } from "../../components/RichText";
import { SlideCanvas } from "../../components/SlideCanvas";
import { EmptyState, TagChip, UserAvatar } from "../../components/ui";
import { formatDay, formatRange } from "../../lib/dates";
import { AnnotatedImage } from "../posts/editor/ImageBlock";
import { AddPostsDialog } from "./AddPosts";
import { FileCard } from "../../components/FileCard";
import { FavoriteButton } from "./FavoriteButton";
import { ShareDialog } from "./ShareDialog";

/** One notebook entry, rendered like a document section. */
function Entry({ detail, people, tags, origin, pageBreak }: { detail: PostDetail; people: Map<ID, User>; tags: Map<ID, Tag>; origin: Origin; pageBreak?: boolean }) {
  const { org, ws } = useWs();
  const p = detail.post;
  const imgs = new Map(detail.images.map((x) => [x.id, x]));
  return (
    <Box id={`nb-${p.id}`} data-nb-section={p.id} component="article" sx={{ scrollMarginTop: "calc(var(--nb-bar, 0px) + 16px)", "@media print": { breakBefore: pageBreak ? "page" : "auto" } }}>
      <Stack direction="row" spacing={1} alignItems="center">
        <Typography variant="overline" color="primary">{formatDay(p.workDate)}</Typography>
        {p.status === "draft" && (
          <>
            <Tooltip title="Only you can see drafts">
              <Chip size="small" color="warning" variant="outlined" icon={<LockOutlined />} label="Draft" />
            </Tooltip>
            <Button size="small" component={RouterLink} to={wsPath(org, ws, `/p/${p.id}/edit`)} state={origin} data-print-hide>Continue writing</Button>
          </>
        )}
      </Stack>
      <Typography component="h2" variant="h2" sx={{ mb: 0.75 }}>
        <Box component={RouterLink} to={wsPath(org, ws, `/p/${p.id}`)} state={origin} sx={{ color: "inherit", textDecoration: "none", "&:hover": { textDecoration: "underline" } }}>
          {p.title}
        </Box>
      </Typography>
      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1.5, flexWrap: "wrap", rowGap: 0.5 }}>
        <UserAvatar user={people.get(p.authorId)} size={20} />
        <Typography variant="body2" color="text.secondary">{people.get(p.authorId)?.name}</Typography>
        {p.tagIds.map((t) => tags.get(t)).filter((t) => !!t).map((t) => <TagChip key={t!.id} tag={t!} />)}
      </Stack>
      {p.summary && <Typography color="text.secondary" sx={{ mb: 1.5 }}>{p.summary}</Typography>}
      <Stack spacing={1.5}>
        {p.blocks.map((b) => {
          if (b.type === "text" || b.type === "table") return <RichText key={b.id} doc={b.doc} />;
          if (b.type === "slide_break") return null;
          if (b.type === "slide") return <SlideCanvas key={b.id} design={b.design} images={imgs} sx={{ breakInside: "avoid" }} />;
          if (b.type === "file") return <FileCard key={b.id} file={detail.attachments?.find((a) => a.id === b.attachmentId)} />;
          if (b.type === "chart") return null;
          const img = imgs.get(b.imageInstanceId);
          return img ? (
            <Box component="figure" key={b.id} sx={{ m: 0, breakInside: "avoid" }}>
              <AnnotatedImage image={img} maxHeight={460} />
              {(img.caption || img.figureLabel) && (
                <Typography component="figcaption" variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5 }}>
                  {img.figureLabel && <b>{img.figureLabel}. </b>}
                  {img.caption}
                </Typography>
              )}
            </Box>
          ) : null;
        })}
      </Stack>
    </Box>
  );
}

/**
 * Notebook (owner request): posts stitched into one document. It opens as a reader (one entry at
 * a time, only that entry and its neighbors loaded) so it stays fast for hundreds of entries and
 * every jump lands exactly; "Continuous" renders everything for reading straight through and printing.
 */

/** Keep one entry at the top of the screen while the ones around it load and change height, until
 *  the reader scrolls themselves. */
function useAnchor() {
  const target = useRef<string | null>(null);
  useEffect(() => {
    const stop = () => (target.current = null);
    const place = () => target.current && document.getElementById(`nb-${target.current}`)?.scrollIntoView({ block: "start" });
    const sizes = new ResizeObserver(place);
    sizes.observe(document.body);
    const opts = { passive: true } as const;
    ["wheel", "touchmove", "keydown", "mousedown"].forEach((ev) => window.addEventListener(ev, stop, opts));
    return () => (sizes.disconnect(), ["wheel", "touchmove", "keydown", "mousedown"].forEach((ev) => window.removeEventListener(ev, stop)));
  }, []);
  return {
    hold: (id: string) => {
      target.current = id;
      requestAnimationFrame(() => document.getElementById(`nb-${id}`)?.scrollIntoView({ block: "start" }));
    },
  };
}

/** One entry of the continuous view: a placeholder until it's within a couple of screens. */
function LazyEntry({ id, orgId, ...rest }: { id: ID; orgId: ID; people: Map<ID, User>; tags: Map<ID, Tag>; origin: Origin; pageBreak?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || near) return;
    const io = new IntersectionObserver(([e]) => e.isIntersecting && setNear(true), { rootMargin: "1500px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [near]);
  const [q] = usePostDetails(orgId, near ? [id] : []);
  if (q?.data) return <Entry detail={q.data} {...rest} />;
  return (
    <Box ref={ref} id={`nb-${id}`} data-nb-section={id} data-nb-loading sx={{ scrollMarginTop: "calc(var(--nb-bar, 0px) + 16px)" }}>
      <Skeleton variant="rounded" height={320} />
    </Box>
  );
}

export default function NotebookPage() {
  const { id = "" } = useParams();
  const { org, ws, me } = useWs();
  const navigate = useNavigate();
  const location = useLocation();
  const notify = useNotify();
  const [params, setParams] = useSearchParams();
  const { data: nb, isPending } = useCollection(org.id, ws.id, id);
  const { data: entries = [] } = useCollectionEntries(org.id, ws.id, nb?.id);
  const update = useUpdateCollection(org.id, ws.id);
  const [adding, setAdding] = useState(false);
  const remove = useDeleteCollection(org.id, ws.id);
  const recreate = useCreateCollection(org.id, ws.id);
  const createPage = useCreateDraft(org.id, ws.id);
  const postAction = usePostAction(org.id);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteMine, setDeleteMine] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [followAnchor, setFollowAnchor] = useState<HTMLElement | null>(null);
  const [more, setMore] = useState<HTMLElement | null>(null);
  const publishImport = useImportAction(org.id, nb?.source?.importJobId ?? "");
  // Roles (owner request): everyone views; editors write and arrange; owners also share and delete.
  const canEdit = nb?.myRole !== "viewer";
  const isOwner = nb?.myRole === "owner" || nb?.myRole === undefined;
  const { data: peopleList = [] } = usePeople(org.id);
  const { data: tagData } = useTags(org.id);
  const people = useMemo(() => new Map(peopleList.map((p) => [p.id, p])), [peopleList]);
  const tags = useMemo(() => new Map((tagData?.tags ?? []).map((t) => [t.id, t])), [tagData]);
  const followed = nb?.followsTag && nb.sourceTagId ? tags.get(nb.sourceTagId) : undefined;
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  useEffect(() => setName(nb?.name ?? ""), [nb?.name]);

  const continuous = params.get("view") === "continuous";
  const printing = params.get("print") === "1";
  const index = Math.max(0, entries.findIndex((e) => e.id === params.get("entry")));
  const current = entries[index];
  // Reader loads the current entry plus neighbors (instant prev/next). Continuous loads each entry
  // as it nears the screen (LazyEntry), so a long notebook doesn't fetch everything up front;
  // only printing loads them all.
  const ids = continuous ? (printing ? entries.map((e) => e.id) : []) : [entries[index - 1], current, entries[index + 1]].filter((e): e is CollectionEntry => !!e).map((e) => e.id);
  const details = usePostDetails(org.id, ids);
  const byId = new Map(details.filter((d) => d.data).map((d) => [d.data!.post.id, d.data!]));
  const loadedAll = continuous && printing && ids.every((x) => byId.has(x));
  const anchor = useAnchor();
  const bar = useRef<HTMLDivElement>(null);
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    const el = bar.current;
    if (!el) return;
    const sizes = new ResizeObserver(() => document.documentElement.style.setProperty("--nb-bar", `${el.offsetHeight}px`));
    sizes.observe(el);
    const onScroll = () => setStuck(el.getBoundingClientRect().top <= 1 && window.scrollY > 0);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      sizes.disconnect();
      window.removeEventListener("scroll", onScroll);
      document.documentElement.style.removeProperty("--nb-bar");
    };
  }, [nb?.id]);
  const origin: Origin = { from: location.pathname + location.search, label: nb?.name ?? "notebook" };

  const setParam = (patch: Record<string, string | null>, replace = false) => {
    const next = new URLSearchParams(params);
    Object.entries(patch).forEach(([k, v]) => (v === null ? next.delete(k) : next.set(k, v)));
    setParams(next, { replace });
  };
  const open = (entryId: string) => {
    if (continuous) {
      anchor.hold(entryId); // entries around it load as it comes into view; stay on it meanwhile
      setParam({ entry: entryId }, true);
    } else {
      if (entryId === current?.id) return; // already showing it: a repeat (or double) click shouldn't jump to the top
      setParam({ entry: entryId });
      window.scrollTo(0, 0);
    }
  };

  // Reader keys: ← / → move between entries.
  useEffect(() => {
    if (continuous) return;
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "ArrowRight" && entries[index + 1]) open(entries[index + 1].id);
      if (e.key === "ArrowLeft" && entries[index - 1]) open(entries[index - 1].id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // Print / PDF uses the continuous view; print once every entry has loaded, then drop the flag.
  useEffect(() => {
    if (!printing || !loadedAll) return;
    const t = setTimeout(() => {
      window.print();
      setParam({ print: null }, true);
    }, 300);
    return () => clearTimeout(t);
    // setParam is recreated each render; this should only fire on the transition to "ready"
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [printing, loadedAll]);

  // Continuous: show the current entry (also when returning from a post).
  useEffect(() => {
    const entry = params.get("entry");
    if (continuous && entry) anchor.hold(entry);
    // on entering continuous view only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [continuous]);

  if (isPending) return <Skeleton variant="rounded" height={300} sx={{ m: 3 }} />;
  if (!nb) return <EmptyState title="Notebook not found" body="It may have been deleted." action={<Button component={RouterLink} to={wsPath(org, ws)}>Back to Home</Button>} />;

  const move = (entryId: string, d: -1 | 1) => {
    const order = [...nb.postIds];
    const i = order.indexOf(entryId);
    if (i < 0 || !order[i + d]) return;
    [order[i], order[i + d]] = [order[i + d], order[i]];
    update.mutate({ id: nb.id, postIds: order }, { onError: (e) => notify(`Couldn't reorder: ${e.message}`) });
  };
  const mine = entries.filter((e) => e.authorId === me.user.id).length;
  const myDrafts = entries.filter((e) => e.authorId === me.user.id && e.status === "draft").length;
  // "Write a page": a new draft that's already this notebook's last page; back returns here.
  const writePage = () =>
    createPage.mutate({ collectionId: nb.id }, {
      onSuccess: (d) => navigate(wsPath(org, ws, `/p/${d.post.id}/edit`), { state: { from: `${location.pathname}?${continuous ? "view=continuous&" : ""}entry=${d.post.id}`, label: nb.name } satisfies Origin }),
      onError: (e) => notify(e.message),
    });
  const deleteNotebook = () => {
    const snapshot = { name: nb.name, postIds: nb.postIds, kind: nb.kind, sourceTagId: nb.sourceTagId };
    remove.mutate({ id: nb.id, deleteMyPosts: deleteMine }, {
      onSuccess: (r) => {
        setConfirmDelete(false);
        navigate(wsPath(org, ws, "/notebooks"));
        const pages = r.deletedPostIds.length;
        // Undo runs after this page has unmounted, where per-call mutate callbacks are dropped: use promises.
        notify(`Deleted notebook “${snapshot.name}”${pages ? ` and ${pages} of your pages` : ""}`, () =>
          void Promise.all(r.deletedPostIds.map((x) => postAction.mutateAsync({ id: x, action: "restore" })))
            .then(() => recreate.mutateAsync(snapshot))
            .then((c) => navigate(wsPath(org, ws, `/notebooks/${c.id}`)), (e) => notify(`Couldn't undo: ${e.message}`)),
        );
      },
      onError: (e) => notify(e.message),
    });
  };
  const range = entries.length ? { from: entries.reduce((m, e) => (e.workDate < m ? e.workDate : m), entries[0].workDate), to: entries.reduce((m, e) => (e.workDate > m ? e.workDate : m), entries[0].workDate) } : undefined;
  const byYear = new Map<string, CollectionEntry[]>();
  entries.forEach((e) => byYear.set(e.workDate.slice(0, 4), [...(byYear.get(e.workDate.slice(0, 4)) ?? []), e]));
  const currentDetail = current ? byId.get(current.id) : undefined;
  const pager = (
    <Stack direction="row" alignItems="center" spacing={1} data-print-hide>
      <Button startIcon={<ChevronLeftRounded />} disabled={index === 0} onClick={() => open(entries[index - 1].id)}>
        Previous
      </Button>
      <Typography variant="body2" color="text.secondary" sx={{ flex: 1, textAlign: "center", fontVariantNumeric: "tabular-nums" }} aria-live="polite">
        Entry {index + 1} of {entries.length}
      </Typography>
      <Button endIcon={<ChevronRightRounded />} disabled={index >= entries.length - 1} onClick={() => open(entries[index + 1].id)}>
        Next
      </Button>
    </Stack>
  );

  return (
    // No contents column until there's a page to list (owner request).
    <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", lg: entries.length ? "280px minmax(0, 1fr)" : "1fr" }, width: "100%", "@media print": { display: "block" } }}>
      <Box component="nav" aria-label="Contents" data-print-hide sx={{ display: { xs: "none", lg: entries.length ? "block" : "none" }, borderRight: 1, borderColor: "divider", position: "sticky", top: 0, alignSelf: "start", maxHeight: "100dvh", overflow: "auto", py: 2 }}>
        <Typography variant="overline" color="text.secondary" sx={{ px: 2 }}>Contents</Typography>
        {[...byYear.entries()].map(([year, list]) => (
          <List key={year} dense disablePadding subheader={<ListSubheader sx={{ lineHeight: "26px", bgcolor: "background.default" }}>{year}</ListSubheader>}>
            {list.map((e) => (
              // Edit controls are siblings of the row button (secondaryAction), never nested in it.
              <ListItem
                key={e.id}
                disablePadding
                secondaryAction={
                  editing && (
                    <Stack direction="row">
                      <IconButton size="small" onClick={() => move(e.id, -1)} aria-label={`Move ${e.title} up`}><ArrowUpwardRounded sx={{ fontSize: 16 }} /></IconButton>
                      <IconButton size="small" onClick={() => move(e.id, 1)} aria-label={`Move ${e.title} down`}><ArrowDownwardRounded sx={{ fontSize: 16 }} /></IconButton>
                      <IconButton size="small" onClick={() => {
                          const before = nb.postIds;
                          update.mutate({ id: nb.id, postIds: before.filter((x) => x !== e.id) }, { onSuccess: () => notify(`Removed “${e.title || "Untitled"}”`, () => update.mutate({ id: nb.id, postIds: before })), onError: (err) => notify(`Couldn't remove: ${err.message}`) });
                        }} aria-label={`Remove ${e.title}`}><CloseRounded sx={{ fontSize: 16 }} /></IconButton>
                    </Stack>
                  )
                }
                sx={{ "& .MuiListItemSecondaryAction-root": { right: 4 } }}
              >
                <ListItemButton selected={current?.id === e.id} onClick={() => open(e.id)} sx={{ py: 0.25, pr: editing ? "92px !important" : 2 }}>
                  <ListItemText primary={e.title || "Untitled"} secondary={e.status === "draft" ? <Box component="span" title="Only you can see drafts" sx={{ display: "inline-flex", alignItems: "center", gap: 0.5 }}><LockOutlined sx={{ fontSize: 12 }} />Draft</Box> : formatDay(e.workDate, false)} slotProps={{ primary: { noWrap: true, fontSize: "0.82rem" }, secondary: { fontSize: "0.7rem" } }} />
                </ListItemButton>
              </ListItem>
            ))}
          </List>
        ))}
      </Box>

      <Box sx={{ maxWidth: 860, width: "100%", mx: "auto", px: { xs: 1.5, sm: 4 }, py: 3 }}>
        {/* Sticky (owner request): the controls stay in reach while scrolling a long notebook.
            Its height feeds --nb-bar so jumps land just below it. */}
        <Stack
          ref={bar}
          direction="row"
          spacing={1}
          alignItems="center"
          data-print-hide
          sx={{ mb: 0.5, flexWrap: "wrap", rowGap: 1, position: "sticky", top: "env(safe-area-inset-top, 0px)", zIndex: 5, bgcolor: "background.default", mx: { xs: -1.5, sm: -4 }, px: { xs: 1.5, sm: 4 }, py: 1, borderBottom: 1, borderColor: stuck ? "divider" : "transparent", transition: "border-color 150ms" }}
        >
          {/* Back to the section (owner request: no trip to the sidebar). */}
          <Button size="small" color="inherit" startIcon={<ArrowBackRounded />} component={RouterLink} to={wsPath(org, ws, "/notebooks")} sx={{ color: "text.secondary" }}>
            Notebooks
          </Button>
          {stuck && <Typography variant="body2" sx={{ fontWeight: 600, maxWidth: { xs: 140, sm: 260 } }} noWrap>{nb.name}</Typography>}
          <FavoriteButton kind="notebook" id={nb.id} name={nb.name} size="small" />
          {nb.visibility === "people" && (
            <Tooltip title="Shared with specific people only; hidden from the rest of the workspace">
              <LockOutlined sx={{ fontSize: 16, color: "text.secondary" }} aria-label="Shared with specific people" />
            </Tooltip>
          )}
          <Box sx={{ flex: 1 }} />
          {/* Minimal (owner request): the three things you do most; everything else under ⋯. */}
          <ToggleButtonGroup size="small" exclusive value={continuous ? "continuous" : "reader"} onChange={(_, v) => v && setParam({ view: v === "continuous" ? "continuous" : null })} aria-label="Notebook layout" sx={{ "& .MuiToggleButton-root": { textTransform: "none", py: 0.25 } }}>
            <ToggleButton value="reader">One entry</ToggleButton>
            <ToggleButton value="continuous">Continuous</ToggleButton>
          </ToggleButtonGroup>
          {editing ? (
            <Button size="small" variant="contained" onClick={() => setEditing(false)}>Done reordering</Button>
          ) : (
            canEdit && <Button size="small" variant="contained" startIcon={<EditNoteRounded />} disabled={createPage.isPending} onClick={writePage}>Write a page</Button>
          )}
          <Button size="small" startIcon={<SlideshowRounded />} onClick={() => navigate(`${wsPath(org, ws, "/present")}?collection=${nb.id}`)} disabled={!entries.length}>Present</Button>
          <IconButton size="small" aria-label="Notebook actions" aria-haspopup="menu" onClick={(e) => setMore(e.currentTarget)}>
            <MoreHorizRounded fontSize="small" />
          </IconButton>
          <Menu anchorEl={more} open={!!more} onClose={() => setMore(null)}>
            {canEdit && <MenuItem onClick={() => (setMore(null), setAdding(true))}><ListItemIcon><AddRounded fontSize="small" /></ListItemIcon>Add posts</MenuItem>}
            {canEdit && <MenuItem onClick={() => (setMore(null), setEditing(true))}><ListItemIcon><EditOutlined fontSize="small" /></ListItemIcon>Reorder or remove</MenuItem>}
            {canEdit && !followed && <MenuItem onClick={(e) => (setFollowAnchor(e.currentTarget), setMore(null))}><ListItemIcon><SellOutlined fontSize="small" /></ListItemIcon>Follow a tag…</MenuItem>}
            {canEdit && followed && <MenuItem onClick={() => (setMore(null), update.mutate({ id: nb.id, followTagId: null }, { onSuccess: () => notify(`Unfollowed ${followed.name}; the notebook is manual now`) }))}><ListItemIcon><SellOutlined fontSize="small" /></ListItemIcon>Unfollow {followed.name}</MenuItem>}
            {isOwner && <MenuItem onClick={() => (setMore(null), setSharing(true))}><ListItemIcon><PersonAddAltRounded fontSize="small" /></ListItemIcon>Share…</MenuItem>}
            <MenuItem onClick={() => (setMore(null), void navigator.clipboard.writeText(`${window.location.origin}${location.pathname}`).then(() => notify("Link copied. Anyone who can see this notebook can open it."), () => notify("Couldn't copy the link")))}><ListItemIcon><LinkRounded fontSize="small" /></ListItemIcon>Copy link</MenuItem>
            <MenuItem disabled={!entries.length} onClick={() => (setMore(null), setParam({ view: "continuous", print: "1" }))}><ListItemIcon><PrintOutlined fontSize="small" /></ListItemIcon>Print / PDF</MenuItem>
            {canEdit && (
              <MenuItem component={RouterLink} to={`${wsPath(org, ws, "/import")}?for=document&into=${nb.id}`} onClick={() => setMore(null)}>
                <ListItemIcon><UploadFileOutlined fontSize="small" /></ListItemIcon>Import a document into this notebook
              </MenuItem>
            )}
            {(nb.sources ?? []).filter((x) => x.originalKept).map((src) => (
              <MenuItem key={src.importJobId} onClick={() => (setMore(null), void downloadFile(`/orgs/${org.id}/imports/${src.importJobId}/original`, src.fileName).catch((e) => notify(e.message)))}>
                <ListItemIcon><FileDownloadOutlined fontSize="small" /></ListItemIcon>Download original ({src.fileName})
              </MenuItem>
            ))}
            {isOwner && <Divider />}
            {isOwner && <MenuItem sx={{ color: "error.main" }} onClick={() => (setMore(null), setDeleteMine(false), setConfirmDelete(true))}><ListItemIcon><DeleteOutlineRounded fontSize="small" color="error" /></ListItemIcon>Delete notebook…</MenuItem>}
          </Menu>
          <Menu anchorEl={followAnchor} open={!!followAnchor} onClose={() => setFollowAnchor(null)} slotProps={{ paper: { sx: { maxHeight: 360 } } }}>
            <MenuItem disabled sx={{ opacity: "1 !important" }}><Typography variant="caption" color="text.secondary">New published posts with the tag are added to the end.</Typography></MenuItem>
            {[...tags.values()].sort((x, y) => x.name.localeCompare(y.name)).map((t) => (
              <MenuItem key={t.id} onClick={() => (setFollowAnchor(null), update.mutate({ id: nb.id, followTagId: t.id }, { onSuccess: () => notify(`Following ${t.name}: its published posts are in, and new ones will be added`), onError: (e) => notify(e.message) }))}>
                {t.name}
              </MenuItem>
            ))}
          </Menu>
          {canEdit && <AddPostsDialog open={adding} onClose={() => setAdding(false)} collectionId={nb.id} name={nb.name} postIds={nb.postIds} />}
          {sharing && <ShareDialog c={nb} open onClose={() => setSharing(false)} />}
          <Dialog open={confirmDelete} onClose={() => setConfirmDelete(false)} maxWidth="xs">
            <DialogTitle>Delete “{nb.name}”?</DialogTitle>
            <DialogContent>
              <Typography variant="body2" sx={{ mb: 1.5 }}>The notebook goes away. Pages other people wrote are never deleted; they stay where they are.</Typography>
              {mine > 0 && (
                <FormControlLabel
                  control={<Checkbox checked={deleteMine} onChange={(e) => setDeleteMine(e.target.checked)} />}
                  label={`Also delete the ${mine === 1 ? "page" : `${mine} pages`} I wrote in it`}
                />
              )}
            </DialogContent>
            <DialogActions>
              <Button onClick={() => setConfirmDelete(false)}>Cancel</Button>
              <Button color="error" variant="contained" disabled={remove.isPending} onClick={deleteNotebook}>Delete</Button>
            </DialogActions>
          </Dialog>
        </Stack>
        <InputBase
          fullWidth
          value={name}
          readOnly={!canEdit}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => name.trim() && name !== nb.name && update.mutate({ id: nb.id, name: name.trim() }, { onError: (e) => (setName(nb.name), notify(e.message)) })}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          inputProps={{ "aria-label": "Notebook title" }}
          sx={{ fontSize: "2rem", fontWeight: 700, letterSpacing: "-0.02em" }}
        />
        {nb.source && myDrafts > 0 && (
          <Alert
            severity="info"
            sx={{ mb: 2 }}
            action={<Button size="small" variant="contained" disabled={publishImport.isPending} onClick={() => publishImport.mutate({ action: "publishAll" }, { onSuccess: () => notify(`Published ${myDrafts} page${myDrafts === 1 ? "" : "s"}`), onError: (e) => notify(e.message) })}>Publish all</Button>}
          >
            {myDrafts} page{myDrafts === 1 ? "" : "s"} from “{nb.source.fileName}” {myDrafts === 1 ? "is a draft" : "are drafts"}: only you can see {myDrafts === 1 ? "it" : "them"} until published.
          </Alert>
        )}
        <Typography color="text.secondary" sx={{ mb: 3 }}>
          {entries.length} {entries.length === 1 ? "entry" : "entries"}
          {range && ` · ${formatRange(range.from, range.to)}`}
          {followed && (
            <Tooltip title="New published posts with this tag are added automatically">
              <Box component="span" sx={{ display: "inline-flex", alignItems: "center", gap: 0.5, ml: 0.5, verticalAlign: "middle" }}>
                · Following <TagChip tag={followed} />
              </Box>
            </Tooltip>
          )}
          {nb.visibility === "people" && " · shared with specific people"}
          {!canEdit && " · view only"}
        </Typography>

        {!entries.length ? (
          <EmptyState
            title="This notebook is empty"
            body={canEdit ? "Write its first page, or add posts that already exist (yours or anyone's in this workspace)." : "Nothing published in it yet."}
            action={
              canEdit && <Stack direction="row" spacing={1} justifyContent="center">
                <Button variant="contained" startIcon={<EditNoteRounded />} onClick={writePage}>Write a page</Button>
                <Button startIcon={<AddRounded />} onClick={() => setAdding(true)}>Add posts</Button>
              </Stack>
            }
          />
        ) : continuous ? (
          <>
            {printing && !loadedAll && (
              <Box sx={{ mb: 2 }} data-print-hide>
                <LinearProgress variant="determinate" value={(byId.size / ids.length) * 100} />
                <Typography variant="caption" color="text.secondary">Loading {byId.size} of {ids.length} entries{printing ? " before printing" : ""}…</Typography>
              </Box>
            )}
            <Stack divider={<Divider sx={{ my: 4, "@media print": { display: "none" } }} />}>
              {entries.map((e, i) => {
                const entryOrigin = { ...origin, from: `${location.pathname}?view=continuous&entry=${e.id}` };
                return <LazyEntry key={e.id} id={e.id} orgId={org.id} people={people} tags={tags} origin={entryOrigin} pageBreak={i > 0} />;
              })}
            </Stack>
          </>
        ) : (
          <Stack spacing={3}>
            {pager}
            {currentDetail ? <Entry detail={currentDetail} people={people} tags={tags} origin={origin} /> : <Skeleton variant="rounded" height={320} />}
            <Divider />
            {pager}
          </Stack>
        )}
      </Box>
    </Box>
  );
}
