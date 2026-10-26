import { BrushOutlined, ChatBubbleOutlineRounded, ImageOutlined } from "@mui/icons-material";
import { Box, Stack, Typography } from "@mui/material";
import { alpha } from "@mui/material/styles";
import type { ReactNode } from "react";
import { TagDot } from "../../components/ui";

// The hero's picture (owner request: not another demo; the features section has those). The
// logo mark, with the things a team's log is made of floating around it. Decoration only.

/** Something drifting gently around the mark; still when reduced motion is on. */
function Float({ at, delay, children }: { at: Record<string, string>; delay: number; children: ReactNode }) {
  return (
    <Box
      sx={{
        position: "absolute",
        ...at,
        "@media (prefers-reduced-motion: no-preference)": {
          animation: `heroFloat 6s ease-in-out ${delay}s infinite`,
          "@keyframes heroFloat": { "0%, 100%": { transform: "translateY(0)" }, "50%": { transform: "translateY(-10px)" } },
        },
      }}
    >
      {children}
    </Box>
  );
}

const card = { bgcolor: "background.paper", border: 1, borderColor: "divider", borderRadius: 2, boxShadow: (t: { palette: { primary: { main: string } } }) => `0 12px 30px -14px ${alpha(t.palette.primary.main, 0.45)}` };

function Chip({ color, label }: { color: string; label: string }) {
  return (
    <Stack direction="row" spacing={0.75} alignItems="center" sx={{ ...card, borderRadius: 99, px: 1.25, py: 0.5 }}>
      <TagDot color={color} />
      <Typography variant="caption" sx={{ fontWeight: 600 }}>{label}</Typography>
    </Stack>
  );
}

export function HeroArt() {
  return (
    <Box aria-hidden sx={{ position: "relative", height: { xs: 300, md: 400 }, maxWidth: 480, width: "100%", mx: "auto" }}>
      {/* Rings, then the mark. */}
      {[1, 0.72, 0.46].map((s) => (
        <Box key={s} sx={{ position: "absolute", left: "50%", top: "50%", width: `${s * 100}%`, aspectRatio: "1", transform: "translate(-50%, -50%)", borderRadius: "50%", border: 1, borderColor: (t) => alpha(t.palette.primary.main, 0.18) }} />
      ))}
      <Box
        sx={{
          position: "absolute",
          left: "50%",
          top: "50%",
          transform: "translate(-50%, -50%)",
          width: { xs: 96, md: 120 },
          height: { xs: 96, md: 120 },
          borderRadius: 5,
          display: "grid",
          placeItems: "center",
          color: "primary.contrastText",
          background: (t) => `linear-gradient(135deg, ${t.palette.primary.light}, ${t.palette.primary.dark})`,
          boxShadow: (t) => `0 24px 60px -18px ${alpha(t.palette.primary.main, 0.7)}`,
        }}
      >
        <BrushOutlined sx={{ fontSize: { xs: 48, md: 60 } }} />
      </Box>

      <Float at={{ left: "2%", top: "12%" }} delay={0}>
        <Box sx={{ ...card, p: 1.25, width: 168 }}>
          <Typography variant="caption" sx={{ fontWeight: 700, display: "block" }} noWrap>Cooldown, run 4512</Typography>
          <Stack direction="row" spacing={1} sx={{ mt: 0.5, color: "text.secondary" }}>
            <Stack direction="row" spacing={0.25} alignItems="center"><ImageOutlined sx={{ fontSize: 13 }} /><Typography variant="caption">2</Typography></Stack>
            <Stack direction="row" spacing={0.25} alignItems="center"><ChatBubbleOutlineRounded sx={{ fontSize: 13 }} /><Typography variant="caption">5</Typography></Stack>
          </Stack>
        </Box>
      </Float>
      <Float at={{ right: "0%", top: "6%" }} delay={1.2}>
        <Chip color="#2563eb" label="calibration" />
      </Float>
      <Float at={{ right: "2%", top: "58%" }} delay={0.6}>
        <Box sx={{ ...card, p: 1.25, width: 132 }}>
          <Stack direction="row" alignItems="flex-end" spacing="3px" sx={{ height: 40 }}>
            {[3, 5, 4, 7, 6, 9, 8].map((v, i) => <Box key={i} sx={{ flex: 1, height: `${v * 11}%`, bgcolor: "chart.bar", borderRadius: "3px 3px 0 0" }} />)}
          </Stack>
        </Box>
      </Float>
      <Float at={{ left: "6%", bottom: "10%" }} delay={1.8}>
        <Chip color="#c2410c" label="noise" />
      </Float>
      <Float at={{ left: "36%", bottom: "0%" }} delay={2.4}>
        <Stack direction="row" spacing={0.75} alignItems="center" sx={{ ...card, px: 1.25, py: 0.75 }}>
          <Box sx={{ width: 20, height: 20, borderRadius: "50%", bgcolor: "#0f766e", color: "#fff", fontSize: 10, fontWeight: 700, display: "grid", placeItems: "center" }}>P</Box>
          <Typography variant="caption"><Box component="span" sx={{ color: "primary.main", fontWeight: 600 }}>@Dana</Box> see Fig. 2</Typography>
        </Stack>
      </Float>
    </Box>
  );
}
