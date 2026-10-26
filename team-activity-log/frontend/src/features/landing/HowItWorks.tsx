import { HistoryRounded, IosShareRounded, LockOutlined, ShieldOutlined } from "@mui/icons-material";
import { Box, Stack, Typography } from "@mui/material";
import { alpha } from "@mui/material/styles";
import type { ReactNode } from "react";

// "How it works" (owner request: more technical, still for users). What happens to a post from the
// moment it's written to the moment someone finds it, with a real example at each stage. Only
// claims what the product does today.

const mono = "'IBM Plex Mono', ui-monospace, monospace";

const STAGES: { n: string; title: string; lede: string; sample: ReactNode; points: string[] }[] = [
  {
    n: "01",
    title: "Capture",
    lede: "Write it up while it's fresh, or bring in what you already have.",
    sample: (
      <>
        <Box component="span" sx={{ color: "text.secondary" }}>drop</Box> Lab_Notes_March.pptx
        <br />
        <Box component="span" sx={{ color: "success.main" }}>→ 16 slides · 16 drafts</Box>
      </>
    ),
    points: ["Text, tables, plots, and pasted screenshots in one post", "Saves as you type; every published edit is kept as a revision", "PowerPoint import keeps each slide's layout, and stays editable"],
  },
  {
    n: "02",
    title: "Index",
    lede: "The moment you save, everything in the post becomes searchable.",
    sample: (
      <>
        title · body · tables · comments
        <br />
        captions · alt text · slide text
      </>
    ),
    points: ["Search sees your change right away, not on the next nightly run", "Tags, authors, and dates are stored as filters, not just words", "Each post keeps the date the work happened, separate from when it was posted"],
  },
  {
    n: "03",
    title: "Find",
    lede: "Ask precise questions; get the posts that answer them.",
    sample: (
      <>
        tag:calibration AND (drift OR noise)
        <br />
        <Box component="span" sx={{ color: "text.secondary" }}>-draft "channel 12"</Box>
      </>
    ),
    points: ["AND, OR, NOT, quoted phrases, prefix*, and field scopes", "A timeline of matches: drag across it to zoom to a week", "Save a search, or press / from anywhere and j / k to move"],
  },
  {
    n: "04",
    title: "Share",
    lede: "Turn a pile of results into something the group reads.",
    sample: (
      <>
        <Box component="span" sx={{ color: "primary.main" }}>@Felix</Box> see the step at week 3
        <br />
        <Box component="span" sx={{ color: "text.secondary" }}>→ notebook · present · .pptx</Box>
      </>
    ),
    points: ["Threads with mentions, questions, and comments pinned to a spot on a figure", "Stitch posts into a notebook, read in order or printed", "Present any set of posts as slides, or download them as PowerPoint"],
  },
];

const UNDER: { icon: ReactNode; title: string; body: string }[] = [
  { icon: <LockOutlined fontSize="small" />, title: "Workspaces and roles", body: "Owner, admin, member, viewer. People see only the workspaces they're in." },
  { icon: <ShieldOutlined fontSize="small" />, title: "Drafts are private", body: "Nothing is visible to others until you publish it." },
  { icon: <HistoryRounded fontSize="small" />, title: "Nothing silently lost", body: "Revisions, a recycle bin with undo, and conflict warnings when two people edit." },
  { icon: <IosShareRounded fontSize="small" />, title: "Your files stay yours", body: "Pictures keep their originals; decks download back to .pptx." },
];

export function HowItWorks() {
  return (
    <Stack spacing={{ xs: 5, md: 6 }}>
      <Box component="ol" sx={{ listStyle: "none", p: 0, m: 0, display: "grid", gridTemplateColumns: { xs: "1fr", md: "repeat(4, 1fr)" }, gap: { xs: 4, md: 3 }, position: "relative" }}>
        {STAGES.map((s, i) => (
          <Box
            component="li"
            key={s.n}
            sx={{
              position: "relative",
              pl: { xs: 5, md: 0 },
              // The pipeline: a line joining the stage markers (down the left on phones, across on laptops).
              "&::before": {
                content: '""',
                position: "absolute",
                bgcolor: (t) => alpha(t.palette.primary.main, 0.25),
                display: i === STAGES.length - 1 ? "none" : "block",
                left: { xs: 15, md: 40 },
                right: { md: -24 },
                top: { xs: 34, md: 16 },
                bottom: { xs: -32, md: "auto" },
                width: { xs: 2, md: "auto" },
                height: { md: 2 },
              },
            }}
          >
            <Box sx={{ position: { xs: "absolute", md: "relative" }, zIndex: 1, left: 0, top: 0, width: 32, height: 32, borderRadius: "50%", display: "grid", placeItems: "center", bgcolor: "primary.main", color: "primary.contrastText", fontFamily: mono, fontSize: 12, fontWeight: 600, mb: { md: 2 } }}>
              {s.n}
            </Box>
            <Typography component="h3" variant="h3" sx={{ mb: 0.5 }}>{s.title}</Typography>
            <Typography color="text.secondary" sx={{ mb: 1.5 }}>{s.lede}</Typography>
            <Box sx={{ fontFamily: mono, fontSize: "0.78rem", lineHeight: 1.6, p: 1.25, mb: 1.5, borderRadius: 1.5, bgcolor: "background.default", border: 1, borderColor: "divider", overflowX: "auto", whiteSpace: "nowrap" }}>{s.sample}</Box>
            <Box component="ul" sx={{ m: 0, pl: 2.25, display: "grid", gap: 0.5, "& li": { fontSize: "0.9rem", color: "text.secondary" }, "& li::marker": { color: "primary.main" } }}>
              {s.points.map((p) => <li key={p}>{p}</li>)}
            </Box>
          </Box>
        ))}
      </Box>

      <Box>
        <Typography variant="overline" color="text.secondary">Under the hood</Typography>
        <Box sx={{ mt: 1, display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr", md: "repeat(4, 1fr)" }, gap: 2 }}>
          {UNDER.map((u) => (
            <Stack key={u.title} direction="row" spacing={1.25} alignItems="flex-start">
              <Box aria-hidden sx={{ color: "primary.main", mt: 0.25 }}>{u.icon}</Box>
              <Box>
                <Typography sx={{ fontWeight: 600, fontSize: "0.92rem" }}>{u.title}</Typography>
                <Typography variant="body2" color="text.secondary">{u.body}</Typography>
              </Box>
            </Stack>
          ))}
        </Box>
      </Box>
    </Stack>
  );
}
