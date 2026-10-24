import { CheckBoxOutlined, FilterListRounded, GridViewRounded, TableRowsOutlined, ViewListRounded, ZoomInRounded, ZoomOutRounded } from "@mui/icons-material";
import { Box, Button, Drawer, IconButton, Link, MenuItem, Skeleton, Stack, TextField, ToggleButton, ToggleButtonGroup, Tooltip, Typography, useMediaQuery, useTheme } from "@mui/material";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link as RouterLink, useLocation, useNavigate, useNavigationType, useSearchParams } from "react-router-dom";
import type { Collection, Condition, DateField, FilterGroup, FilterSpec, GalleryImage, ID, Interval, LibraryItem, Post, SearchHit, SearchResponse, Sort } from "../../api/contract";
import { isFilterGroup } from "../../api/contract";
import { removeFromOverlay, useCollectionsByIds, useOverlay, usePeople, useSavedView, useSearch, useSearchCounts, useTags } from "../../api/hooks";
import { can, useWs, wsPath } from "../../app/session";
import { APP_EVENTS, isTypingTarget, useAppEvent } from "../../app/shortcuts";
import { useNotify } from "../../components/notify";
import { EmptyState, ErrorState } from "../../components/ui";
import { addDays, resolveRange } from "../../lib/dates";
import {
  effectiveSort,
  fromSearchParams,
  getDateFilter,
  histogramField,
  isEmptySpec,
  setDateFilter,
  toSearchParams,
  toggleFacetValue,
} from "../../lib/filterSpec";
import { useOrigin } from "../../app/origin";
import { SelectionTray } from "../collections/SelectionTray";
import { AdvancedFilters } from "./AdvancedFilters";
import { ChipsBar, SavedViewsMenu, SaveViewDialog } from "./ChipsBar";
import { describeCondition, type DescribeCtx } from "./fields";
import { FilterSidebar } from "./FilterSidebar";
import { Histogram, HistogramTable } from "./Histogram";
import { OnboardingChecklist } from "./Onboarding";
import { FavoriteButton } from "../collections/FavoriteButton";
import { GalleryGrid, GalleryViewer, PeekPane, ResultsList } from "./Results";
import { SearchBar } from "./SearchBar";

/** Collection IDs referenced anywhere in a spec (all/any/none and nested where groups). */
function referencedCollectionIds(spec: FilterSpec): string[] {
  const out = new Set<string>();
  const visit = (c: Condition | FilterGroup) => {
    if (isFilterGroup(c)) c.items.forEach(visit);
    else if (c.field === "collection" && Array.isArray(c.value)) (c.value as string[]).forEach((id) => out.add(id));
  };
  [...(spec.all ?? []), ...(spec.any ?? []), ...(spec.none ?? [])].forEach(visit);
  if (spec.where) visit(spec.where);
  return [...out];
}

const SORTS: [Sort, string][] = [
  ["relevance", "Relevance"],
  ["newest", "Newest"],
  ["oldest", "Oldest"],
  ["workDate", "Work date"],
  ["mostDiscussed", "Most discussed"],
  ["recentActivity", "Recent activity"],
];
const INTERVALS: Interval[] = ["auto", "day", "week", "month", "quarter", "year"];
const SIDEBAR_KEY = "tal.filters-open";

/** The feed and search are the same screen, driven by one URL-serialized FilterSpec (§A3, §W4). */
export function SearchPage() {
  const { org, ws, me, role } = useWs();
  const theme = useTheme();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const notify = useNotify();
  const wide = useMediaQuery(theme.breakpoints.up("md"));
  const xwide = useMediaQuery(theme.breakpoints.up("xl"));
  const [params, setParams] = useSearchParams();
  const spec = useMemo(() => fromSearchParams(params), [params]);
  const activeViewId = params.get("view");

  const setSpec = useCallback(
    (next: FilterSpec, opts?: { replace?: boolean }) => {
      const p = toSearchParams(next);
      if (activeViewId) p.set("view", activeViewId);
      setParams(p, { replace: opts?.replace });
    },
    [setParams, activeViewId],
  );

  const prefField = me.preferences.histogramDateField;
  const histField = histogramField(spec, prefField);
  const view = spec.view ?? "posts";
  const query: FilterSpec = useMemo(() => ({ ...spec, histogram: { field: histField, interval: spec.histogram?.interval ?? "auto", bounds: spec.histogram?.bounds } }), [spec, histField]);
  const search = useSearch(org.id, ws.id, query);
  const first: SearchResponse | undefined = search.data?.pages[0];

  const { data: tagData } = useTags(org.id);
  const { data: peopleList = [] } = usePeople(org.id);
  // Only the collections this spec refers to are loaded (for chip labels), never the whole list.
  const collectionIds = useMemo(() => referencedCollectionIds(spec), [spec]);
  const collectionResults = useCollectionsByIds(org.id, ws.id, collectionIds);
  const collections = collectionResults.map((r) => r.data).filter((c): c is Collection => !!c);
  const collectionsKey = collections.map((c) => `${c.id}:${c.name}`).join("|");
  const { data: activeView } = useSavedView(org.id, ws.id, activeViewId);
  const tags = useMemo(() => new Map((tagData?.tags ?? []).map((t) => [t.id, t])), [tagData]);
  const people = useMemo(() => new Map(peopleList.map((p) => [p.id, p])), [peopleList]);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- collectionsKey tracks the loaded names
  const ctx: DescribeCtx = useMemo(() => ({ tags, people, collections: new Map(collections.map((c) => [c.id, c])), meId: me.user.id }), [tags, people, collectionsKey, me.user.id]);
  // "Back to …" label for posts opened from here: a saved view, a collection, the feed, or results.
  const onlyCollection = !spec.q && !spec.none?.length && !spec.any?.length && !spec.where && spec.all?.length === 1 && spec.all[0].field === "collection" ? collections.find((c) => (spec.all![0].value as string[])?.[0] === c.id) : undefined;
  const origin = useOrigin(activeView?.name ?? onlyCollection?.name ?? (isEmptySpec(spec) ? "all posts" : "results"));

  // Optimistic overlay (§B6): just-published posts lead the unfiltered feed until search has them.
  const { data: overlay } = useOverlay(org.id, ws.id);
  const serverHits = useMemo(() => search.data?.pages.flatMap((p) => p.hits) ?? [], [search.data]);
  const hits: SearchHit[] = useMemo(() => {
    const plainFeed = isEmptySpec(spec) && effectiveSort(spec) === "newest";
    const pending = plainFeed ? overlay.filter((p) => !serverHits.some((h) => h.post.id === p.id)) : [];
    return [...pending.map((post) => ({ post, highlights: [], matchedIn: [], images: [] })), ...serverHits];
  }, [overlay, serverHits, spec]);
  useEffect(() => {
    const landed = overlay.filter((p) => serverHits.some((h) => h.post.id === p.id)).map((p) => p.id);
    if (landed.length) removeFromOverlay(qc, org.id, ws.id, landed);
  }, [overlay, serverHits, qc, org.id, ws.id]);
  const images: GalleryImage[] = useMemo(() => search.data?.pages.flatMap((p) => p.images ?? []) ?? [], [search.data]);

  // ---- layout state ----
  const [sidebar, setSidebar] = useState(() => {
    try {
      return localStorage.getItem(SIDEBAR_KEY) !== "0";
    } catch {
      return true;
    }
  });
  const toggleSidebar = useCallback(() => {
    setSidebar((s) => {
      try {
        localStorage.setItem(SIDEBAR_KEY, s ? "0" : "1");
      } catch {
        // per-viewer convenience only
      }
      return !s;
    });
  }, []);
  useAppEvent(APP_EVENTS.toggleFilters, toggleSidebar);
  const [mobileFilters, setMobileFilters] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showTable, setShowTable] = useState(false);
  const [focused, setFocused] = useState(-1);
  const [peek, setPeek] = useState<string | null>(null);
  const [viewer, setViewer] = useState<GalleryImage | null>(null);
  useEffect(() => setFocused(-1), [params]);

  // Selection (§W5.2) survives query changes, so you can gather posts from several searches.
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<Map<ID, Post>>(new Map());
  const toggleSelected = useCallback((h: SearchHit) => {
    setPicked((m) => {
      const n = new Map(m);
      if (n.has(h.post.id)) n.delete(h.post.id);
      else n.set(h.post.id, h.post);
      return n;
    });
  }, []);
  const selection = useMemo(() => (selecting ? { ids: new Set(picked.keys()), toggle: toggleSelected } : undefined), [selecting, picked, toggleSelected]);

  // ---- keyboard: j/k move, Enter open, Space peek, Esc close (§A4) ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target) || e.metaKey || e.ctrlKey || e.altKey || !me.preferences.shortcuts) return;
      // A dialog owns the keyboard, except the peek drawer, which is part of list navigation.
      if (document.querySelector(".MuiModal-root:not(.MuiPopover-root):not(.peek-drawer)")) return;
      if (view !== "posts" || !hits.length) return;
      if (e.key === "j" || e.key === "k") {
        e.preventDefault();
        const next = Math.max(0, Math.min(hits.length - 1, focused + (e.key === "j" ? 1 : -1)));
        setFocused(next);
        if (peek) setPeek(hits[next].post.id);
        if (e.key === "j" && next >= hits.length - 3 && search.hasNextPage) void search.fetchNextPage();
      } else if (e.key === "Enter" && focused >= 0) {
        e.preventDefault();
        navigate(wsPath(org, ws, `/p/${hits[focused].post.id}`), { state: origin });
      } else if (e.key === " " && focused >= 0) {
        e.preventDefault();
        const id = hits[focused].post.id;
        setPeek((p) => (p === id ? null : id));
      } else if (e.key === "x" && focused >= 0) {
        e.preventDefault();
        setSelecting(true);
        toggleSelected(hits[focused]);
      } else if (e.key === "Escape" && peek) {
        setPeek(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hits, focused, peek, view, navigate, org, ws, search, me.preferences.shortcuts, toggleSelected, origin]);

  // Back/forward restores the list position by anchor (see ResultsList).
  const navType = useNavigationType();
  const location = useLocation();
  const scrollKey = `tal.scroll.${location.key}`;

  const onEndReached = useCallback(() => {
    if (search.hasNextPage && !search.isFetchingNextPage) void search.fetchNextPage();
  }, [search]);

  // ---- histogram actions ----
  const hist = first?.histogram;
  const dateFilter = getDateFilter(spec);
  const selected = dateFilter ? resolveRange(dateFilter.value) : undefined;
  const selectRange = (r: { from: string; to: string }) => setSpec(setDateFilter(spec, histField, r));
  const setHistField = (f: DateField) => {
    const s = dateFilter ? setDateFilter(spec, f, dateFilter.value) : spec;
    setSpec({ ...s, histogram: { field: f, interval: spec.histogram?.interval ?? "auto" } });
  };
  const zoomTo = (bounds?: { from: string; to: string }) => setSpec({ ...spec, histogram: { field: histField, interval: spec.histogram?.interval ?? "auto", bounds } }, { replace: true });
  const zoomBy = useCallback(
    (factor: number, center: number) => {
      const b = hist?.buckets;
      if (!b?.length) return;
      const from = new Date(b[0].start).getTime();
      const to = new Date(b[b.length - 1].end).getTime();
      const mid = new Date(b[Math.min(center, b.length - 1)].start).getTime();
      const span = Math.max(14 * 86_400_000, (to - from) * factor);
      const nf = new Date(Math.max(mid - span / 2, from - span)).toISOString().slice(0, 10);
      const nt = new Date(mid + span / 2).toISOString().slice(0, 10);
      zoomTo(factor > 1 && spec.histogram?.bounds && span > (to - from) * 1.9 ? undefined : { from: nf, to: nt });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [hist, spec],
  );

  // ---- zero results: suggest which filter to drop (§W4.11) ----
  const removable: { label: string; spec: FilterSpec }[] = useMemo(() => {
    const out: { label: string; spec: FilterSpec }[] = [];
    if (spec.q) out.push({ label: `the search “${spec.q}”`, spec: { ...spec, q: undefined } });
    (["all", "none", "any"] as const).forEach((list) =>
      (spec[list] ?? []).forEach((c: Condition, i: number) => {
        const arr = (spec[list] ?? []).filter((_, j) => j !== i);
        out.push({ label: describeCondition(c, ctx, list === "none"), spec: { ...spec, [list]: arr.length ? arr : undefined } });
      }),
    );
    if (spec.where) out.push({ label: "advanced filters", spec: { ...spec, where: undefined } });
    return out.slice(0, 6);
  }, [spec, ctx]);
  const noResults = !!first && first.total === 0 && !isEmptySpec(spec);
  const relaxed = useSearchCounts(org.id, ws.id, removable.map((r) => r.spec), noResults);
  const suggestions = removable
    .map((r, i) => ({ ...r, total: relaxed[i]?.data ?? 0 }))
    .filter((r) => r.total > 0)
    .sort((a, b) => b.total - a.total)
    .slice(0, 3);

  const applyView = (v: LibraryItem) => {
    const p = toSearchParams(v.filterSpec ?? {});
    p.set("view", v.id);
    navigate(`${wsPath(org, ws, "/search")}?${p}`);
  };

  const filters = (
    <FilterSidebar
      spec={spec}
      setSpec={setSpec}
      facets={first?.facets}
      tags={tagData?.tags ?? []}
      groups={tagData?.groups ?? []}
      people={people}
      meId={me.user.id}
      histField={histField}
      onHistField={setHistField}
    />
  );
  const comfortable = me.preferences.density === "comfortable";
  const dimmed = search.isPlaceholderData || (search.isFetching && !search.isFetchingNextPage && !!first);

  return (
    <Box sx={{ display: "flex", flexDirection: "column", minHeight: "100%", width: "100%" }}>
      {/* Top bar: search · saved views · view mode · sort · filters toggle */}
      <Stack direction="row" spacing={1} alignItems="center" sx={{ px: { xs: 1.5, md: 2 }, pt: 1.5, pb: 1, flexWrap: { xs: "wrap", md: "nowrap" }, rowGap: 1 }}>
        <Tooltip title="Filters ( [ )">
          <IconButton onClick={() => (wide ? toggleSidebar() : setMobileFilters(true))} aria-label="Toggle filters" aria-pressed={wide ? sidebar : mobileFilters} sx={{ color: sidebar && wide ? "primary.main" : "text.secondary" }}>
            <FilterListRounded />
          </IconButton>
        </Tooltip>
        <SearchBar spec={spec} setSpec={setSpec} tags={tagData?.tags ?? []} people={peopleList} />
        <SavedViewsMenu activeId={activeViewId} onApply={applyView} />
        <ToggleButtonGroup
          size="small"
          exclusive
          value={view}
          onChange={(_, v) => v && setSpec({ ...spec, view: v, cursor: undefined })}
          aria-label="Show results as"
          sx={{ "& .MuiToggleButton-root": { textTransform: "none", gap: 0.75, px: 1.25, fontWeight: 600 } }}
        >
          <Tooltip describeChild title="List matching posts">
            <ToggleButton value="posts" aria-label="Posts">
              <ViewListRounded fontSize="small" />
              <Box component="span" sx={{ display: { xs: "none", sm: "inline" } }}>Posts</Box>
            </ToggleButton>
          </Tooltip>
          <Tooltip describeChild title="Grid of every image in matching posts">
            <ToggleButton value="gallery" aria-label="Images">
              <GridViewRounded fontSize="small" />
              <Box component="span" sx={{ display: { xs: "none", sm: "inline" } }}>Images</Box>
            </ToggleButton>
          </Tooltip>
        </ToggleButtonGroup>
        {view === "posts" && (
          <Tooltip describeChild title="Select posts to present, save, or make a notebook (X)">
            <ToggleButton size="small" value="select" selected={selecting} onChange={() => setSelecting(!selecting)} aria-label="Select posts" sx={{ textTransform: "none", gap: 0.75, px: 1.25, fontWeight: 600 }}>
              <CheckBoxOutlined fontSize="small" />
              <Box component="span" sx={{ display: { xs: "none", lg: "inline" } }}>Select</Box>
            </ToggleButton>
          </Tooltip>
        )}
        <TextField select size="small" value={effectiveSort(spec)} onChange={(e) => setSpec({ ...spec, sort: e.target.value as Sort, cursor: undefined })} sx={{ minWidth: 140, display: { xs: "none", sm: "flex" } }} inputProps={{ "aria-label": "Sort" }}>
          {SORTS.filter(([s]) => s !== "relevance" || spec.q).map(([s, label]) => <MenuItem key={s} value={s}>{label}</MenuItem>)}
        </TextField>
      </Stack>

      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: sidebar ? "248px minmax(0, 1fr)" : "minmax(0, 1fr)" }, flex: 1 }}>
        {wide && sidebar && (
          <Box component="aside" aria-label="Filters" sx={{ borderRight: 1, borderColor: "divider", position: "sticky", top: 0, alignSelf: "start", maxHeight: "100dvh", overflow: "auto" }}>
            {filters}
          </Box>
        )}
        <Box sx={{ minWidth: 0, px: { xs: 1.5, md: 2 }, pb: 6 }}>
          <Stack direction="row" alignItems="center" spacing={0.5} sx={{ pt: 1.5 }}>
            <Typography component="h1" variant="h3">
              {activeView?.name ?? onlyCollection?.name ?? (isEmptySpec(spec) ? "All posts" : "Search results")}
              {isEmptySpec(spec) && !activeView && (
                <Typography component="span" variant="body2" color="text.secondary"> · {SORTS.find(([s]) => s === effectiveSort(spec))?.[1].toLowerCase()} first</Typography>
              )}
            </Typography>
            {activeView ? (
              <FavoriteButton kind="view" id={activeView.id} name={activeView.name} size="small" />
            ) : onlyCollection ? (
              <FavoriteButton kind={onlyCollection.kind === "notebook" ? "notebook" : "collection"} id={onlyCollection.id} name={onlyCollection.name} size="small" />
            ) : null}
          </Stack>
          {/* Histogram strip */}
          <Box sx={{ pt: 1, pb: 0.5 }}>
            <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5, minHeight: 28 }}>
              <Typography variant="caption" color="text.secondary" sx={{ flex: 1 }}>
                Posts over time by {{ workDate: "work date", publishedAt: "publish date", updatedAt: "last update" }[histField]}
                {hist && ` · per ${hist.interval}`}
              </Typography>
              {selected && (
                <Button size="small" startIcon={<ZoomInRounded />} onClick={() => selected.from && selected.to && zoomTo({ from: addDays(selected.from, 0), to: selected.to })} sx={{ py: 0 }}>
                  Zoom to selection
                </Button>
              )}
              {spec.histogram?.bounds && (
                <Button size="small" startIcon={<ZoomOutRounded />} onClick={() => zoomTo(undefined)} sx={{ py: 0 }}>
                  Zoom out
                </Button>
              )}
              <TextField select size="small" variant="standard" value={spec.histogram?.interval ?? "auto"} onChange={(e) => setSpec({ ...spec, histogram: { field: histField, interval: e.target.value as Interval, bounds: spec.histogram?.bounds } })} slotProps={{ input: { disableUnderline: true, sx: { fontSize: "0.78rem" } } }} inputProps={{ "aria-label": "Histogram interval" }}>
                {INTERVALS.map((i) => <MenuItem key={i} value={i}>{i === "auto" ? `Auto${hist ? ` (${hist.interval})` : ""}` : i[0].toUpperCase() + i.slice(1)}</MenuItem>)}
              </TextField>
              <Tooltip title={showTable ? "Hide table" : "View as table"}>
                <IconButton size="small" onClick={() => setShowTable(!showTable)} aria-pressed={showTable} aria-label="View histogram as table">
                  <TableRowsOutlined sx={{ fontSize: 18 }} />
                </IconButton>
              </Tooltip>
            </Stack>
            {hist ? (
              <Histogram
                hist={hist}
                tags={tags}
                dimmed={dimmed}
                reducedMotion={me.preferences.reducedMotion}
                onSelect={selectRange}
                onClear={() => setSpec(setDateFilter(spec, histField, undefined))}
                onZoomBy={zoomBy}
              />
            ) : (
              <Skeleton variant="rounded" height={82} />
            )}
            {hist && showTable && <HistogramTable hist={hist} tags={tags} />}
          </Box>

          <Box sx={{ py: 1 }}>
            <ChipsBar
              spec={spec}
              setSpec={setSpec}
              total={first?.total}
              view={view}
              rangeLabel={selected}
              ctx={ctx}
              activeView={activeView}
              onAdvanced={() => setAdvanced(true)}
              onSave={() => setSaving(true)}
            />
          </Box>

          {isEmptySpec(spec) && first && first.total < 3 && <OnboardingChecklist hasPosts={first.total > 0} />}

          <Box sx={{ display: "grid", gridTemplateColumns: peek && xwide ? "minmax(0, 1fr) 400px" : "1fr", gap: 2, alignItems: "start" }}>
            <Box sx={{ minWidth: 0, opacity: dimmed ? 0.6 : 1, transition: "opacity 120ms" }}>
              {search.isPending ? (
                <Stack spacing={1}>{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} variant="rounded" height={84} />)}</Stack>
              ) : search.error && !first ? (
                <ErrorState error={search.error} onRetry={() => search.refetch()} />
              ) : first && first.total === 0 && !hits.length ? (
                isEmptySpec(spec) ? (
                  <EmptyState title="No posts yet" body="Press C to write the first one, or import slides from a PowerPoint deck." />
                ) : (
                  <EmptyState
                    title={view === "gallery" ? "No images match" : "No posts match"}
                    body={
                      suggestions.length ? (
                        <>
                          Try removing a filter:
                          <Stack spacing={0.5} sx={{ mt: 1 }}>
                            {suggestions.map((s) => (
                              <Button key={s.label} size="small" onClick={() => setSpec(s.spec)}>
                                Remove {s.label} → {s.total.toLocaleString()} {s.total === 1 ? "result" : "results"}
                              </Button>
                            ))}
                          </Stack>
                        </>
                      ) : (
                        "Nothing matches these filters together. Clear some filters or broaden the date range."
                      )
                    }
                    action={
                      spec.q?.trim() && can(role, "member") ? (
                        <Typography variant="body2" color="text.secondary">
                          In a slide deck? <Link component={RouterLink} to={wsPath(org, ws, "/import")}>Import slides</Link>
                        </Typography>
                      ) : undefined
                    }
                  />
                )
              ) : view === "gallery" ? (
                <GalleryGrid images={images} onEndReached={onEndReached} onOpen={setViewer} />
              ) : (
                <ResultsList
                  hits={hits}
                  people={people}
                  tags={tags}
                  focused={focused}
                  setFocused={setFocused}
                  comfortable={comfortable}
                  onEndReached={onEndReached}
                  onTagClick={(id) => setSpec(toggleFacetValue(spec, "tag", id, "include"))}
                  selection={selection}
                  origin={origin}
                  scrollKey={scrollKey}
                  restore={navType === "POP"}
                />
              )}
              {search.isFetchingNextPage && <Skeleton variant="rounded" height={64} sx={{ mt: 1 }} />}
              {search.error && first && (
                <Button size="small" sx={{ mt: 1 }} onClick={() => (search.refetch(), notify("Retrying…"))}>Couldn't load more. Retry</Button>
              )}
            </Box>
            {peek && xwide && <PeekPane postId={peek} people={people} tags={tags} onClose={() => setPeek(null)} origin={origin} />}
          </Box>
        </Box>
      </Box>

      {!wide && (
        <Drawer open={mobileFilters} onClose={() => setMobileFilters(false)} slotProps={{ paper: { sx: { width: 300 } } }}>
          {filters}
        </Drawer>
      )}
      {peek && !xwide && (
        <Drawer className="peek-drawer" anchor="right" open onClose={() => setPeek(null)} disableEnforceFocus disableAutoFocus slotProps={{ paper: { sx: { width: { xs: "100%", sm: 420 } } } }}>
          <PeekPane postId={peek} people={people} tags={tags} onClose={() => setPeek(null)} origin={origin} />
        </Drawer>
      )}
      {advanced && <AdvancedFilters open onClose={() => setAdvanced(false)} value={spec.where} onApply={(where) => setSpec({ ...spec, where, cursor: undefined })} ctx={ctx} />}
      {saving && (
        <SaveViewDialog
          open
          onClose={() => setSaving(false)}
          spec={spec}
          existing={activeView}
          onSaved={(v) => {
            notify(`Saved “${v.name}”`);
            const p = toSearchParams(spec);
            p.set("view", v.id);
            setParams(p, { replace: true });
          }}
        />
      )}
      <GalleryViewer img={viewer} onClose={() => setViewer(null)} origin={origin} />
      <SelectionTray selected={[...picked.keys()]} posts={picked} onClear={() => (setPicked(new Map()), setSelecting(false))} />
    </Box>
  );
}
