import {
  ArrowDownwardRounded,
  ArrowUpwardRounded,
  ChevronLeftRounded,
  ChevronRightRounded,
  CloseRounded,
  DeleteOutlineRounded,
  EditOutlined,
  MenuBookOutlined,
  PrintOutlined,
  SlideshowRounded,
} from "@mui/icons-material";
import {
  Box,
  Button,
  Divider,
  IconButton,
  InputBase,
  LinearProgress,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  ListSubheader,
  Skeleton,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from "@mui/material";
import { useEffect, useMemo, useState } from "react";
import { Link as RouterLink, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import type { CollectionEntry, ID, PostDetail, Tag, User } from "../../api/contract";
import { useCollectionEntries, useCollections, useCreateCollection, useDeleteCollection, usePeople, usePostDetails, useTags, useUpdateCollection } from "../../api/hooks";
import type { Origin } from "../../app/origin";
import { isTypingTarget } from "../../app/shortcuts";
import { useWs, wsPath } from "../../app/session";
import { useNotify } from "../../components/notify";
import { RichText } from "../../components/RichText";
import { EmptyState, TagChip, UserAvatar } from "../../components/ui";
import { formatDay, formatRange } from "../../lib/dates";
import { AnnotatedImage } from "../posts/editor/ImageBlock";

/** One notebook entry, rendered like a document section. */
function Entry({ detail, people, tags, origin, pageBreak }: { detail: PostDetail; people: Map<ID, User>; tags: Map<ID, Tag>; origin: Origin; pageBreak?: boolean }) {
  const { org, ws } = useWs();
  const p = detail.post;
  const imgs = new Map(detail.images.map((x) => [x.id, x]));
  return (
    <Box id={`nb-${p.id}`} data-nb-section={p.id} component="article" sx={{ scrollMarginTop: 16, "@media print": { breakBefore: pageBreak ? "page" : "auto" } }}>
      <Typography variant="overline" color="primary">{formatDay(p.workDate)}</Typography>
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
export default function NotebookPage() {
  const { id = "" } = useParams();
  const { org, ws } = useWs();
  const navigate = useNavigate();
  const location = useLocation();
  const notify = useNotify();
  const [params, setParams] = useSearchParams();
  const { data: collections, isPending } = useCollections(org.id, ws.id);
  const nb = collections?.find((c) => c.id === id);
  const { data: entries = [] } = useCollectionEntries(org.id, ws.id, nb?.id);
  const update = useUpdateCollection(org.id, ws.id);
  const remove = useDeleteCollection(org.id, ws.id);
  const recreate = useCreateCollection(org.id, ws.id);
  const { data: peopleList = [] } = usePeople(org.id);
  const { data: tagData } = useTags(org.id);
  const people = useMemo(() => new Map(peopleList.map((p) => [p.id, p])), [peopleList]);
  const tags = useMemo(() => new Map((tagData?.tags ?? []).map((t) => [t.id, t])), [tagData]);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  useEffect(() => setName(nb?.name ?? ""), [nb?.name]);

  const continuous = params.get("view") === "continuous";
  const printing = params.get("print") === "1";
  const index = Math.max(0, entries.findIndex((e) => e.id === params.get("entry")));
  const current = entries[index];
  // Reader loads the current entry plus neighbors (instant prev/next); continuous loads all.
  const ids = continuous ? entries.map((e) => e.id) : [entries[index - 1], current, entries[index + 1]].filter((e): e is CollectionEntry => !!e).map((e) => e.id);
  const details = usePostDetails(org.id, ids);
  const byId = new Map(details.filter((d) => d.data).map((d) => [d.data!.post.id, d.data!]));
  const loadedAll = continuous && ids.every((x) => byId.has(x));
  const origin: Origin = { from: location.pathname + location.search, label: nb?.name ?? "notebook" };

  const setParam = (patch: Record<string, string | null>, replace = false) => {
    const next = new URLSearchParams(params);
    Object.entries(patch).forEach(([k, v]) => (v === null ? next.delete(k) : next.set(k, v)));
    setParams(next, { replace });
  };
  const open = (entryId: string) => {
    if (continuous) {
      // Before everything has loaded, just record the target; the effect below jumps once ready.
      if (loadedAll) document.getElementById(`nb-${entryId}`)?.scrollIntoView({ block: "start" });
      setParam({ entry: entryId }, true);
    } else {
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

  // Continuous: once everything is laid out, show the current entry (also when returning from a post).
  useEffect(() => {
    if (continuous && loadedAll && params.get("entry")) document.getElementById(`nb-${params.get("entry")}`)?.scrollIntoView({ block: "start" });
    // run once when the layout is complete
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [continuous, loadedAll]);

  if (isPending) return <Skeleton variant="rounded" height={300} sx={{ m: 3 }} />;
  if (!nb) return <EmptyState title="Notebook not found" body="It may have been deleted." action={<Button component={RouterLink} to={wsPath(org, ws)}>Back to feed</Button>} />;

  const move = (entryId: string, d: -1 | 1) => {
    const order = [...nb.postIds];
    const i = order.indexOf(entryId);
    if (i < 0 || !order[i + d]) return;
    [order[i], order[i + d]] = [order[i + d], order[i]];
    update.mutate({ id: nb.id, postIds: order }, { onError: (e) => notify(`Couldn't reorder: ${e.message}`) });
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
    <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", lg: "280px minmax(0, 1fr)" }, width: "100%", "@media print": { display: "block" } }}>
      <Box component="nav" aria-label="Contents" data-print-hide sx={{ display: { xs: "none", lg: "block" }, borderRight: 1, borderColor: "divider", position: "sticky", top: 0, alignSelf: "start", maxHeight: "100dvh", overflow: "auto", py: 2 }}>
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
                      <IconButton size="small" onClick={() => update.mutate({ id: nb.id, postIds: nb.postIds.filter((x) => x !== e.id) }, { onError: (err) => notify(`Couldn't remove: ${err.message}`) })} aria-label={`Remove ${e.title}`}><CloseRounded sx={{ fontSize: 16 }} /></IconButton>
                    </Stack>
                  )
                }
                sx={{ "& .MuiListItemSecondaryAction-root": { right: 4 } }}
              >
                <ListItemButton selected={current?.id === e.id} onClick={() => open(e.id)} sx={{ py: 0.25, pr: editing ? "92px !important" : 2 }}>
                  <ListItemText primary={e.title || "Untitled"} secondary={formatDay(e.workDate, false)} slotProps={{ primary: { noWrap: true, fontSize: "0.82rem" }, secondary: { fontSize: "0.7rem" } }} />
                </ListItemButton>
              </ListItem>
            ))}
          </List>
        ))}
      </Box>

      <Box sx={{ maxWidth: 860, width: "100%", mx: "auto", px: { xs: 1.5, sm: 4 }, py: 3 }}>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5, flexWrap: "wrap", rowGap: 1 }} data-print-hide>
          <MenuBookOutlined sx={{ color: "text.secondary" }} />
          <Typography variant="overline" color="text.secondary" sx={{ flex: 1 }}>Notebook</Typography>
          <ToggleButtonGroup size="small" exclusive value={continuous ? "continuous" : "reader"} onChange={(_, v) => v && setParam({ view: v === "continuous" ? "continuous" : null })} aria-label="Notebook layout" sx={{ "& .MuiToggleButton-root": { textTransform: "none", py: 0.25 } }}>
            <ToggleButton value="reader">One entry</ToggleButton>
            <ToggleButton value="continuous">Continuous</ToggleButton>
          </ToggleButtonGroup>
          <Button size="small" startIcon={<SlideshowRounded />} onClick={() => navigate(`${wsPath(org, ws, "/present")}?collection=${nb.id}`)} disabled={!entries.length}>Present</Button>
          <Button size="small" startIcon={<PrintOutlined />} onClick={() => setParam({ view: "continuous", print: "1" })} disabled={!entries.length}>Print / PDF</Button>
          <Tooltip describeChild title={editing ? "Done reordering" : "Reorder or remove entries in the contents list"}>
            <Button size="small" startIcon={<EditOutlined />} variant={editing ? "contained" : "text"} onClick={() => setEditing(!editing)}>{editing ? "Done" : "Edit"}</Button>
          </Tooltip>
          <Tooltip title="Delete notebook (posts are kept)">
            <IconButton
              size="small"
              aria-label="Delete notebook"
              onClick={() => {
                const snapshot = { name: nb.name, postIds: nb.postIds, kind: nb.kind };
                remove.mutate(nb.id, {
                  onSuccess: () => {
                    navigate(wsPath(org, ws));
                    notify(`Deleted notebook “${snapshot.name}”`, () => recreate.mutate(snapshot, { onSuccess: (c) => navigate(wsPath(org, ws, `/notebooks/${c.id}`)) }));
                  },
                });
              }}
            >
              <DeleteOutlineRounded fontSize="small" />
            </IconButton>
          </Tooltip>
        </Stack>
        <InputBase
          fullWidth
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => name.trim() && name !== nb.name && update.mutate({ id: nb.id, name: name.trim() }, { onError: (e) => (setName(nb.name), notify(e.message)) })}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          inputProps={{ "aria-label": "Notebook title" }}
          sx={{ fontSize: "2rem", fontWeight: 700, letterSpacing: "-0.02em" }}
        />
        <Typography color="text.secondary" sx={{ mb: 3 }}>
          {entries.length} {entries.length === 1 ? "entry" : "entries"}
          {range && ` · ${formatRange(range.from, range.to)}`}
        </Typography>

        {!entries.length ? (
          <EmptyState title="This notebook is empty" body="Select posts in search and choose “Make notebook”, or make one from a tag on Explore." />
        ) : continuous ? (
          <>
            {!loadedAll && (
              <Box sx={{ mb: 2 }} data-print-hide>
                <LinearProgress variant="determinate" value={(byId.size / ids.length) * 100} />
                <Typography variant="caption" color="text.secondary">Loading {byId.size} of {ids.length} entries{printing ? " before printing" : ""}…</Typography>
              </Box>
            )}
            <Stack divider={<Divider sx={{ my: 4, "@media print": { display: "none" } }} />}>
              {entries.map((e, i) => {
                const d = byId.get(e.id);
                return d ? <Entry key={e.id} detail={d} people={people} tags={tags} origin={{ ...origin, from: `${location.pathname}?view=continuous&entry=${e.id}` }} pageBreak={i > 0} /> : <Skeleton key={e.id} variant="rounded" height={160} />;
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
