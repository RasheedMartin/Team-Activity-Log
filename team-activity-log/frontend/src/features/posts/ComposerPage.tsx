import {
  AddPhotoAlternateOutlined,
  ArrowBackRounded,
  ArrowDownwardRounded,
  ArrowUpwardRounded,
  CheckCircleRounded,
  CloseRounded,
  DashboardCustomizeOutlined,
  DeleteOutlineRounded,
  NotesRounded,
  RadioButtonUncheckedRounded,
  TableChartOutlined,
  ViewCarouselOutlined,
  WarningAmberRounded,
} from "@mui/icons-material";
import { Alert, Box, Button, Divider, IconButton, InputBase, LinearProgress, Menu, MenuItem, Paper, Skeleton, Stack, TextField, Tooltip, Typography } from "@mui/material";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useBlocker, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import type { Origin } from "../../app/origin";
import { ApiError } from "../../api/client";
import type { Block, ImageView, Post, PostDetail, Shape } from "../../api/contract";
import { createImageInstance, patchImageInCaches, qk, uploadImage, useCreateDraft, useImportJob, usePost, usePostAction, useSaveAnnotation, useUpdateImage, useUpdatePost } from "../../api/hooks";
import { can, useWs, wsPath } from "../../app/session";
import { useNotify } from "../../components/notify";
import { PeoplePicker, TagPicker } from "../../components/Pickers";
import { ErrorState, Kbd, StatusPill } from "../../components/ui";
import { timeAgo, todayISO } from "../../lib/dates";
import { blockImageIds, hasContent as blocksHaveContent } from "../../lib/blocks";
import { errorMessage } from "../../lib/format";
import { uuidv7 } from "../../lib/ids";
import { hasTable, isDocEmpty } from "../../lib/prosemirror";
import { designToBlocks, LAYOUTS, newDesign, sectionToDesign, type SlideLayout } from "../../lib/slideLayouts";
import { Annotator } from "./Annotator";
import { ImageBlock, UploadingBlock, type UploadState } from "./editor/ImageBlock";
import { emptyTable } from "./editor/emptyTable";
import { SlideEditor } from "./editor/SlideEditor";
import { TextBlockEditor } from "./editor/TextBlockEditor";
import { ImportTrail } from "../import/ImportTrail";
import { deckHref } from "../collections/libraryLinks";
import { ImageMetadataDrawer } from "./ImageMetadataDrawer";

type LocalBlock = Block | { id: string; type: "uploading" };
interface Fields {
  title: string;
  summary: string;
  workDate: string;
  tagIds: string[];
  coAuthorIds: string[];
  blocks: LocalBlock[];
}
const emptyText = (): Block => ({ id: uuidv7(), type: "text", doc: { type: "doc", content: [{ type: "paragraph" }] } });
const toFields = (p: Post): Fields => ({ title: p.title, summary: p.summary ?? "", workDate: p.workDate, tagIds: p.tagIds, coAuthorIds: p.coAuthorIds, blocks: p.blocks.length ? p.blocks : [emptyText()] });
const persistable = (f: Fields) => ({
  title: f.title,
  summary: f.summary.trim() || undefined,
  workDate: f.workDate,
  tagIds: f.tagIds,
  coAuthorIds: f.coAuthorIds,
  blocks: f.blocks.filter((b): b is Block => b.type !== "uploading"),
});

/** `/new` creates a draft immediately (it has an ID; nothing is ever unsaved — §W2.1), then edits it. */
export default function ComposerPage() {
  const { postId } = useParams();
  const { org, ws, role } = useWs();
  const create = useCreateDraft(org.id, ws.id);
  const navigate = useNavigate();
  const started = useRef(false);
  useEffect(() => {
    if (postId || started.current || !can(role, "member")) return;
    started.current = true;
    create.mutate(undefined, { onSuccess: (d) => navigate(wsPath(org, ws, `/p/${d.post.id}/edit`), { replace: true }) });
  }, [postId, create, navigate, org, ws, role]);
  if (!can(role, "member")) return <ErrorState error={new Error("Viewers can't write posts.")} />;
  if (!postId) return create.error ? <ErrorState error={create.error} onRetry={() => (started.current = false, create.reset())} /> : <ComposerSkeleton />;
  return <Composer key={postId} postId={postId} />;
}

function ComposerSkeleton() {
  return (
    <Box sx={{ maxWidth: 820, mx: "auto", p: 3, width: "100%" }}>
      <Skeleton variant="text" height={48} width="60%" />
      <Skeleton variant="text" width="40%" />
      <Skeleton variant="rounded" height={200} sx={{ mt: 2 }} />
    </Box>
  );
}

function Composer({ postId }: { postId: string }) {
  const { org, ws, me } = useWs();
  const q = usePost(org.id, postId);
  if (q.isPending) return <ComposerSkeleton />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  return <ComposerLoaded detail={q.data} key={q.data.post.id} meId={me.user.id} orgId={org.id} wsId={ws.id} />;
}

function ComposerLoaded({ detail, orgId }: { detail: PostDetail; meId: string; orgId: string; wsId: string }) {
  const { org, ws, me } = useWs();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const notify = useNotify();
  const post = detail.post;
  const isDraft = post.status === "draft";
  /** Where Back, Publish, and Discard return: where the draft was opened from (a collection, the
   *  drafts list), else an imported draft's deck, where its slides are reviewed. */
  const origin = (useLocation().state as Origin | null)?.from;
  const importJob = useImportJob(orgId, post.source?.kind === "import" ? post.source.importJobId : undefined);
  const deck = importJob.data?.collectionId;
  const importHome = origin ?? (post.source?.kind === "import" ? (deck ? deckHref(wsPath(org, ws), deck, true) : `${wsPath(org, ws, "/import")}?job=${post.source.importJobId}`) : undefined);
  const update = useUpdatePost(orgId, post.id);
  const action = usePostAction(orgId);
  const updateImage = useUpdateImage(orgId);
  const saveAnnotation = useSaveAnnotation(orgId);

  const [f, setF] = useState<Fields>(() => toFields(post));
  const [uploads, setUploads] = useState<Record<string, UploadState>>({});
  const [extraImages, setExtraImages] = useState<Record<string, ImageView>>({});
  const [annotating, setAnnotating] = useState<string | null>(null);
  const [details, setDetails] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(isDraft ? post.updatedAt : null);
  const [problems, setProblems] = useState<string[]>([]);
  const focusedIndex = useRef<number>(0);

  // Edit bookkeeping: `edits` counts local changes; `saved` is the count the server has.
  const edits = useRef(0);
  const saved = useRef(0);
  const version = useRef(post.version);
  const [dirty, setDirty] = useState(false);
  const change = useCallback((patch: Partial<Fields> | ((cur: Fields) => Partial<Fields>)) => {
    setF((cur) => ({ ...cur, ...(typeof patch === "function" ? patch(cur) : patch) }));
    edits.current++;
    setDirty(true);
  }, []);

  const images = useMemo(() => {
    const m = new Map(detail.images.map((i) => [i.id, i]));
    Object.values(extraImages).forEach((i) => m.set(i.id, { ...i, ...(m.get(i.id) ?? {}) }));
    return m;
  }, [detail.images, extraImages]);

  // ---- save ----
  const fRef = useRef(f);
  fRef.current = f;
  const saving = useRef<Promise<boolean> | null>(null);
  const save = useCallback(async (): Promise<boolean> => {
    // Saves are strictly sequential: each one must carry the version the previous returned.
    while (saving.current) await saving.current;
    if (edits.current === saved.current) return true;
    const at = edits.current;
    const run = update
      .mutateAsync({ version: version.current, ...persistable(fRef.current) })
      .then((d) => {
        version.current = d.post.version;
        saved.current = at;
        if (edits.current === at) setDirty(false);
        setSavedAt(new Date().toISOString());
        return true;
      })
      .catch((e) => {
        if (e instanceof ApiError && e.code === "version_conflict") setConflict(true);
        else notify(`Couldn't save: ${errorMessage(e)}`);
        return false;
      })
      .finally(() => (saving.current = null));
    saving.current = run;
    return run;
  }, [update, notify]);

  // Drafts autosave a moment after typing stops (§W2.5). Published posts save on "Update".
  useEffect(() => {
    if (!isDraft || !dirty || conflict) return;
    const t = setTimeout(() => void save(), 1200);
    return () => clearTimeout(t);
  }, [f, dirty, isDraft, conflict, save]);

  // Leaving with unsaved published edits asks first; drafts flush on the way out.
  const leaving = useRef(false); // set right before an intentional navigation (Update, Cancel)
  const blocker = useBlocker(({ currentLocation, nextLocation }) => !leaving.current && !isDraft && dirty && currentLocation.pathname !== nextLocation.pathname);
  useEffect(() => {
    if (blocker.state !== "blocked") return;
    if (window.confirm("Discard your unsaved changes to this post?")) blocker.proceed();
    else blocker.reset();
  }, [blocker]);
  useEffect(() => {
    const onUnload = (e: BeforeUnloadEvent) => {
      if (dirty) {
        if (isDraft) void save();
        e.preventDefault();
      }
    };
    window.addEventListener("beforeunload", onUnload);
    return () => window.removeEventListener("beforeunload", onUnload);
  }, [dirty, isDraft, save]);
  useEffect(() => () => void (isDraft && edits.current !== saved.current && save()), [isDraft, save]);

  // ---- blocks ----
  const setBlock = (id: string, patch: Partial<Block>) => change((cur) => ({ blocks: cur.blocks.map((b) => (b.id === id ? ({ ...b, ...patch } as LocalBlock) : b)) }));
  const insertAt = (index: number, ...blocks: LocalBlock[]) => change((cur) => ({ blocks: [...cur.blocks.slice(0, index), ...blocks, ...cur.blocks.slice(index)] }));
  const removeBlock = (id: string) => {
    const index = f.blocks.findIndex((b) => b.id === id);
    const block = f.blocks[index];
    change((cur) => {
      const left = cur.blocks.filter((b) => b.id !== id);
      return { blocks: left.length ? left : [emptyText()] };
    });
    if (block && block.type !== "uploading" && !(block.type === "text" && isDocEmpty(block.doc))) notify("Block removed", () => insertAt(index, block));
  };
  const [focusBlock, setFocusBlock] = useState<string | null>(null);
  const replaceBlocks = (index: number, count: number, blocks: LocalBlock[]) => change((cur) => ({ blocks: [...cur.blocks.slice(0, index), ...blocks, ...cur.blocks.slice(index + count)] }));
  /** Blocks after a slide break, up to the next break or designed slide. */
  const sectionLength = (breakIndex: number) => {
    const next = f.blocks.findIndex((b, j) => j > breakIndex && (b.type === "slide_break" || b.type === "slide"));
    return (next < 0 ? f.blocks.length : next) - breakIndex - 1;
  };
  const designSection = (breakIndex: number) => {
    const brk = f.blocks[breakIndex] as Extract<Block, { type: "slide_break" }>;
    const n = sectionLength(breakIndex);
    const section = f.blocks.slice(breakIndex + 1, breakIndex + 1 + n).filter((b): b is Block => b.type !== "uploading");
    const { design, rest } = sectionToDesign(section, images);
    replaceBlocks(breakIndex, n + 1, [{ id: uuidv7(), type: "slide", design, ...(brk.notes ? { notes: brk.notes } : {}) }, ...rest]);
  };
  // "Customize this slide" (Present) arrives with ?design=<block ids>: those blocks become a designed
  // slide, once, and the composer scrolls to it.
  const [searchParams, setSearchParams] = useSearchParams();
  const designIds = searchParams.get("design");
  useEffect(() => {
    if (!designIds) return;
    const ids = designIds.split(",");
    const idx = ids.map((id) => f.blocks.findIndex((b) => b.id === id)).filter((i) => i >= 0).sort((a, b) => a - b);
    setSearchParams((p) => (p.delete("design"), p), { replace: true });
    if (!idx.length || idx[idx.length - 1] - idx[0] !== idx.length - 1) return; // stale or not contiguous: leave the post as it is
    const start = idx[0];
    const before = f.blocks[start - 1];
    const fullSection = before?.type === "slide_break" && sectionLength(start - 1) === idx.length;
    if (fullSection) designSection(start - 1);
    else {
      const section = f.blocks.slice(start, start + idx.length).filter((b): b is Block => b.type !== "uploading");
      const { design, rest } = sectionToDesign(section, images);
      replaceBlocks(start, idx.length, [{ id: uuidv7(), type: "slide", design }, ...rest]);
    }
    notify("Your slide is ready to lay out");
    setTimeout(() => document.querySelector("[aria-label$='designed slide editor']")?.scrollIntoView({ block: "center" }), 100);
    // Runs once per arrival; the blocks it reads are the ones loaded with the post.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [designIds]);
  const uploadForSlide = async (file: File) => {
    try {
      const asset = await uploadImage(orgId, file);
      const img = await createImageInstance(orgId, { assetId: asset.id, postId: post.id });
      setExtraImages((m) => ({ ...m, [img.id]: img }));
      return img;
    } catch (e) {
      notify(`Couldn't add the picture: ${errorMessage(e)}`);
      throw e;
    }
  };
  const move = (index: number, dir: -1 | 1) =>
    change((cur) => {
      const j = index + dir;
      if (j < 0 || j >= cur.blocks.length) return {};
      const next = [...cur.blocks];
      [next[index], next[j]] = [next[j], next[index]];
      return { blocks: next };
    });

  // ---- uploads (§W2.3: pick, drop, paste; progress; retry) ----
  const startUpload = useCallback(
    async (u: UploadState) => {
      setUploads((m) => ({ ...m, [u.id]: { ...u, progress: 0, error: undefined } }));
      try {
        const asset = await uploadImage(orgId, u.file, (p) => setUploads((m) => (m[u.id] ? { ...m, [u.id]: { ...m[u.id], progress: p } } : m)));
        const img = await createImageInstance(orgId, { assetId: asset.id, postId: post.id });
        setExtraImages((m) => ({ ...m, [img.id]: img }));
        change((cur) => ({ blocks: cur.blocks.map((b) => (b.id === u.id ? { id: u.id, type: "image", imageInstanceId: img.id } : b)) }));
        setUploads((m) => {
          const { [u.id]: done, ...rest } = m;
          if (done) URL.revokeObjectURL(done.preview);
          return rest;
        });
        // Pick up OCR/processing results when the worker finishes.
        setTimeout(() => qc.invalidateQueries({ queryKey: qk.post(orgId, post.id) }), 1600);
      } catch (e) {
        setUploads((m) => (m[u.id] ? { ...m, [u.id]: { ...m[u.id], error: errorMessage(e) } } : m));
      }
    },
    [orgId, post.id, change, qc],
  );
  const addFiles = (files: File[], at = f.blocks.length) => {
    const imgs = files.filter((x) => x.type.startsWith("image/"));
    if (!imgs.length) return;
    const ups = imgs.map((file) => ({ id: uuidv7(), file, preview: URL.createObjectURL(file), progress: 0 }));
    insertAt(at, ...ups.map((u) => ({ id: u.id, type: "uploading" as const })));
    ups.forEach((u) => void startUpload(u));
  };
  const replaceImage = async (img: ImageView, file: File) => {
    try {
      const asset = await uploadImage(orgId, file);
      const sameShape = Math.abs(asset.width / asset.height - img.asset.width / img.asset.height) < 0.01;
      if (img.annotation?.shapes.length && !sameShape) notify("The new image has a different shape, so existing annotations may not line up.");
      const next = await updateImage.mutateAsync({ id: img.id, assetId: asset.id });
      setExtraImages((m) => ({ ...m, [next.id]: next }));
    } catch (e) {
      notify(`Couldn't replace the image: ${errorMessage(e)}`);
    }
  };

  // ---- publish / update ----
  const pendingUploads = Object.keys(uploads).length;
  const failedUploads = Object.values(uploads).filter((u) => u.error).length;
  const hasContent = blocksHaveContent(f.blocks.filter((b): b is Block => b.type !== "uploading"));
  const imagesInPost = blockImageIds(f.blocks.filter((b): b is Block => b.type !== "uploading"), "content").map((id) => images.get(id)).filter((x): x is ImageView => !!x);
  const missingAlt = imagesInPost.filter((i) => !i.altText).length;
  const checklist: { ok: boolean; label: string; blocking: boolean }[] = [
    { ok: !!f.title.trim(), label: "Title", blocking: true },
    { ok: hasContent, label: "Some text or an image", blocking: true },
    { ok: pendingUploads === 0, label: failedUploads ? `${failedUploads} upload${failedUploads > 1 ? "s" : ""} failed` : pendingUploads ? "Uploads finishing" : "Uploads finished", blocking: true },
    { ok: f.tagIds.length > 0, label: "Tags help people find this later", blocking: false },
    { ok: missingAlt === 0, label: missingAlt ? `${missingAlt} image${missingAlt > 1 ? "s" : ""} without alt text` : "Alt text on images", blocking: false },
  ];
  const canPublish = checklist.every((c) => c.ok || !c.blocking);

  const publish = async () => {
    if (!canPublish) return;
    if (!(await save())) return;
    action.mutate(
      { id: post.id, action: "publish", version: version.current },
      {
        // An imported draft goes back to its import, to pick the next one.
        // (Published now, so the unsaved-changes guard would apply: we're leaving on purpose.)
        onSuccess: () => ((leaving.current = true), setDirty(false), importHome ? (navigate(importHome), notify(`Published “${f.title || "Untitled"}”`)) : navigate(wsPath(org, ws, `/p/${post.id}`))),
        onError: (e) => setProblems(e instanceof ApiError && Array.isArray((e.details as { problems?: string[] })?.problems) ? (e.details as { problems: string[] }).problems : [errorMessage(e)]),
      },
    );
  };
  const updatePublished = async () => {
    if (!canPublish) return;
    if (await save()) {
      leaving.current = true;
      setDirty(false);
      notify("Post updated");
      navigate(wsPath(org, ws, `/p/${post.id}`));
    }
  };
  const discardDraft = () =>
    action.mutate(
      { id: post.id, action: "delete" },
      { onSuccess: () => (navigate(importHome ?? wsPath(org, ws, "/activity/drafts")), notify("Draft discarded", () => action.mutate({ id: post.id, action: "restore" }))) },
    );
  const reloadLatest = () => {
    qc.invalidateQueries({ queryKey: qk.post(orgId, post.id) }).then(() => {
      const latest = qc.getQueryData<PostDetail>(qk.post(orgId, post.id));
      if (latest) {
        setF(toFields(latest.post));
        version.current = latest.post.version;
        edits.current = saved.current = 0;
        setDirty(false);
      }
      setConflict(false);
    });
  };
  const keepMine = async () => {
    await qc.invalidateQueries({ queryKey: qk.post(orgId, post.id) });
    const latest = qc.getQueryData<PostDetail>(qk.post(orgId, post.id));
    if (latest) version.current = latest.post.version;
    setConflict(false);
    void save();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key === "Enter") {
        e.preventDefault();
        if (isDraft) void publish();
        else void updatePublished();
      } else if (mod && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void save();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const status = conflict ? "Not saved" : update.isPending ? "Saving…" : dirty ? (isDraft ? "Unsaved" : "Unsaved changes") : savedAt ? `Saved ${timeAgo(savedAt)}` : "";
  const annotatingImg = annotating ? images.get(annotating) : undefined;

  return (
    <Box
      onDragOver={(e) => e.dataTransfer.types.includes("Files") && e.preventDefault()}
      onDrop={(e) => {
        if (!e.dataTransfer.files.length) return;
        e.preventDefault();
        addFiles(Array.from(e.dataTransfer.files));
      }}
      sx={{ flex: 1, display: "flex", flexDirection: "column" }}
    >
      {/* Top bar */}
      <Stack direction="row" alignItems="center" spacing={1} sx={{ px: 2, py: 1, borderBottom: 1, borderColor: "divider", bgcolor: "background.paper", position: "sticky", top: 0, zIndex: 4 }}>
        <Tooltip title="Back">
          <IconButton onClick={() => navigate(isDraft ? (importHome ?? wsPath(org, ws, "/activity/drafts")) : wsPath(org, ws, `/p/${post.id}`))} aria-label="Back">
            <ArrowBackRounded />
          </IconButton>
        </Tooltip>
        {isDraft ? <StatusPill status="draft" /> : <Typography variant="body2" color="text.secondary">Editing published post</Typography>}
        <Typography variant="caption" color="text.secondary" role="status" aria-live="polite" sx={{ flex: 1 }}>
          {status}
        </Typography>
        {isDraft && (
          <Tooltip title="Discard draft">
            <IconButton onClick={discardDraft} aria-label="Discard draft">
              <DeleteOutlineRounded />
            </IconButton>
          </Tooltip>
        )}
        {isDraft ? (
          <Button variant="contained" onClick={publish} disabled={!canPublish || action.isPending} endIcon={<Kbd>⌘↵</Kbd>}>
            Publish
          </Button>
        ) : (
          <>
            <Button onClick={() => ((leaving.current = true), setDirty(false), navigate(wsPath(org, ws, `/p/${post.id}`)))}>Cancel</Button>
            <Button variant="contained" onClick={updatePublished} disabled={!dirty || !canPublish || update.isPending}>
              Update
            </Button>
          </>
        )}
      </Stack>
      {update.isPending && <LinearProgress sx={{ height: 2 }} />}

      <Box sx={{ maxWidth: 1180, width: "100%", mx: "auto", px: { xs: 1.5, sm: 3 }, py: 3, display: "grid", gridTemplateColumns: { xs: "1fr", lg: "minmax(0, 1fr) 260px" }, gap: 3 }}>
        <Box sx={{ minWidth: 0 }}>
          {conflict && (
            <Alert
              severity="warning"
              sx={{ mb: 2 }}
              action={
                <Stack direction="row" spacing={1}>
                  <Button size="small" onClick={reloadLatest}>Load latest</Button>
                  <Button size="small" onClick={keepMine}>Keep mine</Button>
                </Stack>
              }
            >
              This post changed in another tab or by someone else. Load the latest version, or keep yours and overwrite it.
            </Alert>
          )}
          {post.source?.kind === "import" && isDraft && <ImportTrail source={post.source} postId={post.id} deckId={deck} />}
          <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 } }}>
            <InputBase
              fullWidth
              autoFocus={!f.title}
              placeholder="Title"
              value={f.title}
              onChange={(e) => change({ title: e.target.value })}
              onBlur={() => isDraft && void save()}
              inputProps={{ "aria-label": "Title", maxLength: 200 }}
              sx={{ fontSize: "1.6rem", fontWeight: 600, letterSpacing: "-0.01em" }}
            />
            <InputBase
              fullWidth
              multiline
              placeholder="One-line summary (optional): shows on cards and in search"
              value={f.summary}
              onChange={(e) => change({ summary: e.target.value })}
              inputProps={{ "aria-label": "Summary", maxLength: 300 }}
              sx={{ color: "text.secondary", mt: 0.5 }}
            />
            <Stack direction={{ xs: "column", md: "row" }} spacing={1.5} sx={{ mt: 2 }}>
              <TextField
                type="date"
                label="Work date"
                value={f.workDate}
                onChange={(e) => change({ workDate: e.target.value || todayISO() })}
                helperText="When the work happened"
                sx={{ width: { md: 170 }, flexShrink: 0 }}
                slotProps={{ inputLabel: { shrink: true } }}
              />
              <Box sx={{ flex: 2, minWidth: 0 }}>
                <TagPicker orgId={orgId} value={f.tagIds} onChange={(tagIds) => change({ tagIds })} />
              </Box>
              <Box sx={{ flex: 1.2, minWidth: 0 }}>
                <PeoplePicker orgId={orgId} value={f.coAuthorIds} onChange={(coAuthorIds) => change({ coAuthorIds })} exclude={[post.authorId]} label="Co-authors" />
              </Box>
            </Stack>
            <Divider sx={{ my: 2 }} />
            <Stack spacing={1.5}>
              {f.blocks.map((b, i) => (
                <BlockFrame key={b.id} index={i} count={f.blocks.length} onMove={(d) => move(i, d)} onRemove={b.type === "image" || b.type === "uploading" ? undefined : () => removeBlock(b.id)}>
                  {b.type === "text" || b.type === "table" ? (
                    <Box onFocusCapture={() => (focusedIndex.current = i)}>
                      <TextBlockEditor
                        label={b.type === "table" ? "Table" : `Text block ${i + 1}`}
                        doc={b.doc}
                        table={b.type === "table" || hasTable(b.doc)} // imported slides keep tables (and chart data) inside text blocks
                        autoFocus={(i === 0 && !!f.title && isDocEmpty(b.doc)) || b.id === focusBlock}
                        placeholder={i === 0 ? "What did you do, find, or decide? Paste screenshots right here." : "Keep writing…"}
                        onChange={(doc) => setBlock(b.id, { doc } as Partial<Block>)}
                        onBlur={() => isDraft && void save()}
                        onPasteImages={(files) => addFiles(files, i + 1)}
                      />
                    </Box>
                  ) : b.type === "image" ? (
                    images.get(b.imageInstanceId) ? (
                      <ImageBlock
                        image={images.get(b.imageInstanceId)!}
                        onAnnotate={() => setAnnotating(b.imageInstanceId)}
                        onDetails={() => setDetails(b.imageInstanceId)}
                        onReplace={(file) => replaceImage(images.get(b.imageInstanceId)!, file)}
                        onRemove={() => removeBlock(b.id)}
                        onCaption={(caption) => updateImage.mutate({ id: b.imageInstanceId, caption: caption.trim() || undefined }, { onSuccess: (img) => setExtraImages((m) => ({ ...m, [img.id]: img })) })}
                      />
                    ) : (
                      <Skeleton variant="rounded" height={200} />
                    )
                  ) : b.type === "uploading" ? (
                    uploads[b.id] ? (
                      <UploadingBlock u={uploads[b.id]} onRetry={() => startUpload(uploads[b.id])} onRemove={() => (setUploads(({ [b.id]: _x, ...rest }) => (void _x, rest)), removeBlock(b.id))} />
                    ) : null
                  ) : b.type === "slide" ? (
                    <Box>
                      <SlideEditor
                        design={b.design}
                        images={images}
                        label={`Slide ${i + 1}`}
                        onChange={(design) => setBlock(b.id, { design } as Partial<Block>)}
                        onUploadImage={uploadForSlide}
                        onConvertToText={() => replaceBlocks(i, 1, designToBlocks(b))}
                      />
                      <SlideNotes notes={b.notes ?? ""} onNotes={(notes) => setBlock(b.id, { notes } as Partial<Block>)} />
                    </Box>
                  ) : (
                    <SlideBreak notes={b.notes ?? ""} onNotes={(notes) => setBlock(b.id, { notes } as Partial<Block>)} onDesign={sectionLength(i) > 0 ? () => designSection(i) : undefined} />
                  )}
                </BlockFrame>
              ))}
            </Stack>
            <AddBar
              onText={() => {
                const b = emptyText();
                setFocusBlock(b.id); // typing goes into the block just added
                insertAt(f.blocks.length, b);
              }}
              onTable={() => {
                const id = uuidv7();
                setFocusBlock(id);
                insertAt(f.blocks.length, { id, type: "table", doc: emptyTable });
              }}
              onSlide={() => insertAt(f.blocks.length, { id: uuidv7(), type: "slide_break" })}
              onDesigned={(layout) => insertAt(f.blocks.length, { id: uuidv7(), type: "slide", design: newDesign(layout) })}
              onFiles={(files) => addFiles(files)}
            />
          </Paper>
          <Typography variant="caption" color="text.disabled" sx={{ display: "block", mt: 1 }}>
            Tip: paste or drop images anywhere. {isDraft ? "Drafts save automatically and only you can see them." : "Updating creates a new revision; readers see an “edited” marker."}
          </Typography>
        </Box>

        <Box>
          <Paper variant="outlined" sx={{ p: 2, position: { lg: "sticky" }, top: { lg: 80 } }}>
            <Typography variant="overline" color="text.secondary">{isDraft ? "Ready to publish?" : "Before you update"}</Typography>
            <Stack spacing={0.75} sx={{ mt: 1 }}>
              {checklist.map((c) => (
                <Stack key={c.label} direction="row" spacing={1} alignItems="center">
                  {c.ok ? <CheckCircleRounded fontSize="small" color="success" /> : c.blocking ? <RadioButtonUncheckedRounded fontSize="small" color="disabled" /> : <WarningAmberRounded fontSize="small" sx={{ color: "text.disabled" }} />}
                  <Typography variant="body2" color={c.ok ? "text.secondary" : c.blocking ? "text.primary" : "text.secondary"}>
                    {c.label}
                  </Typography>
                </Stack>
              ))}
            </Stack>
            {problems.length > 0 && <Alert severity="error" sx={{ mt: 1.5 }}>{problems.join(". ")}</Alert>}
            <Typography variant="caption" color="text.disabled" sx={{ display: "block", mt: 1.5 }}>
              Author: {me.user.name}
            </Typography>
          </Paper>
        </Box>
      </Box>

      {annotatingImg && (
        <Annotator
          key={annotatingImg.id}
          image={annotatingImg}
          open
          saving={saveAnnotation.isPending}
          onClose={() => setAnnotating(null)}
          onSave={(shapes: Shape[]) =>
            saveAnnotation.mutate(
              { id: annotatingImg.id, shapes, version: annotatingImg.annotation?.version ?? 0 },
              {
                onSuccess: (img) => {
                  setExtraImages((m) => ({ ...m, [img.id]: img }));
                  patchImageInCaches(qc, orgId, img);
                  setAnnotating(null);
                },
                onError: (e) => notify(errorMessage(e)),
              },
            )
          }
        />
      )}
      <ImageMetadataDrawer orgId={orgId} image={details ? images.get(details) ?? null : null} open={!!details} onClose={() => setDetails(null)} />
    </Box>
  );
}

function BlockFrame({ children, index, count, onMove, onRemove }: { children: ReactNode; index: number; count: number; onMove: (dir: -1 | 1) => void; onRemove?: () => void }) {
  return (
    <Box sx={{ position: "relative", "&:hover > .gutter, &:focus-within > .gutter": { opacity: 1 } }}>
      <Stack className="gutter" spacing={0.25} sx={{ position: "absolute", left: { xs: -12, sm: -40 }, top: 0, opacity: 0, transition: "opacity 120ms", display: { xs: "none", sm: "flex" } }}>
        <Tooltip title="Move up" placement="left"><span><IconButton size="small" disabled={index === 0} onClick={() => onMove(-1)} aria-label="Move block up"><ArrowUpwardRounded sx={{ fontSize: 16 }} /></IconButton></span></Tooltip>
        <Tooltip title="Move down" placement="left"><span><IconButton size="small" disabled={index === count - 1} onClick={() => onMove(1)} aria-label="Move block down"><ArrowDownwardRounded sx={{ fontSize: 16 }} /></IconButton></span></Tooltip>
        {onRemove && count > 1 && <Tooltip title="Remove block" placement="left"><IconButton size="small" onClick={onRemove} aria-label="Remove block"><CloseRounded sx={{ fontSize: 16 }} /></IconButton></Tooltip>}
      </Stack>
      {children}
    </Box>
  );
}

function SlideNotes({ notes, onNotes }: { notes: string; onNotes: (n: string) => void }) {
  const [open, setOpen] = useState(!!notes);
  return open ? (
    <TextField fullWidth multiline minRows={2} size="small" label="Presenter notes" placeholder="Notes only you see while presenting" value={notes} onChange={(e) => onNotes(e.target.value)} sx={{ mt: 1 }} />
  ) : (
    <Button size="small" startIcon={<NotesRounded />} onClick={() => setOpen(true)} sx={{ mt: 0.5 }}>Presenter notes</Button>
  );
}

function SlideBreak({ notes, onNotes, onDesign }: { notes: string; onNotes: (n: string) => void; onDesign?: () => void }) {
  const [open, setOpen] = useState(!!notes);
  return (
    <Box sx={{ borderTop: "2px dashed", borderColor: "divider", pt: 0.75 }}>
      <Stack direction="row" alignItems="center" spacing={1} useFlexGap sx={{ flexWrap: "wrap" }}>
        <ViewCarouselOutlined fontSize="small" sx={{ color: "text.disabled" }} />
        <Typography variant="caption" color="text.secondary" sx={{ flex: 1, minWidth: 180 }}>Slide break: a new slide starts here when presenting</Typography>
        {onDesign && (
          <Tooltip describeChild title="Turn the content below into a slide you can lay out">
            <Button size="small" startIcon={<DashboardCustomizeOutlined />} onClick={onDesign}>Design this slide</Button>
          </Tooltip>
        )}
        {!open && <Button size="small" startIcon={<NotesRounded />} onClick={() => setOpen(true)}>Presenter notes</Button>}
      </Stack>
      {open && <TextField fullWidth multiline minRows={2} size="small" placeholder="Notes only you see while presenting" value={notes} onChange={(e) => onNotes(e.target.value)} sx={{ mt: 1 }} />}
    </Box>
  );
}

function AddBar({ onText, onTable, onSlide, onDesigned, onFiles }: { onText: () => void; onTable: () => void; onSlide: () => void; onDesigned: (layout: SlideLayout) => void; onFiles: (files: File[]) => void }) {
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  return (
    <Stack direction="row" spacing={1} sx={{ mt: 2, pt: 1.5, borderTop: 1, borderColor: "divider", flexWrap: "wrap", rowGap: 1 }}>
      <Button size="small" startIcon={<NotesRounded />} onClick={onText}>Text</Button>
      <Button size="small" startIcon={<AddPhotoAlternateOutlined />} component="label">
        Images
        <input hidden type="file" accept="image/*" multiple onChange={(e) => (onFiles(Array.from(e.target.files ?? [])), (e.target.value = ""))} />
      </Button>
      <Button size="small" startIcon={<TableChartOutlined />} onClick={onTable}>Table</Button>
      <Button size="small" startIcon={<ViewCarouselOutlined />} onClick={onSlide}>Slide break</Button>
      <Button size="small" startIcon={<DashboardCustomizeOutlined />} onClick={(e) => setMenu(e.currentTarget)} aria-haspopup="menu">Designed slide</Button>
      <Menu anchorEl={menu} open={!!menu} onClose={() => setMenu(null)}>
        {LAYOUTS.map((l) => (
          <MenuItem key={l.id} onClick={() => (setMenu(null), onDesigned(l.id))}>
            {l.label}
          </MenuItem>
        ))}
      </Menu>
    </Stack>
  );
}
