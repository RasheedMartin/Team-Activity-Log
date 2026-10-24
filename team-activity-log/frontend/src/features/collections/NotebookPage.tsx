import { ArrowDownwardRounded, ArrowUpwardRounded, CloseRounded, DeleteOutlineRounded, EditOutlined, MenuBookOutlined, PrintOutlined, SlideshowRounded } from "@mui/icons-material";
import { Box, Button, Divider, IconButton, InputBase, List, ListItemButton, ListItemText, ListSubheader, Skeleton, Stack, Tooltip, Typography } from "@mui/material";
import { useEffect, useMemo, useState } from "react";
import { Link as RouterLink, useNavigate, useParams } from "react-router-dom";
import { useCollections, useCreateCollection, useDeleteCollection, usePeople, usePostDetails, useTags, useUpdateCollection } from "../../api/hooks";
import { useWs, wsPath } from "../../app/session";
import { useNotify } from "../../components/notify";
import { RichText } from "../../components/RichText";
import { EmptyState, TagChip, UserAvatar } from "../../components/ui";
import { formatDay, formatRange } from "../../lib/dates";
import { AnnotatedImage } from "../posts/editor/ImageBlock";

/**
 * Notebook (owner request): posts stitched into one continuous document, with a date table of
 * contents, presentable as slides and printable to PDF. Stored as a Collection of kind "notebook".
 */
export default function NotebookPage() {
  const { id = "" } = useParams();
  const { org, ws } = useWs();
  const navigate = useNavigate();
  const notify = useNotify();
  const { data: collections, isPending } = useCollections(org.id, ws.id);
  const nb = collections?.find((c) => c.id === id);
  const update = useUpdateCollection(org.id, ws.id);
  const remove = useDeleteCollection(org.id, ws.id);
  const recreate = useCreateCollection(org.id, ws.id);
  const details = usePostDetails(org.id, nb?.postIds ?? []);
  const { data: peopleList = [] } = usePeople(org.id);
  const { data: tagData } = useTags(org.id);
  const people = useMemo(() => new Map(peopleList.map((p) => [p.id, p])), [peopleList]);
  const tags = useMemo(() => new Map((tagData?.tags ?? []).map((t) => [t.id, t])), [tagData]);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [current, setCurrent] = useState<string | null>(null);
  useEffect(() => setName(nb?.name ?? ""), [nb?.name]);

  const loaded = details.filter((d) => d.data).map((d) => d.data!);
  const posts = loaded.map((d) => d.post);
  const range = posts.length ? { from: posts.reduce((m, p) => (p.workDate < m ? p.workDate : m), posts[0].workDate), to: posts.reduce((m, p) => (p.workDate > m ? p.workDate : m), posts[0].workDate) } : undefined;

  // Highlight the table-of-contents entry for the section in view.
  useEffect(() => {
    const els = document.querySelectorAll<HTMLElement>("[data-nb-section]");
    const io = new IntersectionObserver((entries) => {
      const top = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (top) setCurrent(top.target.getAttribute("data-nb-section"));
    }, { rootMargin: "-10% 0px -70% 0px" });
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [loaded.length]);

  if (isPending) return <Skeleton variant="rounded" height={300} sx={{ m: 3 }} />;
  if (!nb) return <EmptyState title="Notebook not found" body="It may have been deleted." action={<Button component={RouterLink} to={wsPath(org, ws)}>Back to feed</Button>} />;

  const move = (i: number, d: -1 | 1) => {
    const ids = [...nb.postIds];
    [ids[i], ids[i + d]] = [ids[i + d], ids[i]];
    update.mutate({ id: nb.id, postIds: ids });
  };
  const byYear = new Map<string, typeof posts>();
  nb.postIds.forEach((pid) => {
    const p = posts.find((x) => x.id === pid);
    if (!p) return;
    const y = p.workDate.slice(0, 4);
    byYear.set(y, [...(byYear.get(y) ?? []), p]);
  });

  return (
    <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", lg: "260px minmax(0, 1fr)" }, width: "100%", "@media print": { display: "block" } }}>
      <Box component="nav" aria-label="Contents" data-print-hide sx={{ display: { xs: "none", lg: "block" }, borderRight: 1, borderColor: "divider", position: "sticky", top: 0, alignSelf: "start", maxHeight: "100dvh", overflow: "auto", py: 2 }}>
        <Typography variant="overline" color="text.secondary" sx={{ px: 2 }}>Contents</Typography>
        {[...byYear.entries()].map(([year, list]) => (
          <List key={year} dense disablePadding subheader={<ListSubheader sx={{ lineHeight: "26px", bgcolor: "transparent" }}>{year}</ListSubheader>}>
            {list.map((p) => (
              <ListItemButton key={p.id} selected={current === p.id} onClick={() => document.getElementById(`nb-${p.id}`)?.scrollIntoView({ behavior: "smooth", block: "start" })} sx={{ py: 0.25 }}>
                <ListItemText primary={p.title} secondary={formatDay(p.workDate, false)} slotProps={{ primary: { noWrap: true, fontSize: "0.82rem" }, secondary: { fontSize: "0.7rem" } }} />
              </ListItemButton>
            ))}
          </List>
        ))}
      </Box>

      <Box sx={{ maxWidth: 860, width: "100%", mx: "auto", px: { xs: 1.5, sm: 4 }, py: 3 }}>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }} data-print-hide>
          <MenuBookOutlined sx={{ color: "text.secondary" }} />
          <Typography variant="overline" color="text.secondary" sx={{ flex: 1 }}>Notebook</Typography>
          <Button size="small" startIcon={<SlideshowRounded />} onClick={() => navigate(`${wsPath(org, ws, "/present")}?collection=${nb.id}`)} disabled={!nb.postIds.length}>Present</Button>
          <Button size="small" startIcon={<PrintOutlined />} onClick={() => window.print()}>Print / PDF</Button>
          <Tooltip describeChild title={editing ? "Done reordering" : "Reorder or remove posts"}>
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
          onBlur={() => name.trim() && name !== nb.name && update.mutate({ id: nb.id, name: name.trim() })}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          inputProps={{ "aria-label": "Notebook title" }}
          sx={{ fontSize: "2rem", fontWeight: 700, letterSpacing: "-0.02em" }}
        />
        <Typography color="text.secondary" sx={{ mb: 3 }}>
          {nb.postIds.length} {nb.postIds.length === 1 ? "entry" : "entries"}
          {range && ` · ${formatRange(range.from, range.to)}`}
        </Typography>

        {!nb.postIds.length && <EmptyState title="This notebook is empty" body="Select posts in search and choose “Make notebook”, or add them from a tag on Explore." />}
        {nb.postIds.map((pid, i) => {
          const d = loaded.find((x) => x.post.id === pid);
          if (!d) return <Skeleton key={pid} variant="rounded" height={200} sx={{ mb: 3 }} />;
          const p = d.post;
          const imgs = new Map(d.images.map((x) => [x.id, x]));
          return (
            <Box key={pid} id={`nb-${pid}`} data-nb-section={pid} component="article" sx={{ scrollMarginTop: 16, mb: 4, "@media print": { breakBefore: i ? "page" : "auto" } }}>
              <Stack direction="row" spacing={1} alignItems="flex-start">
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="overline" color="primary">{formatDay(p.workDate)}</Typography>
                  <Typography component="h2" variant="h2" sx={{ mb: 0.75 }}>
                    <Box component={RouterLink} to={wsPath(org, ws, `/p/${p.id}`)} sx={{ color: "inherit", textDecoration: "none", "&:hover": { textDecoration: "underline" } }}>{p.title}</Box>
                  </Typography>
                </Box>
                {editing && (
                  <Stack direction="row" data-print-hide>
                    <IconButton size="small" disabled={i === 0} onClick={() => move(i, -1)} aria-label={`Move ${p.title} up`}><ArrowUpwardRounded fontSize="small" /></IconButton>
                    <IconButton size="small" disabled={i === nb.postIds.length - 1} onClick={() => move(i, 1)} aria-label={`Move ${p.title} down`}><ArrowDownwardRounded fontSize="small" /></IconButton>
                    <IconButton size="small" onClick={() => update.mutate({ id: nb.id, postIds: nb.postIds.filter((x) => x !== pid) })} aria-label={`Remove ${p.title}`}><CloseRounded fontSize="small" /></IconButton>
                  </Stack>
                )}
              </Stack>
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
              {i < nb.postIds.length - 1 && <Divider sx={{ mt: 4, "@media print": { display: "none" } }} />}
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}
