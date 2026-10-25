import {
  AlternateEmailRounded,
  ArrowForwardRounded,
  AutoStoriesOutlined,
  BrushOutlined,
  CheckRounded,
  EditNoteRounded,
  ManageSearchRounded,
  SlideshowRounded,
  UploadFileOutlined,
} from "@mui/icons-material";
import { Box, Button, ButtonBase, Container, Link, Paper, Stack, Typography } from "@mui/material";
import { alpha } from "@mui/material/styles";
import { useState, type ReactNode } from "react";
import { Link as RouterLink } from "react-router-dom";
import { useMe } from "../../api/hooks";
import { BRAND } from "../../app/brand";
import { ACADEMIC_NOTE, PLANS } from "../../app/pricing";
import { homePath } from "../../app/session";
import { HeroArt } from "./HeroArt";
import { HowItWorks } from "./HowItWorks";
import { HeroDemo, type DemoScene } from "./HeroDemo";

const FEATURES: { icon: ReactNode; title: string; body: string; scene: DemoScene }[] = [
  { icon: <EditNoteRounded />, scene: "write", title: "Write it up", body: "Notes, tables, and plots. Saved as you type." },
  { icon: <ManageSearchRounded />, scene: "search", title: "Find anything", body: "Posts, comments, even text in images." },
  { icon: <UploadFileOutlined />, scene: "import", title: "Import slides", body: "Every slide becomes a searchable post." },
  { icon: <AlternateEmailRounded />, scene: "discuss", title: "Discuss", body: "Threads, mentions, comments on images." },
  { icon: <AutoStoriesOutlined />, scene: "notebook", title: "Notebooks", body: "Posts in order, read start to finish." },
  { icon: <SlideshowRounded />, scene: "present", title: "Present", body: "Any set of posts, as slides." },
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
  const [scene, setScene] = useState<DemoScene>("write");
  const feature = FEATURES.find((f) => f.scene === scene)!;
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
              <Link href="#pricing" color="text.secondary" underline="hover">Pricing</Link>
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
            <HeroArt />
          </Box>
        </Container>

        <Section id="features" eyebrow="Features" title="From “I ran it” to “here's what we learned”">
          {/* Feature cards beside the demo they play (above it on phones), so it's never a scroll away. */}
          <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "minmax(0, 1fr) minmax(0, 1.1fr)" }, gap: { xs: 2, md: 4 }, alignItems: "start" }}>
            <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: { xs: 1, sm: 1.5 } }}>
              {FEATURES.map((f) => {
                const on = scene === f.scene;
                return (
                  <Paper
                    key={f.title}
                    component={ButtonBase}
                    variant="outlined"
                    onClick={() => setScene(f.scene)}
                    aria-pressed={on}
                    aria-controls="feature-demo"
                    sx={{
                      p: { xs: 1.5, sm: 2.5 },
                      borderRadius: 2,
                      display: "block",
                      textAlign: "left",
                      width: "100%",
                      height: "100%",
                      borderColor: on ? "primary.main" : undefined,
                      bgcolor: (t) => (on ? alpha(t.palette.primary.main, 0.06) : undefined),
                      transition: "border-color 150ms, background-color 150ms",
                      "&:hover": { borderColor: "primary.main" },
                      "&.Mui-focusVisible": { outline: 2, outlineColor: "primary.main", outlineOffset: 2 },
                    }}
                  >
                    <Box aria-hidden sx={{ width: { xs: 32, sm: 40 }, height: { xs: 32, sm: 40 }, borderRadius: 2, display: "grid", placeItems: "center", mb: { xs: 1, sm: 1.5 }, color: on ? "primary.contrastText" : "primary.main", bgcolor: (t) => (on ? t.palette.primary.main : alpha(t.palette.primary.main, 0.1)) }}>{f.icon}</Box>
                    <Typography component="h3" variant="h3" sx={{ mb: { sm: 0.5 }, fontSize: { xs: "0.95rem", sm: undefined } }}>{f.title}</Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ display: { xs: "none", sm: "block" } }}>{f.body}</Typography>
                  </Paper>
                );
              })}
            </Box>
            <Box id="feature-demo" sx={{ position: { md: "sticky" }, top: { md: 84 } }}>
              <Typography aria-live="polite" color="text.secondary" sx={{ display: { sm: "none" }, mb: 1, fontSize: "0.9rem" }}>
                <Box component="strong" sx={{ color: "text.primary" }}>{feature.title}.</Box> {feature.body}
              </Typography>
              <HeroDemo scene={scene} />
            </Box>
          </Box>
        </Section>

        <Box sx={{ bgcolor: "background.paper", borderTop: 1, borderBottom: 1, borderColor: "divider" }}>
          <Section id="how" eyebrow="How it works" title="From a note to an answer, in four steps">
            <HowItWorks />
          </Section>
        </Box>

        <Section id="pricing" eyebrow="Pricing" title="Free for small teams">
          <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr", md: "repeat(4, 1fr)" }, gap: 2, alignItems: "stretch" }}>
            {PLANS.map((p) => (
              <Paper key={p.id} variant="outlined" sx={{ p: 3, borderRadius: 2, display: "flex", flexDirection: "column", borderColor: p.highlight ? "primary.main" : "divider", borderWidth: p.highlight ? 2 : 1 }}>
                <Typography component="h3" variant="h3">{p.name}</Typography>
                <Stack direction="row" alignItems="baseline" spacing={0.75} sx={{ mt: 1.5 }}>
                  <Typography sx={{ fontSize: "2rem", fontWeight: 600, letterSpacing: "-0.02em" }}>{p.price}</Typography>
                </Stack>
                <Typography variant="caption" color="text.secondary" sx={{ minHeight: 20 }}>{p.per ?? p.note ?? ""}</Typography>
                <Box component="ul" sx={{ listStyle: "none", p: 0, m: 0, mt: 2, mb: 3, flex: 1, display: "grid", gap: 1 }}>
                  {p.features.map((f) => (
                    <Typography component="li" key={f} variant="body2" sx={{ display: "flex", gap: 1 }}>
                      <CheckRounded fontSize="small" color="primary" sx={{ mt: "1px" }} />
                      {f}
                    </Typography>
                  ))}
                </Box>
                <Button variant={p.highlight ? "contained" : "outlined"} component={RouterLink} to="/register">{p.cta}</Button>
              </Paper>
            ))}
          </Box>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>{ACADEMIC_NOTE}</Typography>
        </Section>

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
