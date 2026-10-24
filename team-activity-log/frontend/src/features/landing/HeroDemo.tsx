import { ChatBubbleOutlineRounded, ImageOutlined, SearchRounded } from "@mui/icons-material";
import { Box, Paper, Stack, Typography, useMediaQuery } from "@mui/material";
import { alpha } from "@mui/material/styles";
import { useEffect, useState } from "react";
import { TagDot } from "../../components/ui";

// A scripted, self-playing preview of Search: type a query, the histogram and results follow.
// Static data, no network; it's decoration with a text alternative, not a live widget.
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

export function HeroDemo() {
  const reduced = useMediaQuery("(prefers-reduced-motion: reduce)");
  const [step, setStep] = useState(0);
  const [typed, setTyped] = useState(reduced ? SCRIPT[0].q.length : 0);
  const scene = SCRIPT[step];
  const done = typed >= scene.q.length;

  useEffect(() => {
    if (reduced) return;
    const t = done
      ? setTimeout(() => (setStep((s) => (s + 1) % SCRIPT.length), setTyped(0)), 3200)
      : setTimeout(() => setTyped((n) => n + 1), 70);
    return () => clearTimeout(t);
  }, [done, typed, reduced]);

  const max = Math.max(...scene.bars);
  return (
    <Paper
      role="img"
      aria-label={`Preview of Search: the query “${SCRIPT[0].q}” narrows thousands of posts to a few, with a timeline of when they were written.`}
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
        <Box sx={{ p: 2 }}>
          <Stack direction="row" alignItems="center" spacing={1} sx={{ px: 1.25, py: 0.9, border: 1, borderColor: "primary.main", borderRadius: 1.5, boxShadow: (t) => `0 0 0 3px ${alpha(t.palette.primary.main, 0.15)}` }}>
            <SearchRounded fontSize="small" sx={{ color: "text.secondary" }} />
            <Typography sx={{ fontFamily: "'IBM Plex Mono', ui-monospace, monospace", fontSize: "0.9rem", whiteSpace: "pre" }}>
              {scene.q.slice(0, typed)}
              {!reduced && <Box component="span" sx={{ borderLeft: 2, borderColor: "primary.main", ml: "1px", animation: "blink 1s steps(1) infinite", "@keyframes blink": { "50%": { opacity: 0 } } }} />}
            </Typography>
          </Stack>
          <Stack direction="row" alignItems="flex-end" spacing="3px" sx={{ height: 44, mt: 2, mb: 0.5, opacity: done ? 1 : 0.35, transition: reduced ? undefined : "opacity 300ms" }}>
            {scene.bars.map((b, i) => (
              <Box key={i} sx={{ flex: 1, height: `${(b / max) * 100}%`, bgcolor: "chart.bar", borderRadius: "3px 3px 0 0", transition: reduced ? undefined : "height 400ms ease" }} />
            ))}
          </Stack>
          <Typography variant="caption" color="text.secondary">{done ? `${scene.results.length * 7 + step * 5} posts` : "Searching 5,000 posts…"}</Typography>
          <Stack spacing={1} sx={{ mt: 1, opacity: done ? 1 : 0.35, transition: reduced ? undefined : "opacity 300ms" }}>
            {scene.results.map((r) => (
              <Box key={r.title} sx={{ p: 1.25, border: 1, borderColor: "divider", borderRadius: 1.5, bgcolor: "background.paper" }}>
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
            ))}
          </Stack>
        </Box>
      </Box>
    </Paper>
  );
}
