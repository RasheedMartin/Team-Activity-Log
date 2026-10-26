import { CloseRounded, VisibilityOffOutlined, VisibilityOutlined } from "@mui/icons-material";
import { Box, Divider, Drawer, FormControlLabel, IconButton, Stack, Switch, Tooltip, Typography } from "@mui/material";
import type { Presentation, Tag, User } from "../../api/contract";
import type { Slide } from "../../lib/slides";
import type { Theme } from "../../lib/themes";
import { SlideFrame } from "./SlideView";

// Owner request: choose what presents. Hide single slides, present only designed slides, and pick
// what the automatic title slide shows (or skip it right before a designed slide). Saved like the
// theme: with the notebook / deck, or the post.

const FIELDS: { key: "date" | "author" | "summary" | "tags"; label: string }[] = [
  { key: "date", label: "Date" },
  { key: "author", label: "Author" },
  { key: "summary", label: "Subtitle" },
  { key: "tags", label: "Tags" },
];

export function SlidesPanel({
  open,
  onClose,
  all,
  shown,
  pres,
  onChange,
  scope,
  people,
  tags,
}: {
  open: boolean;
  onClose: () => void;
  all: { slide: Slide; theme: Theme }[];
  shown: Set<string>;
  pres: Presentation;
  onChange: (patch: Partial<Presentation>) => void;
  scope: string;
  people: Map<string, User>;
  tags: Map<string, Tag>;
}) {
  const t = pres.titleSlide ?? {};
  const hidden = new Set(pres.hidden ?? []);
  const setTitle = (patch: NonNullable<Presentation["titleSlide"]>) => onChange({ titleSlide: { ...t, ...patch } });
  const toggle = (key: string) => onChange({ hidden: hidden.has(key) ? [...hidden].filter((k) => k !== key) : [...hidden, key] });
  return (
    <Drawer anchor="right" open={open} onClose={onClose} sx={{ zIndex: (th) => th.zIndex.modal + 1 }} slotProps={{ paper: { sx: { width: { xs: "100%", sm: 380 } } } }}>
      <Stack direction="row" alignItems="center" sx={{ px: 2, pt: 1.5 }}>
        <Typography variant="h4" sx={{ flex: 1 }}>Slides</Typography>
        <IconButton onClick={onClose} aria-label="Close slide settings"><CloseRounded /></IconButton>
      </Stack>
      <Typography variant="caption" color="text.secondary" sx={{ px: 2 }}>{scope}</Typography>
      <Stack sx={{ px: 2, py: 1.5 }} spacing={0.5}>
        <FormControlLabel control={<Switch checked={!!pres.onlyDesigned} onChange={(e) => onChange({ onlyDesigned: e.target.checked })} />} label="Only designed slides" />
        <Typography variant="overline" color="text.secondary" sx={{ pt: 1 }}>Title slides</Typography>
        <FormControlLabel control={<Switch checked={!t.hide} onChange={(e) => setTitle({ hide: !e.target.checked })} />} label="Show a title slide for each post" />
        {!t.hide && (
          <>
            <Stack direction="row" useFlexGap sx={{ flexWrap: "wrap", pl: 1 }}>
              {FIELDS.map((f) => (
                <FormControlLabel key={f.key} control={<Switch size="small" checked={t[f.key] !== false} onChange={(e) => setTitle({ [f.key]: e.target.checked })} />} label={f.label} sx={{ mr: 2 }} />
              ))}
            </Stack>
            <FormControlLabel control={<Switch checked={!!t.skipBeforeDesigned} onChange={(e) => setTitle({ skipBeforeDesigned: e.target.checked })} />} label="Skip it when the post starts with a designed slide" />
          </>
        )}
      </Stack>
      <Divider />
      <Typography variant="overline" color="text.secondary" sx={{ px: 2, pt: 1.5 }}>
        {shown.size} of {all.length} slides present
      </Typography>
      <Box component="ul" aria-label="All slides" sx={{ listStyle: "none", m: 0, p: 2, pt: 1, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1.5, overflow: "auto" }}>
        {all.map(({ slide, theme }, i) => {
          const key = slide.key ?? String(i);
          const on = shown.has(key);
          const manual = hidden.has(key);
          return (
            <Box component="li" key={key} sx={{ position: "relative" }}>
              <Box sx={{ aspectRatio: "16 / 9", borderRadius: 0.5, overflow: "hidden", opacity: on ? 1 : 0.35, border: 1, borderColor: "divider" }}>
                <SlideFrame slide={slide} people={people} tags={tags} theme={theme} />
              </Box>
              <Stack direction="row" alignItems="center" spacing={0.5}>
                <Typography variant="caption" color="text.secondary" sx={{ flex: 1 }}>
                  {i + 1}
                  {!on && !manual && " · skipped by settings"}
                </Typography>
                <Tooltip title={manual ? "Show this slide" : "Hide this slide"}>
                  <IconButton size="small" onClick={() => toggle(key)} aria-label={`${manual ? "Show" : "Hide"} slide ${i + 1}`} aria-pressed={manual}>
                    {manual ? <VisibilityOffOutlined fontSize="small" /> : <VisibilityOutlined fontSize="small" />}
                  </IconButton>
                </Tooltip>
              </Stack>
            </Box>
          );
        })}
      </Box>
    </Drawer>
  );
}
