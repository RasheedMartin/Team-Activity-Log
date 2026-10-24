import { CheckRounded, ExpandLessRounded, ExpandMoreRounded, SearchRounded } from "@mui/icons-material";
import { Box, Button, ButtonBase, InputAdornment, InputBase, Stack, ToggleButton, ToggleButtonGroup, Typography, useTheme } from "@mui/material";
import { useMemo, useState, type KeyboardEvent, type ReactNode } from "react";
import type { DateField, DatePreset, FacetBucket, FilterSpec, ID, SearchResponse, Tag, TagGroup, User } from "../../api/contract";
import { PRESET_LABELS } from "../../lib/dates";
import {
  excludedIds,
  findCondition,
  getDateFilter,
  hasFlag,
  includedIds,
  setDateFilter,
  setFlag,
  setTagMatchMode,
  tagMatchMode,
  toggleFacetValue,
} from "../../lib/filterSpec";
import { TagDot, UserAvatar } from "../../components/ui";
import { IMAGE_TYPE_LABELS } from "./fields";

const DATE_FIELD_LABEL: Record<DateField, string> = { workDate: "Work date", publishedAt: "Published", updatedAt: "Updated" };
const PRESETS: (DatePreset | "all")[] = ["all", "today", "last_7_days", "last_30_days", "this_quarter", "this_year"];

function Section({ title, children, right, defaultOpen = true }: { title: string; children: ReactNode; right?: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Box component="section" aria-label={title} sx={{ py: 1.25, borderBottom: 1, borderColor: "divider" }}>
      <Stack direction="row" alignItems="center" sx={{ px: 2, mb: open ? 0.75 : 0 }}>
        <ButtonBase onClick={() => setOpen(!open)} aria-expanded={open} sx={{ flex: 1, justifyContent: "flex-start", gap: 0.5, borderRadius: 0.5 }}>
          <Typography variant="overline" color="text.secondary">{title}</Typography>
          {open ? <ExpandLessRounded sx={{ fontSize: 16, color: "text.disabled" }} /> : <ExpandMoreRounded sx={{ fontSize: 16, color: "text.disabled" }} />}
        </ButtonBase>
        {right}
      </Stack>
      {open && children}
    </Box>
  );
}

/** Arrow keys move between facet rows (§W4.4 keyboard). */
function onListKeys(e: KeyboardEvent<HTMLElement>) {
  if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
  const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>("[data-facet-item]"));
  const i = items.indexOf(document.activeElement as HTMLElement);
  if (i < 0) return;
  e.preventDefault();
  items[Math.max(0, Math.min(items.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)))]?.focus();
}

/** One facet row: click = include, Alt/Option-click (or X) = exclude; count with a quiet bar. */
function FacetRow({ label, icon, count, max, state, onInclude, onExclude }: { label: ReactNode; icon?: ReactNode; count: number; max: number; state: "include" | "exclude" | null; onInclude: () => void; onExclude: () => void }) {
  const theme = useTheme();
  const dim = count === 0 && !state;
  return (
    <ButtonBase
      data-facet-item
      role="checkbox"
      aria-checked={state === "include" ? true : state === "exclude" ? "mixed" : false}
      aria-label={`${typeof label === "string" ? label : ""} ${count}${state === "exclude" ? ", excluded" : ""}`}
      title="Click to include · Alt-click (or X) to exclude"
      onClick={(e) => (e.altKey ? onExclude() : onInclude())}
      onKeyDown={(e) => {
        if (e.key.toLowerCase() === "x") {
          e.preventDefault();
          onExclude();
        }
      }}
      sx={{ width: "100%", px: 2, py: 0.4, gap: 1, justifyContent: "flex-start", opacity: dim ? 0.45 : 1, "&:hover": { bgcolor: "action.hover" }, "&:focus-visible": { bgcolor: "action.focus" } }}
    >
      <Box sx={{ width: 16, height: 16, flexShrink: 0, borderRadius: 0.5, border: 1, borderColor: state ? "primary.main" : "divider", bgcolor: state === "include" ? "primary.main" : "transparent", color: "primary.contrastText", display: "grid", placeItems: "center" }}>
        {state === "include" && <CheckRounded sx={{ fontSize: 13 }} />}
        {state === "exclude" && <Box sx={{ width: 8, height: 2, bgcolor: "primary.main" }} />}
      </Box>
      {icon}
      <Typography variant="body2" noWrap sx={{ flex: 1, textAlign: "left", textDecoration: state === "exclude" ? "line-through" : "none", fontWeight: state === "include" ? 600 : 400 }}>
        {label}
      </Typography>
      <Box sx={{ width: 28, height: 4, borderRadius: 2, bgcolor: "action.hover", overflow: "hidden", flexShrink: 0 }} aria-hidden>
        <Box sx={{ width: `${max ? (count / max) * 100 : 0}%`, height: "100%", bgcolor: theme.palette.chart.barMuted }} />
      </Box>
      <Typography variant="caption" color="text.secondary" sx={{ minWidth: 28, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
        {count.toLocaleString()}
      </Typography>
    </ButtonBase>
  );
}

interface Props {
  spec: FilterSpec;
  setSpec: (s: FilterSpec) => void;
  facets?: SearchResponse["facets"];
  tags: Tag[];
  groups: TagGroup[];
  people: Map<ID, User>;
  meId: ID;
  histField: DateField;
  onHistField: (f: DateField) => void;
}

export function FilterSidebar({ spec, setSpec, facets, tags, groups, people, meId, histField, onHistField }: Props) {
  const [tagQ, setTagQ] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const date = getDateFilter(spec);
  const activePreset = !date ? "all" : "preset" in date.value ? date.value.preset : "custom";
  const absRange = date && !("preset" in date.value) ? date.value : {};

  const tagCounts = useMemo(() => new Map(facets?.tags.map((b) => [b.value, b.count])), [facets]);
  const incTags = includedIds(spec, "tag");
  const excTags = excludedIds(spec, "tag");
  const tagState = (id: ID) => (incTags.includes(id) ? "include" : excTags.includes(id) ? "exclude" : null);
  const maxTag = Math.max(1, ...(facets?.tags.map((b) => b.count) ?? [1]));

  const grouped = useMemo(() => {
    const q = tagQ.trim().toLowerCase();
    const byGroup = new Map<string, Tag[]>();
    for (const t of tags) {
      if (q && !t.name.toLowerCase().includes(q)) continue;
      const g = groups.find((x) => x.id === t.groupId)?.name ?? "Other";
      byGroup.set(g, [...(byGroup.get(g) ?? []), t]);
    }
    for (const list of byGroup.values()) list.sort((a, b) => (tagCounts.get(b.id) ?? 0) - (tagCounts.get(a.id) ?? 0) || a.name.localeCompare(b.name));
    return [...byGroup.entries()];
  }, [tags, groups, tagQ, tagCounts]);

  const incPeople = includedIds(spec, "author");
  const excPeople = excludedIds(spec, "author");
  const authorBuckets: FacetBucket[] = useMemo(() => {
    const list = [...(facets?.authors ?? [])];
    if (!list.some((b) => b.value === meId)) list.push({ value: meId, count: 0 });
    return list.sort((a, b) => (a.value === meId ? -1 : b.value === meId ? 1 : b.count - a.count));
  }, [facets, meId]);
  const maxAuthor = Math.max(1, ...authorBuckets.map((b) => b.count));

  const typeIds = (findCondition(spec, "all", "image.type")?.value as string[] | undefined) ?? [];
  const maxType = Math.max(1, ...(facets?.imageTypes.map((b) => b.count) ?? [1]));

  return (
    <Box sx={{ pb: 4 }}>
      <Section
        title="Date"
        right={
          <ToggleButtonGroup size="small" exclusive value={histField} onChange={(_, v) => v && onHistField(v)} aria-label="Date field" sx={{ "& .MuiToggleButton-root": { py: 0, px: 0.75, fontSize: "0.7rem", textTransform: "none" } }}>
            {(["workDate", "publishedAt", "updatedAt"] as DateField[]).map((f) => (
              <ToggleButton key={f} value={f}>{DATE_FIELD_LABEL[f].replace(" date", "")}</ToggleButton>
            ))}
          </ToggleButtonGroup>
        }
      >
        <Box role="radiogroup" aria-label="Date range">
          {PRESETS.map((p) => {
            const on = activePreset === p;
            return (
              <ButtonBase
                key={p}
                role="radio"
                aria-checked={on}
                onClick={() => setSpec(setDateFilter(spec, histField, p === "all" ? undefined : { preset: p }))}
                sx={{ width: "100%", px: 2, py: 0.4, justifyContent: "flex-start", gap: 1, "&:hover": { bgcolor: "action.hover" } }}
              >
                <Box sx={{ width: 16, display: "grid", placeItems: "center" }}>{on && <CheckRounded sx={{ fontSize: 16, fontWeight: 700, color: "primary.main" }} />}</Box>
                <Typography variant="body2" sx={{ fontWeight: on ? 600 : 400 }}>{p === "all" ? "All time" : PRESET_LABELS[p]}</Typography>
              </ButtonBase>
            );
          })}
        </Box>
        <Box sx={{ mx: 2, mt: 1, pt: 1, borderTop: 1, borderColor: "divider" }}>
          <Typography variant="caption" color="text.secondary" sx={{ fontWeight: activePreset === "custom" ? 600 : 400 }}>Custom range</Typography>
          <Stack spacing={0.5} sx={{ mt: 0.5 }}>
            {(["from", "to"] as const).map((k) => (
              <InputBase
                key={k}
                type="date"
                value={absRange[k] ?? ""}
                onChange={(e) => setSpec(setDateFilter(spec, histField, { ...absRange, [k]: e.target.value || undefined }))}
                inputProps={{ "aria-label": k === "from" ? "From date" : "To date" }}
                sx={{ fontSize: "0.78rem", border: 1, borderColor: "divider", borderRadius: 1, px: 0.75 }}
              />
            ))}
          </Stack>
        </Box>
      </Section>

      <Section
        title="Tags"
        right={
          incTags.length > 1 ? (
            <ToggleButtonGroup size="small" exclusive value={tagMatchMode(spec)} onChange={(_, v) => v && setSpec(setTagMatchMode(spec, v))} aria-label="Tag match mode" sx={{ "& .MuiToggleButton-root": { py: 0, px: 0.75, fontSize: "0.7rem", textTransform: "none" } }}>
              <ToggleButton value="any">Any</ToggleButton>
              <ToggleButton value="all">All</ToggleButton>
            </ToggleButtonGroup>
          ) : undefined
        }
      >
        <Box sx={{ px: 2, mb: 0.5 }}>
          <InputBase
            placeholder="Filter tags"
            value={tagQ}
            onChange={(e) => setTagQ(e.target.value)}
            startAdornment={<InputAdornment position="start"><SearchRounded sx={{ fontSize: 16 }} /></InputAdornment>}
            inputProps={{ "aria-label": "Filter tags" }}
            sx={{ width: "100%", fontSize: "0.82rem", border: 1, borderColor: "divider", borderRadius: 1, px: 1 }}
          />
        </Box>
        <Box onKeyDown={onListKeys}>
          {grouped.map(([group, list]) => {
            const limit = expanded[group] || tagQ ? list.length : 6;
            const shown = list.filter((t, i) => i < limit || tagState(t.id));
            return (
              <Box key={group} sx={{ mb: 0.5 }}>
                {grouped.length > 1 && <Typography variant="caption" color="text.disabled" sx={{ px: 2, display: "block", fontWeight: 600 }}>{group}</Typography>}
                {shown.map((t) => (
                  <FacetRow
                    key={t.id}
                    label={t.name}
                    icon={<TagDot color={t.color} />}
                    count={tagCounts.get(t.id) ?? 0}
                    max={maxTag}
                    state={tagState(t.id)}
                    onInclude={() => setSpec(toggleFacetValue(spec, "tag", t.id, "include"))}
                    onExclude={() => setSpec(toggleFacetValue(spec, "tag", t.id, "exclude"))}
                  />
                ))}
                {list.length > 6 && !tagQ && (
                  <Button size="small" onClick={() => setExpanded({ ...expanded, [group]: !expanded[group] })} sx={{ ml: 1.5, fontSize: "0.72rem" }}>
                    {expanded[group] ? "Show fewer" : `Show all ${list.length}`}
                  </Button>
                )}
              </Box>
            );
          })}
        </Box>
      </Section>

      <Section title="People">
        <Stack direction="row" spacing={0.5} sx={{ px: 2, mb: 0.75, flexWrap: "wrap", rowGap: 0.5 }}>
          {([
            ["mine", "Mine"],
            ["iCommented", "I commented"],
            ["mentionsMe", "Mentions me"],
          ] as const).map(([f, label]) => {
            const on = hasFlag(spec, f);
            return (
              <Button key={f} size="small" variant={on ? "contained" : "outlined"} onClick={() => setSpec(setFlag(spec, f, !on))} sx={{ py: 0, px: 1, minWidth: 0, fontSize: "0.72rem", fontWeight: on ? 600 : 400 }} aria-pressed={on}>
                {label}
              </Button>
            );
          })}
        </Stack>
        <Box onKeyDown={onListKeys}>
          {authorBuckets.map((b) => {
            const u = people.get(b.value);
            return (
              <FacetRow
                key={b.value}
                label={b.value === meId ? `Me${u ? ` (${u.name.split(" ")[0]})` : ""}` : u?.name ?? "…"}
                icon={<UserAvatar user={u} size={18} />}
                count={b.count}
                max={maxAuthor}
                state={incPeople.includes(b.value) ? "include" : excPeople.includes(b.value) ? "exclude" : null}
                onInclude={() => setSpec(toggleFacetValue(spec, "author", b.value, "include"))}
                onExclude={() => setSpec(toggleFacetValue(spec, "author", b.value, "exclude"))}
              />
            );
          })}
        </Box>
      </Section>

      <Section title="Image type" defaultOpen={false}>
        <Box onKeyDown={onListKeys}>
          {facets?.imageTypes.map((b) => {
            const on = typeIds.includes(b.value);
            return (
              <FacetRow
                key={b.value}
                label={IMAGE_TYPE_LABELS[b.value] ?? b.value}
                count={b.count}
                max={maxType}
                state={on ? "include" : null}
                onInclude={() => {
                  const next = on ? typeIds.filter((x) => x !== b.value) : [...typeIds, b.value];
                  const kept = (spec.all ?? []).filter((c) => c.field !== "image.type");
                  setSpec({ ...spec, all: next.length ? [...kept, { field: "image.type", op: "in", value: next }] : kept.length ? kept : undefined, cursor: undefined });
                }}
                onExclude={() => {}}
              />
            );
          })}
        </Box>
      </Section>
    </Box>
  );
}
