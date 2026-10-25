import { AlternateEmailRounded, ChatBubbleOutlineRounded, CheckCircleRounded, ImageOutlined, PlaceRounded, SearchRounded, SlideshowRounded, UploadFileOutlined } from "@mui/icons-material";
import { Box, Paper, Stack, Typography, useMediaQuery } from "@mui/material";
import { alpha } from "@mui/material/styles";
import { useEffect, useState, type ReactNode } from "react";
import { TagDot } from "../../components/ui";

// Scripted, self-playing previews of the product, one per feature on the landing page (clicking a
// feature plays its scene here). Static data, no network: decoration with a text alternative, not
// a live widget. With reduced motion, each scene shows its finished state.

export type DemoScene = "write" | "search" | "import" | "discuss" | "notebook" | "present";

const ALT: Record<DemoScene, string> = {
  write: "Preview of writing a post: a title and notes type themselves, a plot is added, and it saves.",
  search: "Preview of Search: a query narrows thousands of posts to a few, with a timeline of when they were written.",
  import: "Preview of importing slides: a PowerPoint deck's slides become searchable posts, one by one.",
  discuss: "Preview of a discussion: comments, a mention, and a comment pinned to a point on a figure.",
  notebook: "Preview of a notebook: posts in order, read start to finish.",
  present: "Preview of presenting: posts shown as slides, advancing one by one.",
};

const mono = "'IBM Plex Mono', ui-monospace, monospace";

/** A counter from 0 to `steps - 1`, advancing every `ms`, then holding and starting over. */
function useTicker(steps: number, ms: number, reduced: boolean, key: unknown) {
  const [t, setT] = useState(reduced ? steps - 1 : 0);
  useEffect(() => setT(reduced ? steps - 1 : 0), [key, reduced, steps]);
  useEffect(() => {
    if (reduced) return;
    const id = setTimeout(() => setT((n) => (n + 1 < steps ? n + 1 : 0)), t === steps - 1 ? ms * 6 : ms);
    return () => clearTimeout(id);
  }, [t, steps, ms, reduced]);
  return t;
}

const appear = (on: boolean, reduced: boolean) => ({ opacity: on ? 1 : 0, transform: on || reduced ? "none" : "translateY(6px)", transition: reduced ? undefined : "opacity 300ms, transform 300ms" });

function Bars({ values, height = 44 }: { values: number[]; height?: number }) {
  const max = Math.max(...values);
  return (
    <Stack direction="row" alignItems="flex-end" spacing="3px" sx={{ height }}>
      {values.map((b, i) => <Box key={i} sx={{ flex: 1, height: `${(b / max) * 100}%`, bgcolor: "chart.bar", borderRadius: "3px 3px 0 0" }} />)}
    </Stack>
  );
}

// ---- Find anything (the original demo) ----

type Result = { title: string; tag: [string, string]; who: string; when: string; comments: number; images: number };
const SCRIPT: { q: string; bars: number[]; results: Result[] }[] = [
  {
    q: "drift OR noise",
    bars: [2, 3, 5, 4, 7, 9, 6, 8, 12, 10, 7, 5],
    results: [
      { title: "Detector B noise after shielding", tag: ["noise", "#c2410c"], who: "Priya R.", when: "2d", comments: 6, images: 3 },
      { title: "Gain drift on channel 12, week 3", tag: ["calibration", "#2563eb"], who: "Dana O.", when: "5d", comments: 2, images: 1 },
      { title: "Pedestal width vs. ground strap", tag: ["noise", "#c2410c"], who: "Marcus L.", when: "1w", comments: 4, images: 2 },
    ],
  },
  {
    q: "tag:calibration gain",
    bars: [1, 1, 2, 6, 8, 3, 2, 1, 4, 7, 9, 4],
    results: [
      { title: "Calibration results, Co-60 source", tag: ["calibration", "#2563eb"], who: "Felix B.", when: "1d", comments: 3, images: 2 },
      { title: "Gain map after firmware update", tag: ["calibration", "#2563eb"], who: "Amara N.", when: "3d", comments: 1, images: 4 },
      { title: "Question: why is ch 13 low?", tag: ["question", "#7c3aed"], who: "Kwame M.", when: "4d", comments: 9, images: 0 },
    ],
  },
  {
    q: "\"cooldown\" NOT draft",
    bars: [6, 8, 4, 2, 1, 1, 3, 5, 2, 1, 2, 6],
    results: [
      { title: "Cryostat 2 cooldown curve", tag: ["cryo", "#0f766e"], who: "Dana O.", when: "6h", comments: 2, images: 1 },
      { title: "Cooldown overview, March run", tag: ["cryo", "#0f766e"], who: "Priya R.", when: "2w", comments: 0, images: 1 },
      { title: "Pump schedule for the next cooldown", tag: ["planning", "#a16207"], who: "Felix B.", when: "3w", comments: 5, images: 0 },
    ],
  },
];

function ResultCard({ r }: { r: Result }) {
  return (
    <Box sx={{ p: 1.25, border: 1, borderColor: "divider", borderRadius: 1.5, bgcolor: "background.paper" }}>
      <Stack direction="row" justifyContent="space-between" spacing={1}>
        <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>{r.title}</Typography>
        <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>{r.when}</Typography>
      </Stack>
      <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mt: 0.5, color: "text.secondary" }}>
        <Stack direction="row" spacing={0.5} alignItems="center"><TagDot color={r.tag[1]} /><Typography variant="caption">{r.tag[0]}</Typography></Stack>
        <Typography variant="caption">{r.who}</Typography>
        <Box sx={{ flex: 1 }} />
        {r.images > 0 && <Stack direction="row" spacing={0.25} alignItems="center"><ImageOutlined sx={{ fontSize: 14 }} /><Typography variant="caption">{r.images}</Typography></Stack>}
        <Stack direction="row" spacing={0.25} alignItems="center"><ChatBubbleOutlineRounded sx={{ fontSize: 14 }} /><Typography variant="caption">{r.comments}</Typography></Stack>
      </Stack>
    </Box>
  );
}

function SearchScene({ reduced }: { reduced: boolean }) {
  const [step, setStep] = useState(0);
  const [typed, setTyped] = useState(reduced ? SCRIPT[0].q.length : 0);
  const scene = SCRIPT[step];
  const done = typed >= scene.q.length;
  useEffect(() => {
    if (reduced) return;
    const t = done ? setTimeout(() => (setStep((s) => (s + 1) % SCRIPT.length), setTyped(0)), 3200) : setTimeout(() => setTyped((n) => n + 1), 70);
    return () => clearTimeout(t);
  }, [done, typed, reduced]);
  return (
    <>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ px: 1.25, py: 0.9, border: 1, borderColor: "primary.main", borderRadius: 1.5, boxShadow: (t) => `0 0 0 3px ${alpha(t.palette.primary.main, 0.15)}` }}>
        <SearchRounded fontSize="small" sx={{ color: "text.secondary" }} />
        <Typography sx={{ fontFamily: mono, fontSize: "0.9rem", whiteSpace: "pre" }}>
          {scene.q.slice(0, typed)}
          {!reduced && <Box component="span" sx={{ borderLeft: 2, borderColor: "primary.main", ml: "1px", animation: "blink 1s steps(1) infinite", "@keyframes blink": { "50%": { opacity: 0 } } }} />}
        </Typography>
      </Stack>
      <Box sx={{ mt: 2, mb: 0.5, opacity: done ? 1 : 0.35, transition: reduced ? undefined : "opacity 300ms" }}>
        <Bars values={scene.bars} />
      </Box>
      <Typography variant="caption" color="text.secondary">{done ? `${scene.results.length * 7 + step * 5} posts` : "Searching 5,000 posts…"}</Typography>
      <Stack spacing={1} sx={{ mt: 1, opacity: done ? 1 : 0.35, transition: reduced ? undefined : "opacity 300ms" }}>
        {scene.results.map((r) => <ResultCard key={r.title} r={r} />)}
      </Stack>
    </>
  );
}

// ---- Write it up ----

const TITLE = "Cryostat 2 cooldown, run 4512";
const LINES = ["Reached 4.1 K after 9 hours.", "Pump schedule held; no ice on the cold head."];

function WriteScene({ reduced }: { reduced: boolean }) {
  const total = TITLE.length + LINES.join("").length + 4;
  const t = useTicker(total, 45, reduced, "write");
  const title = TITLE.slice(0, Math.min(t, TITLE.length));
  let rest = Math.max(0, t - TITLE.length);
  const lines = LINES.map((l) => {
    const s = l.slice(0, rest);
    rest = Math.max(0, rest - l.length);
    return s;
  });
  const plot = t >= total - 3;
  const saved = t >= total - 1;
  return (
    <Stack spacing={1.25}>
      <Stack direction="row" alignItems="center" spacing={1}>
        <Box sx={{ px: 0.75, py: 0.1, borderRadius: 0.75, bgcolor: "warning.light", color: "warning.contrastText", fontSize: 11, fontWeight: 700 }}>DRAFT</Box>
        <Typography variant="caption" color="text.secondary" sx={{ flex: 1 }}>{saved ? "Saved just now" : "Saving…"}</Typography>
        <Box sx={{ px: 1.25, py: 0.4, borderRadius: 1, bgcolor: "primary.main", color: "primary.contrastText", fontSize: 12, fontWeight: 600 }}>Publish</Box>
      </Stack>
      <Typography sx={{ fontWeight: 700, fontSize: "1.15rem", minHeight: "1.6em" }}>{title || <Box component="span" sx={{ color: "text.disabled" }}>Title</Box>}</Typography>
      <Stack spacing={0.25} sx={{ minHeight: 44 }}>
        {lines.map((l, i) => <Typography key={i} variant="body2">{l}</Typography>)}
      </Stack>
      <Box sx={{ p: 1.25, border: 1, borderColor: "divider", borderRadius: 1.5, ...appear(plot, reduced) }}>
        <Bars values={[9, 8, 7, 6, 5, 4, 3, 2.4, 1.8, 1.4, 1.2, 1.1]} height={60} />
        <Typography variant="caption" color="text.secondary">Fig. 1 · Temperature during cooldown</Typography>
      </Box>
      <Stack direction="row" spacing={0.75} sx={appear(saved, reduced)}>
        <Stack direction="row" spacing={0.5} alignItems="center"><TagDot color="#0f766e" /><Typography variant="caption">cryo</Typography></Stack>
        <Stack direction="row" spacing={0.5} alignItems="center"><TagDot color="#a16207" /><Typography variant="caption">planning</Typography></Stack>
      </Stack>
    </Stack>
  );
}

// ---- Import slides ----

const SLIDES = ["Cooldown overview", "Cooldown curve", "Calibration results", "Gain plot", "Next steps"];

function ImportScene({ reduced }: { reduced: boolean }) {
  const t = useTicker(SLIDES.length + 2, 650, reduced, "import");
  return (
    <Stack spacing={1.25}>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ p: 1.25, border: 1, borderStyle: "dashed", borderColor: "primary.main", borderRadius: 1.5, bgcolor: (th) => alpha(th.palette.primary.main, 0.05) }}>
        <UploadFileOutlined sx={{ color: "primary.main" }} />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>Lab_Notes_March.pptx</Typography>
          <Box sx={{ mt: 0.5, height: 4, borderRadius: 2, bgcolor: "divider", overflow: "hidden" }}>
            <Box sx={{ height: "100%", width: `${Math.min(100, (t / SLIDES.length) * 100)}%`, bgcolor: "primary.main", transition: reduced ? undefined : "width 500ms" }} />
          </Box>
        </Box>
        <Typography variant="caption" color="text.secondary">{Math.min(t, SLIDES.length)} / {SLIDES.length}</Typography>
      </Stack>
      <Box sx={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 1 }}>
        {SLIDES.map((s, i) => (
          <Box key={s} sx={{ p: 1, border: 1, borderColor: "divider", borderRadius: 1.5, bgcolor: "background.paper", ...appear(t > i, reduced) }}>
            <Box sx={{ aspectRatio: "16 / 9", borderRadius: 1, bgcolor: "action.hover", mb: 0.75, p: 0.75 }}>
              <Box sx={{ width: "55%", height: 5, borderRadius: 1, bgcolor: "text.disabled", mb: 0.5 }} />
              {i % 2 ? <Bars values={[2, 4, 3, 6, 5, 8]} height={22} /> : [70, 50].map((w) => <Box key={w} sx={{ width: `${w}%`, height: 3, borderRadius: 1, bgcolor: "divider", mb: 0.4 }} />)}
            </Box>
            <Stack direction="row" alignItems="center" spacing={0.5}>
              <Typography variant="caption" sx={{ fontWeight: 600, flex: 1 }} noWrap>{s}</Typography>
              {t > SLIDES.length && <CheckCircleRounded sx={{ fontSize: 14, color: "success.main" }} />}
            </Stack>
          </Box>
        ))}
        <Stack justifyContent="center" alignItems="center" sx={{ p: 1, borderRadius: 1.5, ...appear(t > SLIDES.length, reduced) }}>
          <Typography variant="caption" color="text.secondary" align="center">5 posts, searchable</Typography>
        </Stack>
      </Box>
    </Stack>
  );
}

// ---- Discuss ----

const THREAD = [
  { who: "Marcus L.", text: "Why is the drift larger on the east side?", question: true },
  { who: "Priya R.", text: "Probably the cold head is closer there." },
  { who: "Dana O.", text: "@Felix can you check the temperature log?", mention: true },
];

function DiscussScene({ reduced }: { reduced: boolean }) {
  const t = useTicker(THREAD.length + 2, 1100, reduced, "discuss");
  return (
    <Stack spacing={1.25}>
      <Box sx={{ position: "relative", p: 1.25, border: 1, borderColor: "divider", borderRadius: 1.5 }}>
        <Typography variant="body2" sx={{ fontWeight: 600, mb: 1 }}>Gain drift on channel 12, week 3</Typography>
        <Bars values={[3, 3.2, 3.5, 3.4, 4, 4.6, 5.1, 5.6, 6.2, 6.4, 7.1, 7.5]} height={56} />
        <Box sx={{ position: "absolute", right: "22%", top: 36, color: "error.main", ...appear(t >= THREAD.length + 1, reduced) }}>
          <PlaceRounded />
        </Box>
      </Box>
      {THREAD.map((c, i) => (
        <Stack key={i} direction="row" spacing={1} sx={{ pl: i ? 2 : 0, ...appear(t > i, reduced) }}>
          <Box sx={{ width: 22, height: 22, borderRadius: "50%", flexShrink: 0, bgcolor: ["#c2410c", "#2563eb", "#0f766e"][i], color: "#fff", fontSize: 10, fontWeight: 700, display: "grid", placeItems: "center" }}>{c.who[0]}</Box>
          <Box>
            <Typography variant="caption" sx={{ fontWeight: 700 }}>
              {c.who} {c.question && <Box component="span" sx={{ ml: 0.5, px: 0.5, borderRadius: 0.5, bgcolor: "action.selected", fontWeight: 600 }}>Question</Box>}
            </Typography>
            <Typography variant="body2">
              {c.mention ? (
                <>
                  <Box component="span" sx={{ color: "primary.main", fontWeight: 600 }}>
                    <AlternateEmailRounded sx={{ fontSize: 13, verticalAlign: "-2px" }} />Felix
                  </Box>
                  {c.text.replace("@Felix", "")}
                </>
              ) : (
                c.text
              )}
            </Typography>
          </Box>
        </Stack>
      ))}
      <Typography variant="caption" color="text.secondary" sx={appear(t >= THREAD.length + 1, reduced)}>Pinned on the figure: “this step at week 3”</Typography>
    </Stack>
  );
}

// ---- Notebooks ----

const ENTRIES = ["Cooldown overview", "Calibration results", "Gain drift, week 3", "What we changed"];

function NotebookScene({ reduced }: { reduced: boolean }) {
  const t = useTicker(ENTRIES.length + 1, 900, reduced, "notebook");
  return (
    <Stack spacing={1}>
      <Stack direction="row" alignItems="baseline" spacing={1}>
        <Typography sx={{ fontWeight: 700, fontSize: "1.05rem", flex: 1 }}>March run, start to finish</Typography>
        <Typography variant="caption" color="text.secondary">Entry {Math.max(1, Math.min(t, ENTRIES.length))} of {ENTRIES.length}</Typography>
      </Stack>
      {ENTRIES.map((e, i) => (
        <Stack key={e} direction="row" spacing={1.25} alignItems="center" sx={{ p: 1.25, border: 1, borderColor: t === i + 1 ? "primary.main" : "divider", borderRadius: 1.5, bgcolor: "background.paper", ...appear(t > i, reduced) }}>
          <Typography sx={{ fontFamily: mono, color: "primary.main", fontWeight: 600 }}>{i + 1}</Typography>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>{e}</Typography>
            <Box sx={{ mt: 0.5, width: `${60 + ((i * 13) % 30)}%`, height: 3, borderRadius: 1, bgcolor: "divider" }} />
          </Box>
        </Stack>
      ))}
    </Stack>
  );
}

// ---- Present ----

const DECK = [
  { title: "Detector B noise", bars: [8, 7, 6, 4, 3, 2, 2, 1.5] },
  { title: "After shielding", bars: [3, 2.5, 2, 1.6, 1.4, 1.2, 1.1, 1] },
  { title: "Next steps", bars: [] as number[] },
];

function PresentScene({ reduced }: { reduced: boolean }) {
  const t = useTicker(DECK.length, 1800, reduced, "present");
  const s = DECK[t];
  return (
    <Stack spacing={1}>
      <Box sx={{ aspectRatio: "16 / 9", borderRadius: 1.5, bgcolor: "#0f172a", color: "#fff", p: 2, display: "flex", flexDirection: "column", justifyContent: "center" }}>
        <Box key={t} sx={{ animation: reduced ? undefined : "slideIn 350ms ease-out", "@keyframes slideIn": { from: { opacity: 0, transform: "translateX(12px)" }, to: { opacity: 1, transform: "none" } } }}>
          <Box sx={{ width: 36, height: 4, borderRadius: 1, bgcolor: "#2dd4bf", mb: 1 }} />
          <Typography sx={{ fontWeight: 700, fontSize: "1.2rem", mb: 1.25 }}>{s.title}</Typography>
          {s.bars.length ? (
            <Box sx={{ "& > div > div": { bgcolor: "#2dd4bf !important" } }}>
              <Bars values={s.bars} height={54} />
            </Box>
          ) : (
            ["Repeat with shielding in place", "Write up for the group meeting"].map((l) => (
              <Typography key={l} variant="body2" sx={{ opacity: 0.85 }}>• {l}</Typography>
            ))
          )}
        </Box>
      </Box>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ color: "text.secondary" }}>
        <SlideshowRounded fontSize="small" />
        <Typography variant="caption" sx={{ flex: 1 }}>Presenting “Detector B, March”</Typography>
        <Typography variant="caption" sx={{ fontFamily: mono }}>{t + 1} / {DECK.length}</Typography>
      </Stack>
    </Stack>
  );
}

const SCENES: Record<DemoScene, (p: { reduced: boolean }) => ReactNode> = {
  write: WriteScene,
  search: SearchScene,
  import: ImportScene,
  discuss: DiscussScene,
  notebook: NotebookScene,
  present: PresentScene,
};

export function HeroDemo({ scene = "search" }: { scene?: DemoScene }) {
  const reduced = useMediaQuery("(prefers-reduced-motion: reduce)");
  const Scene = SCENES[scene];
  return (
    <Paper
      role="img"
      aria-label={ALT[scene]}
      data-demo-scene={scene}
      elevation={0}
      sx={{
        border: 1,
        borderColor: "divider",
        borderRadius: 3,
        overflow: "hidden",
        boxShadow: (t) => `0 24px 60px -24px ${alpha(t.palette.primary.main, 0.45)}, 0 2px 6px ${alpha("#000", 0.06)}`,
      }}
    >
      <Box aria-hidden>
        <Stack direction="row" spacing={0.75} sx={{ px: 1.5, py: 1, borderBottom: 1, borderColor: "divider", bgcolor: "surface.sunken" }}>
          {["#ff5f57", "#febc2e", "#28c840"].map((c) => <Box key={c} sx={{ width: 10, height: 10, borderRadius: "50%", bgcolor: c, opacity: 0.85 }} />)}
        </Stack>
        <Box key={scene} sx={{ p: 2, minHeight: 330, animation: reduced ? undefined : "sceneIn 250ms ease-out", "@keyframes sceneIn": { from: { opacity: 0 }, to: { opacity: 1 } } }}>
          <Scene reduced={reduced} />
        </Box>
      </Box>
    </Paper>
  );
}
