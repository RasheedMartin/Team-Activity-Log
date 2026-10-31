import { AddRounded, ArrowBackRounded, ChevronLeftRounded, ChevronRightRounded, FileDownloadOutlined, CallMergeRounded, PersonAddAltRounded, CallSplitRounded, CollectionsBookmarkOutlined, DeleteOutlineRounded, MoreVertRounded, SlideshowRounded, UploadFileOutlined, WarningAmberRounded } from "@mui/icons-material";
import { Box, Button, ButtonBase, Checkbox, Chip, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, ListItemIcon, Menu, MenuItem, Skeleton, Stack, Tab, Tabs, Tooltip, Typography } from "@mui/material";
import { useMemo, useState } from "react";
import { Link as RouterLink, useNavigate, useParams, useSearchParams } from "react-router-dom";
import type { PostDetail } from "../../api/contract";
import { useCollection, useCombineDrafts, useImportAction, useImportJob, usePostAction, usePostDetails, useSplitDraft, useUpdateCollection } from "../../api/hooks";
import { useOrigin } from "../../app/origin";
import { useWs, wsPath } from "../../app/session";
import { RichText } from "../../components/RichText";
import { SlideCanvas } from "../../components/SlideCanvas";
import { downloadFile } from "../../api/client";
import { useNotify } from "../../components/notify";
import { EmptyState, ErrorState } from "../../components/ui";
import { blockDocs } from "../../lib/blocks";
import { formatDay } from "../../lib/dates";
import { useRangeSelect } from "../../lib/useRangeSelect";
import { docText } from "../../lib/prosemirror";
import { AddPostsDialog } from "./AddPosts";
import { AddSlideButton, DeckMenu } from "./DeckBuilder";
import { FavoriteButton } from "./FavoriteButton";
import { ShareDialog } from "./ShareDialog";

/** A small picture of a post: its first designed slide, else its first picture, else its opening text. */
function Preview({ d }: { d: PostDetail }) {
  const images = useMemo(() => new Map(d.images.map((i) => [i.id, i])), [d.images]);
  const slide = d.post.blocks.find((b) => b.type === "slide");
  if (slide?.type === "slide") return <SlideCanvas design={slide.design} images={images} label={`Slide preview: ${d.post.title}`} />;
  const first = d.images[0];
  const thumb = first?.asset.variants.find((v) => v.name === "small") ?? first?.asset.variants[0];
  if (thumb) return <Box component="img" src={thumb.url} alt="" sx={{ width: "100%", aspectRatio: "16 / 9", objectFit: "cover", display: "block", borderRadius: 1, bgcolor: "action.hover" }} />;
  const text = blockDocs(d.post.blocks)[0];
  return (
    <Box sx={{ aspectRatio: "16 / 9", overflow: "hidden", borderRadius: 1, bgcolor: "action.hover", p: 1.25, fontSize: 11, maskImage: "linear-gradient(#000 70%, transparent)" }}>
      {text && docText(text).trim() ? <RichText doc={text} sx={{ fontSize: 11, "& p, & li": { my: 0.25 } }} /> : <Typography variant="caption" color="text.disabled">No text</Typography>}
    </Box>
  );
}

type Show = "all" | "review" | "published";

/**
 * A collection's own page: its posts in order as slide-like cards, with Present, Favorite, and
 * An imported deck is also where its slides are reviewed (owner
 * request): To review / Published tabs, Publish all, and deleting the import live here; the import
 * page is only for uploading.
 */
export default function CollectionPage() {
  const { id = "" } = useParams();
  const { org, ws } = useWs();
  const base = wsPath(org, ws);
  const c = useCollection(org.id, ws.id, id);
  const origin = useOrigin(c.data?.name ?? "collection"); // Back from a post or draft returns here
  const details = usePostDetails(org.id, c.data?.postIds ?? []);
  const loaded = details.filter((q) => q.data).map((q) => q.data!);
  const imported = c.data?.kind === "deck_import";
  const built = c.data?.kind === "deck"; // made here slide by slide (DeckBuilder)
  const deck = imported || built;
  const importJobId = loaded.find((d) => d.post.source?.kind === "import")?.post.source?.importJobId;
  const drafts = loaded.filter((d) => d.post.status === "draft").length;
  const status = new Map(loaded.map((d) => [d.post.id, d.post.status]));
  const [params, setParams] = useSearchParams();
  const show: Show = (["review", "published"] as const).find((x) => x === params.get("show")) ?? "all";
  const tabs = imported || drafts > 0;
  const shows = (x: string) => !tabs || show === "all" || (show === "review" ? status.get(x) === "draft" : status.get(x) === "published");
  const job = useImportJob(org.id, imported ? importJobId : undefined);
  const importAct = useImportAction(org.id, importJobId ?? "");
  const navigate = useNavigate();
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [sharing, setSharing] = useState(false);
  const canEdit = c.data?.myRole !== "viewer"; // roles: everyone views; editors change it; owners share
  const isOwner = c.data?.myRole === "owner" || c.data?.myRole === undefined;
  const combine = useCombineDrafts(org.id);
  const splitDraft = useSplitDraft(org.id);
  // Import notes per post ("Animations not preserved", …), minus ones a designed slide makes moot
  // (its chart and SmartArt are drawn, not turned into a table or list).
  const notes = new Map<string, string[]>();
  for (const it of job.data?.items ?? []) {
    if (!it.postId || !it.warnings.length) continue;
    const d = loaded.find((x) => x.post.id === it.postId);
    const designed = d?.post.blocks.some((b) => b.type === "slide");
    const left = designed ? it.warnings.filter((w) => !/imported as a (table of its data|list)$/.test(w)) : it.warnings;
    if (left.length) notes.set(it.postId, left);
  }
  const draftsWithNotes = loaded.filter((d) => d.post.status === "draft" && notes.has(d.post.id)).length;
  const action = usePostAction(org.id);
  const update = useUpdateCollection(org.id, ws.id);
  const notify = useNotify();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const ids = (c.data?.postIds ?? []).filter(shows); // what's on screen: selection and Select all work on this
  const chosen = ids.filter((x) => selected.has(x)); // posts that left the collection drop out of the selection
  const all = chosen.length === ids.length && ids.length > 0;
  const chosenDrafts = loaded.filter((d) => selected.has(d.post.id) && d.post.status === "draft").map((d) => d.post.id);
  const onlyDrafts = chosen.every((x) => chosenDrafts.includes(x));
  const toggle = useRangeSelect(ids, selected, setSelected); // Shift-click picks a range
  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

  // Bulk actions use the same post actions as everywhere else, so Activity, Search, and the
  // import page see the change at once (see invalidatePostLists).
  const run = async (list: string[], act: "publish" | "delete") => {
    setBusy(true);
    const r = await Promise.allSettled(list.map((x) => action.mutateAsync({ id: x, action: act })));
    setBusy(false);
    const ok = list.filter((_, i) => r[i].status === "fulfilled");
    setSelected(new Set(list.filter((x) => !ok.includes(x))));
    return { ok, failed: list.length - ok.length };
  };
  const publish = async () => {
    const { ok, failed } = await run(chosenDrafts, "publish");
    notify(failed ? `Published ${ok.length}. ${failed} need${failed === 1 ? "s" : ""} attention: open ${failed === 1 ? "it" : "them"} to see why.` : `Published ${plural(ok.length, "post")}`);
  };
  const discard = async () => {
    const verb = onlyDrafts ? "Discarded" : "Deleted";
    const { ok, failed } = await run(chosen, "delete");
    notify(
      `${verb} ${plural(ok.length, "post")}${failed ? `. ${failed} couldn't be deleted (only the author or an admin can)` : ""}`,
      ok.length ? () => ok.forEach((x) => action.mutate({ id: x, action: "restore" })) : undefined,
    );
  };
  // Built decks: slide order is the deck's order (Present and the .pptx follow it).
  const reorderable = built && canEdit && show === "all";
  const move = (postId: string, by: -1 | 1) => {
    const order = [...(c.data?.postIds ?? [])];
    const i = order.indexOf(postId);
    const j = i + by;
    if (i < 0 || j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j], order[i]];
    update.mutate({ id, postIds: order }, { onError: (e) => notify(e.message) });
  };
  const remove = () => {
    const before = ids;
    update.mutate({ id, postIds: ids.filter((x) => !selected.has(x)) }, { onSuccess: () => notify(`Removed ${plural(chosen.length, "post")} from this collection`, () => update.mutate({ id, postIds: before })) });
    setSelected(new Set());
  };

  if (c.error) return <ErrorState error={c.error} onRetry={() => c.refetch()} />;
  if (!c.data) return <Skeleton variant="rounded" height={240} sx={{ m: 3 }} />;
  const coll = c.data;
  return (
    <Box sx={{ maxWidth: 1200, width: "100%", mx: "auto", px: { xs: 1.5, sm: 3 }, py: 3 }}>
      <Stack direction="row" alignItems="flex-start" spacing={1} useFlexGap sx={{ flexWrap: "wrap", mb: 2 }}>
        <Box sx={{ flex: 1, minWidth: 240 }}>
          {/* Back to the section (owner request: no trip to the sidebar). */}
          <Button size="small" startIcon={<ArrowBackRounded />} component={RouterLink} to={`${base}/${deck ? "collections" : "notebooks"}`} sx={{ color: "text.secondary", ml: -0.5, mb: 0.5 }}>
            {deck ? "Decks" : "Notebooks"}
          </Button>
          {imported && <Typography variant="caption" color="text.secondary" component="div">Imported slides</Typography>}
          <Typography variant="h1" sx={{ fontSize: "1.6rem", wordBreak: "break-word" }}>{coll.name}</Typography>
          <Typography variant="body2" color="text.secondary">
            {coll.postIds.length} {built ? "slide" : "post"}{coll.postIds.length === 1 ? "" : "s"}
            {drafts > 0 && ` · ${drafts} still draft${drafts === 1 ? "" : "s"}`}
            {coll.updatedAt && ` · updated ${formatDay(coll.updatedAt.slice(0, 10))}`}
          </Typography>
          {job.data && (draftsWithNotes > 0 || (job.data.report?.skipped ?? 0) > 0) && (
            <Typography variant="body2" sx={{ color: "warning.main" }}>
              From “{job.data.sourceFilename}”:
              {job.data.report?.skipped ? ` ${plural(job.data.report.skipped, "slide")} skipped` : ""}
              {job.data.report?.skipped && draftsWithNotes ? " ·" : ""}
              {draftsWithNotes ? ` ${draftsWithNotes} of the slides to review ${draftsWithNotes === 1 ? "has" : "have"} import notes (marked ⚠)` : ""}
            </Typography>
          )}
        </Box>
        <Stack direction="row" spacing={1} useFlexGap alignItems="center" sx={{ flexWrap: "wrap" }}>
          <Button variant="contained" startIcon={<SlideshowRounded />} component={RouterLink} to={`${base}/present?collection=${coll.id}`} disabled={!coll.postIds.length}>
            Present
          </Button>
          {built && canEdit && <AddSlideButton deck={coll} origin={origin} />}
          {built && drafts > 0 && (
            <Button variant="outlined" disabled={busy} onClick={() => void run(loaded.filter((d) => d.post.status === "draft").map((d) => d.post.id), "publish").then(({ ok, failed }) => notify(failed ? `Published ${ok.length}. ${failed} need${failed === 1 ? "s" : ""} attention: open ${failed === 1 ? "it" : "them"} to see why.` : `Published ${plural(ok.length, "slide")}`))}>
              Publish all {drafts}
            </Button>
          )}
          {imported && importJobId && drafts > 0 && (
            <Button variant="outlined" disabled={importAct.isPending} onClick={() => importAct.mutate({ action: "publishAll" }, { onSuccess: () => (setParams({}, { replace: true }), notify(`Published ${plural(drafts, "slide")}`)), onError: (e) => notify(`Couldn't publish: ${e.message}`) })}>
              Publish all {drafts}
            </Button>
          )}
          {/* An imported deck holds its slides: review is publish or discard (owner request). */}
          {!imported && canEdit && (
            <Button startIcon={<AddRounded />} onClick={() => setAdding(true)}>
              Add posts
            </Button>
          )}
          <AddPostsDialog open={adding} onClose={() => setAdding(false)} collectionId={coll.id} name={coll.name} postIds={coll.postIds} />
          <FavoriteButton kind="collection" id={coll.id} name={coll.name} />
          {isOwner && !imported && (
            <>
              <Button startIcon={<PersonAddAltRounded />} onClick={() => setSharing(true)} aria-label="Share collection">Share</Button>
              {sharing && <ShareDialog c={coll} open onClose={() => setSharing(false)} />}
            </>
          )}
          {built && isOwner && <DeckMenu deck={coll} />}
          {imported && importJobId && isOwner && (
            <>
              <IconButton aria-label="More deck actions" onClick={(e) => setMenu(e.currentTarget)}><MoreVertRounded /></IconButton>
              <Menu anchorEl={menu} open={!!menu} onClose={() => setMenu(null)}>
                {(coll.sources ?? []).filter((x) => x.originalKept).map((src) => (
                  <MenuItem key={src.importJobId} onClick={() => (setMenu(null), void downloadFile(`/orgs/${org.id}/imports/${src.importJobId}/original`, src.fileName).catch((e) => notify(e.message)))}>
                    <ListItemIcon><FileDownloadOutlined fontSize="small" /></ListItemIcon>Download original ({src.fileName})
                  </MenuItem>
                ))}
                <MenuItem component={RouterLink} to={`${base}/import?for=slides&into=${coll.id}`} onClick={() => setMenu(null)}>
                  <ListItemIcon><UploadFileOutlined fontSize="small" /></ListItemIcon>Import more slides
                </MenuItem>
                <MenuItem onClick={() => (setMenu(null), setConfirmDelete(true))} sx={{ color: "error.main" }}>
                  <ListItemIcon><DeleteOutlineRounded fontSize="small" color="error" /></ListItemIcon>Delete this import…
                </MenuItem>
              </Menu>
              <Dialog open={confirmDelete} onClose={() => setConfirmDelete(false)} maxWidth="xs">
                <DialogTitle>Delete this import?</DialogTitle>
                <DialogContent>
                  <Typography variant="body2">This removes all {coll.postIds.length} posts it created (published or not) and this deck. Images no other post uses are cleaned up later.</Typography>
                </DialogContent>
                <DialogActions>
                  <Button onClick={() => setConfirmDelete(false)}>Cancel</Button>
                  <Button color="error" variant="contained" onClick={() => importAct.mutate({ action: "delete" }, { onSuccess: () => (setConfirmDelete(false), notify("Import deleted"), navigate(`${base}/import`)) })}>Delete</Button>
                </DialogActions>
              </Dialog>
            </>
          )}
        </Stack>
      </Stack>

      {tabs && coll.postIds.length > 0 && (
        <Tabs value={show} onChange={(_, v: Show) => (setSelected(new Set()), setParams(v === "all" ? {} : { show: v }, { replace: true }))} aria-label="Which posts" sx={{ mb: 1, borderBottom: 1, borderColor: "divider" }}>
          <Tab value="all" label={`All (${coll.postIds.length})`} />
          <Tab value="review" label={`To review (${drafts})`} />
          <Tab value="published" label={`Published (${loaded.length - drafts})`} />
        </Tabs>
      )}
      {tabs && show !== "all" && !ids.length && loaded.length === coll.postIds.length && (
        <Typography variant="body2" color="text.secondary" sx={{ py: 3 }}>
          {show === "review" ? "Nothing left to review: every slide is published or discarded." : "Nothing published yet. Publish slides from To review."}
        </Typography>
      )}
      {!coll.postIds.length ? (
        <EmptyState
          icon={<CollectionsBookmarkOutlined />}
          title={built ? "No slides yet" : "Nothing here yet"}
          body={built ? "Add a slide from a layout, add posts you've already written (each becomes a slide), or import a PowerPoint into this deck." : "Posts added to this collection show up here, in order."}
        />
      ) : (
        <>
          {/* Nothing on this tab (e.g. To review with 0): nothing to select. */}
          {ids.length > 0 && (
            <Stack direction="row" alignItems="center" spacing={1} useFlexGap sx={{ flexWrap: "wrap", mb: 1.5, minHeight: 40 }}>
              <Checkbox size="small" checked={all} indeterminate={chosen.length > 0 && !all} onChange={() => setSelected(all ? new Set() : new Set(ids))} inputProps={{ "aria-label": all ? "Deselect all posts" : "Select all posts" }} />
              <Typography variant="body2" color="text.secondary" sx={{ flex: 1, minWidth: 100 }}>{chosen.length ? `${chosen.length} selected` : "Select all"}</Typography>
              {chosen.length > 0 && (
                <>
                  {chosenDrafts.length > 0 && <Button size="small" variant="contained" disabled={busy} onClick={() => void publish()}>Publish {chosenDrafts.length}</Button>}
                  {chosen.length > 1 && onlyDrafts && (
                    <Tooltip describeChild title="Into the first one, in deck order. You can split them back until it's published.">
                      <Button
                        size="small"
                        startIcon={<CallMergeRounded />}
                        disabled={busy || combine.isPending}
                        onClick={() => combine.mutate(chosen, { onSuccess: (d) => (setSelected(new Set([d.post.id])), notify(`Combined ${chosen.length} slides into “${d.post.title || "Untitled"}”`, () => splitDraft.mutate(d.post.id))), onError: (e) => notify(e.message) })}
                      >
                        Combine into one post
                      </Button>
                    </Tooltip>
                  )}
                  {chosen.length === 1 && loaded.find((d) => d.post.id === chosen[0])?.post.source?.mergedFrom?.length ? (
                    <Button size="small" startIcon={<CallSplitRounded />} disabled={splitDraft.isPending} onClick={() => splitDraft.mutate(chosen[0], { onSuccess: () => (setSelected(new Set()), notify("Split back into separate slides")), onError: (e) => notify(e.message) })}>
                      Split back
                    </Button>
                  ) : null}
                  {!imported && canEdit && <Button size="small" disabled={busy || update.isPending} onClick={remove}>{built ? "Remove from deck" : "Remove from collection"}</Button>}
                  <Button size="small" color="error" disabled={busy} onClick={() => void discard()}>{onlyDrafts ? "Discard" : "Delete"}</Button>
                </>
              )}
            </Stack>
          )}
        <Box component="ol" aria-label="Posts in this collection" sx={{ listStyle: "none", p: 0, m: 0, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 2 }}>
          {details.map((q, i) =>
            q.data && !shows(q.data.post.id) ? null : q.data ? (
              <Box component="li" key={q.data.post.id} sx={{ position: "relative" }}>
                {/* A sibling of the card link, not inside it, so it stays its own control. */}
                <Checkbox
                  size="small"
                  checked={selected.has(q.data.post.id)}
                  onClick={(e) => toggle(q.data!.post.id, e.shiftKey)} /* the click carries Shift; change events don't reliably */ onChange={() => undefined}
                  inputProps={{ "aria-label": `Select ${q.data.post.title || "untitled post"}` }}
                  sx={{ position: "absolute", top: 12, left: 12, zIndex: 1, p: 0.5, bgcolor: "background.paper", borderRadius: 1, boxShadow: 1, "&:hover": { bgcolor: "background.paper" } }}
                />
                {reorderable && (
                  <Stack direction="row" sx={{ position: "absolute", top: 12, right: 12, zIndex: 1, bgcolor: "background.paper", borderRadius: 1, boxShadow: 1 }}>
                    <Tooltip title="Move earlier">
                      <span>
                        <IconButton size="small" disabled={i === 0 || update.isPending} onClick={() => move(q.data!.post.id, -1)} aria-label={`Move ${q.data.post.title || "untitled slide"} earlier`}>
                          <ChevronLeftRounded fontSize="small" />
                        </IconButton>
                      </span>
                    </Tooltip>
                    <Tooltip title="Move later">
                      <span>
                        <IconButton size="small" disabled={i === details.length - 1 || update.isPending} onClick={() => move(q.data!.post.id, 1)} aria-label={`Move ${q.data.post.title || "untitled slide"} later`}>
                          <ChevronRightRounded fontSize="small" />
                        </IconButton>
                      </span>
                    </Tooltip>
                  </Stack>
                )}
                <ButtonBase
                  component={RouterLink}
                  to={q.data.post.status === "draft" ? `${base}/p/${q.data.post.id}/edit` : `${base}/p/${q.data.post.id}`}
                  state={origin}
                  sx={{ display: "block", width: "100%", textAlign: "left", borderRadius: 1.5, p: 1, border: 1, borderColor: selected.has(q.data.post.id) ? "primary.main" : "divider", bgcolor: "background.paper", "&:hover": { borderColor: "primary.main" } }}
                >
                  <Box sx={{ pointerEvents: "none" }}>
                    <Preview d={q.data} />
                  </Box>
                  <Stack direction="row" alignItems="center" spacing={1} sx={{ mt: 1 }}>
                    <Typography variant="caption" color="text.secondary" sx={{ fontVariantNumeric: "tabular-nums" }}>
                      {q.data.post.source?.slide ?? i + 1}
                    </Typography>
                    <Typography variant="body2" sx={{ fontWeight: 600, flex: 1, minWidth: 0 }} noWrap>
                      {q.data.post.title || "Untitled"}
                    </Typography>
                    {notes.has(q.data.post.id) && q.data.post.status === "draft" && (
                      <Tooltip title={notes.get(q.data.post.id)!.join(" · ")}>
                        <WarningAmberRounded aria-label={`Import notes: ${notes.get(q.data.post.id)!.join("; ")}`} sx={{ fontSize: 18, color: "warning.main" }} />
                      </Tooltip>
                    )}
                    {!!q.data.post.source?.mergedFrom?.length && <Chip size="small" label={`+${q.data.post.source.mergedFrom.length}`} title={`Combined with ${q.data.post.source.mergedFrom.map((m) => m.title || "Untitled").join(", ")}`} />}
                    {q.data.post.status === "draft" && <Chip size="small" label="Draft" color="warning" variant="outlined" />}
                  </Stack>
                </ButtonBase>
              </Box>
            ) : q.isPending ? (
              <Box component="li" key={i}>
                <Skeleton variant="rounded" sx={{ aspectRatio: "16 / 11", height: "auto" }} />
              </Box>
            ) : null,
          )}
        </Box>
        </>
      )}
    </Box>
  );
}
