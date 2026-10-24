import {
  AlternateEmailRounded,
  ArrowForwardRounded,
  AutoStoriesOutlined,
  BrushOutlined,
  EditNoteRounded,
  ManageSearchRounded,
  SlideshowRounded,
  UploadFileOutlined,
} from "@mui/icons-material";
import { Box, Button, Container, Link, Paper, Stack, Typography } from "@mui/material";
import { alpha } from "@mui/material/styles";
import type { ReactNode } from "react";
import { Link as RouterLink } from "react-router-dom";
import { useMe } from "../../api/hooks";
import { BRAND } from "../../app/brand";
import { homePath } from "../../app/session";
import { HeroDemo } from "./HeroDemo";

const FEATURES: { icon: ReactNode; title: string; body: string }[] = [
  { icon: <EditNoteRounded />, title: "Write it up", body: "Notes, tables, and plots. Saved as you type." },
  { icon: <ManageSearchRounded />, title: "Find anything", body: "Posts, comments, even text in images." },
  { icon: <UploadFileOutlined />, title: "Import slides", body: "Every slide becomes a searchable post." },
  { icon: <AlternateEmailRounded />, title: "Discuss", body: "Threads, mentions, comments on images." },
  { icon: <AutoStoriesOutlined />, title: "Notebooks", body: "Posts in order, read start to finish." },
  { icon: <SlideshowRounded />, title: "Present", body: "Any set of posts, as slides." },
];

const STEPS = [
  { n: "1", title: "Post", body: "What you did, with the plot." },
  { n: "2", title: "Search", body: "Find it months later." },
  { n: "3", title: "Share", body: "Discuss, collect, present." },
];

function Section({ id, eyebrow, title, children }: { id?: string; eyebrow: string; title: string; children: ReactNode }) {
  return (
    <Box component="section" id={id} aria-labelledby={id && `${id}-title`} sx={{ py: { xs: 7, md: 10 }, scrollMarginTop: 64 }}>
      <Container maxWidth="lg">
        <Typography variant="overline" color="primary">{eyebrow}</Typography>
        <Typography id={id && `${id}-title`} component="h2" sx={{ fontSize: { xs: "1.6rem", md: "2.1rem" }, fontWeight: 600, letterSpacing: "-0.02em", mb: 4, maxWidth: 640 }}>
          {title}
        </Typography>
        {children}
      </Container>
    </Box>
  );
}

const Logo = () => (
  <Stack direction="row" spacing={1} alignItems="center">
    <Box aria-hidden sx={{ width: 26, height: 26, borderRadius: 1.5, bgcolor: "primary.main", display: "grid", placeItems: "center", color: "primary.contrastText" }}>
      <BrushOutlined sx={{ fontSize: 16 }} />
    </Box>
    <Typography sx={{ fontWeight: 600, letterSpacing: "-0.01em" }}>{BRAND.name}</Typography>
  </Stack>
);

/** Public front door (owner request): show what the product does, then send people to sign up or in. */
export default function LandingPage() {
  const { data: me } = useMe();
  const appCta = me ? (
    <Button variant="contained" component={RouterLink} to={homePath(me)} endIcon={<ArrowForwardRounded />}>Open your workspace</Button>
  ) : null;

  return (
    <Box sx={{ bgcolor: "background.default", color: "text.primary", minHeight: "100dvh" }}>
      <Box component="header" sx={{ position: "sticky", top: 0, zIndex: 10, backdropFilter: "blur(10px)", bgcolor: (t) => alpha(t.palette.background.default, 0.8), borderBottom: 1, borderColor: "divider" }}>
        <Container maxWidth="lg">
          <Stack direction="row" alignItems="center" spacing={2} sx={{ height: 60 }}>
            <Logo />
            <Box sx={{ flex: 1 }} />
            <Stack component="nav" aria-label="Page" direction="row" spacing={3} sx={{ display: { xs: "none", sm: "flex" } }}>
              <Link href="#features" color="text.secondary" underline="hover">Features</Link>
              <Link href="#how" color="text.secondary" underline="hover">How it works</Link>
            </Stack>
            {appCta ?? (
              <Stack direction="row" spacing={1}>
                <Button component={RouterLink} to="/signin">Sign in</Button>
                <Button variant="contained" component={RouterLink} to="/register">Get started</Button>
              </Stack>
            )}
          </Stack>
        </Container>
      </Box>

      <Box
        component="main"
        sx={{
          position: "relative",
          overflow: "hidden",
          background: (t) => `radial-gradient(1100px 500px at 80% -10%, ${alpha(t.palette.primary.main, 0.16)}, transparent 70%)`,
          "&::before": {
            content: '""',
            position: "absolute",
            inset: 0,
            pointerEvents: "none",
            backgroundImage: (t) => `linear-gradient(${alpha(t.palette.divider, 0.6)} 1px, transparent 1px), linear-gradient(90deg, ${alpha(t.palette.divider, 0.6)} 1px, transparent 1px)`,
            backgroundSize: "40px 40px",
            maskImage: "linear-gradient(to bottom, black, transparent 75%)",
          },
        }}
      >
        <Container maxWidth="lg" sx={{ position: "relative", py: { xs: 6, md: 10 } }}>
          <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "1.05fr 1fr" }, gap: { xs: 5, md: 7 }, alignItems: "center" }}>
            <Box>
              <Typography variant="overline" color="primary">For research and engineering teams</Typography>
              <Typography variant="h1" sx={{ fontSize: { xs: "2.3rem", md: "3.3rem" }, lineHeight: 1.08, letterSpacing: "-0.03em", mt: 1, mb: 2.5 }}>
                {BRAND.tagline}
              </Typography>
              <Typography color="text.secondary" sx={{ fontSize: "1.15rem", maxWidth: 480, mb: 4 }}>
                The shared logbook for research teams.
              </Typography>
              <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
                {appCta ?? (
                  <>
                    <Button size="large" variant="contained" component={RouterLink} to="/register" endIcon={<ArrowForwardRounded />}>Get started</Button>
                    <Button size="large" variant="outlined" component={RouterLink} to="/signin">Sign in</Button>
                  </>
                )}
              </Stack>
            </Box>
            <HeroDemo />
          </Box>
        </Container>

        <Section id="features" eyebrow="Features" title="From “I ran it” to “here's what we learned”">
          <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr", md: "repeat(3, 1fr)" }, gap: 2 }}>
            {FEATURES.map((f) => (
              <Paper key={f.title} variant="outlined" sx={{ p: 3, borderRadius: 2, transition: "border-color 150ms, transform 150ms", "&:hover": { borderColor: "primary.main" }, "@media (prefers-reduced-motion: no-preference)": { "&:hover": { transform: "translateY(-2px)" } } }}>
                <Box aria-hidden sx={{ width: 40, height: 40, borderRadius: 2, display: "grid", placeItems: "center", mb: 2, color: "primary.main", bgcolor: (t) => alpha(t.palette.primary.main, 0.1) }}>{f.icon}</Box>
                <Typography component="h3" variant="h3" sx={{ mb: 0.75 }}>{f.title}</Typography>
                <Typography variant="body2" color="text.secondary">{f.body}</Typography>
              </Paper>
            ))}
          </Box>
        </Section>

        <Box sx={{ bgcolor: "background.paper", borderTop: 1, borderBottom: 1, borderColor: "divider" }}>
          <Section id="how" eyebrow="How it works" title="Two minutes a day">
            <Box component="ol" sx={{ listStyle: "none", p: 0, m: 0, display: "grid", gridTemplateColumns: { xs: "1fr", md: "repeat(3, 1fr)" }, gap: 4 }}>
              {STEPS.map((s) => (
                <Box component="li" key={s.n}>
                  <Typography aria-hidden sx={{ fontFamily: "'IBM Plex Mono', ui-monospace, monospace", fontSize: "2.4rem", fontWeight: 600, color: "primary.main", lineHeight: 1, mb: 1.5 }}>{s.n}</Typography>
                  <Typography component="h3" variant="h3" sx={{ mb: 0.75 }}>{s.title}</Typography>
                  <Typography color="text.secondary">{s.body}</Typography>
                </Box>
              ))}
            </Box>
          </Section>
        </Box>

        <Container maxWidth="lg" sx={{ pb: { xs: 7, md: 10 } }}>
          <Paper
            elevation={0}
            sx={{ p: { xs: 4, md: 6 }, borderRadius: 3, textAlign: "center", color: "primary.contrastText", bgcolor: "primary.main", backgroundImage: (t) => `radial-gradient(600px 200px at 50% 0%, ${alpha("#fff", t.palette.mode === "light" ? 0.18 : 0.3)}, transparent)` }}
          >
            <Typography component="h2" sx={{ fontSize: { xs: "1.6rem", md: "2.1rem" }, fontWeight: 600, letterSpacing: "-0.02em", mb: 1 }}>Start your team's log</Typography>
            <Typography sx={{ opacity: 0.85, mb: 3 }}>Set up in a minute. Bring your slides.</Typography>
            <Button size="large" variant="contained" component={RouterLink} to={me ? homePath(me) : "/register"} sx={{ bgcolor: "background.paper", color: "text.primary", "&:hover": { bgcolor: "background.default" } }}>
              {me ? "Open your workspace" : "Get started"}
            </Button>
          </Paper>
        </Container>
      </Box>

      <Box component="footer" sx={{ borderTop: 1, borderColor: "divider", py: 3 }}>
        <Container maxWidth="lg">
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2} alignItems={{ sm: "center" }}>
            <Logo />
            <Box sx={{ flex: 1 }} />
            <Link component={RouterLink} to="/signin" color="text.secondary" underline="hover">Sign in</Link>
            <Link component={RouterLink} to="/register" color="text.secondary" underline="hover">Create account</Link>
            <Typography variant="body2" color="text.secondary">© {new Date().getFullYear()}</Typography>
          </Stack>
        </Container>
      </Box>
    </Box>
  );
}
