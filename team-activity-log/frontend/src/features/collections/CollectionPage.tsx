import { AddRounded, CollectionsBookmarkOutlined, ManageSearchRounded, SlideshowRounded, UploadFileOutlined } from "@mui/icons-material";
import { Box, Button, ButtonBase, Checkbox, Chip, Skeleton, Stack, Typography } from "@mui/material";
import { useMemo, useState } from "react";
import { Link as RouterLink, useParams } from "react-router-dom";
import type { PostDetail } from "../../api/contract";
import { useCollection, usePostAction, usePostDetails, useUpdateCollection } from "../../api/hooks";
import { useOrigin } from "../../app/origin";
import { useWs, wsPath } from "../../app/session";
import { RichText } from "../../components/RichText";
import { SlideCanvas } from "../../components/SlideCanvas";
import { useNotify } from "../../components/notify";
import { EmptyState, ErrorState } from "../../components/ui";
import { blockDocs } from "../../lib/blocks";
import { formatDay } from "../../lib/dates";
import { useRangeSelect } from "../../lib/useRangeSelect";
import { docText } from "../../lib/prosemirror";
import { AddPostsDialog } from "./AddPosts";
import { FavoriteButton } from "./FavoriteButton";
import { collectionParams } from "./libraryLinks";

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

/**
 * A collection's own page: its posts in order as slide-like cards (an imported deck reads like
 * the deck), with Present, Favorite, the import it came from, and Search within for filtering.
 */
export default function CollectionPage() {
  const { id = "" } = useParams();
  const { org, ws } = useWs();
  const base = wsPath(org, ws);
  const c = useCollection(org.id, ws.id, id);
  const origin = useOrigin(c.data?.name ?? "collection"); // Back from a post or draft returns here
  const details = usePostDetails(org.id, c.data?.postIds ?? []);
  const loaded = details.filter((q) => q.data).map((q) => q.data!);
  const deck = c.data?.kind === "deck_import";
  const importJobId = loaded.find((d) => d.post.source?.kind === "import")?.post.source?.importJobId;
  const drafts = loaded.filter((d) => d.post.status === "draft").length;
  const action = usePostAction(org.id);
  const update = useUpdateCollection(org.id, ws.id);
  const notify = useNotify();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const ids = c.data?.postIds ?? [];
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
          <Stack direction="row" spacing={0.75} alignItems="center" sx={{ color: "text.secondary", mb: 0.5 }}>
            {deck ? <UploadFileOutlined sx={{ fontSize: 16 }} /> : <CollectionsBookmarkOutlined sx={{ fontSize: 16 }} />}
            <Typography variant="caption">{deck ? "Imported slides" : "Collection"}</Typography>
          </Stack>
          <Typography variant="h1" sx={{ fontSize: "1.6rem", wordBreak: "break-word" }}>{coll.name}</Typography>
          <Typography variant="body2" color="text.secondary">
            {coll.postIds.length} post{coll.postIds.length === 1 ? "" : "s"}
            {drafts > 0 && ` · ${drafts} still draft${drafts === 1 ? "" : "s"}`}
            {coll.updatedAt && ` · updated ${formatDay(coll.updatedAt.slice(0, 10))}`}
          </Typography>
        </Box>
        <Stack direction="row" spacing={1} useFlexGap alignItems="center" sx={{ flexWrap: "wrap" }}>
          <Button variant="contained" startIcon={<SlideshowRounded />} component={RouterLink} to={`${base}/present?collection=${coll.id}`} disabled={!coll.postIds.length}>
            Present
          </Button>
          {deck && importJobId && (
            <Button component={RouterLink} to={`${base}/import?job=${importJobId}`} startIcon={<UploadFileOutlined />}>
              Open import
            </Button>
          )}
          <Button startIcon={<AddRounded />} onClick={() => setAdding(true)}>
            Add posts
          </Button>
          <AddPostsDialog open={adding} onClose={() => setAdding(false)} collectionId={coll.id} name={coll.name} postIds={coll.postIds} />
          <Button component={RouterLink} to={`${base}/search?${collectionParams(coll.id)}`} startIcon={<ManageSearchRounded />}>
            Search within
          </Button>
          <FavoriteButton kind="collection" id={coll.id} name={coll.name} />
        </Stack>
      </Stack>

      {!coll.postIds.length ? (
        <EmptyState icon={<CollectionsBookmarkOutlined />} title="Nothing here yet" body="Posts added to this collection show up here, in order." />
      ) : (
        <>
          <Stack direction="row" alignItems="center" spacing={1} useFlexGap sx={{ flexWrap: "wrap", mb: 1.5, minHeight: 40 }}>
            <Checkbox size="small" checked={all} indeterminate={chosen.length > 0 && !all} onChange={() => setSelected(all ? new Set() : new Set(ids))} inputProps={{ "aria-label": all ? "Deselect all posts" : "Select all posts" }} />
            <Typography variant="body2" color="text.secondary" sx={{ flex: 1, minWidth: 100 }}>{chosen.length ? `${chosen.length} selected` : "Select all"}</Typography>
            {chosen.length > 0 && (
              <>
                {chosenDrafts.length > 0 && <Button size="small" variant="contained" disabled={busy} onClick={() => void publish()}>Publish {chosenDrafts.length}</Button>}
                <Button size="small" disabled={busy || update.isPending} onClick={remove}>Remove from collection</Button>
                <Button size="small" color="error" disabled={busy} onClick={() => void discard()}>{onlyDrafts ? "Discard" : "Delete"}</Button>
              </>
            )}
          </Stack>
        <Box component="ol" aria-label="Posts in this collection" sx={{ listStyle: "none", p: 0, m: 0, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 2 }}>
          {details.map((q, i) =>
            q.data ? (
              <Box component="li" key={q.data.post.id} sx={{ position: "relative" }}>
                {/* A sibling of the card link, not inside it, so it stays its own control. */}
                <Checkbox
                  size="small"
                  checked={selected.has(q.data.post.id)}
                  onChange={(e) => toggle(q.data!.post.id, (e.nativeEvent as MouseEvent).shiftKey)}
                  inputProps={{ "aria-label": `Select ${q.data.post.title || "untitled post"}` }}
                  sx={{ position: "absolute", top: 12, left: 12, zIndex: 1, p: 0.5, bgcolor: "background.paper", borderRadius: 1, boxShadow: 1, "&:hover": { bgcolor: "background.paper" } }}
                />
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
