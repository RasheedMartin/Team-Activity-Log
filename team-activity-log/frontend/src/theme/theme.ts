import { alpha, createTheme, type Theme } from "@mui/material/styles";

// §A4: neutral surfaces, one accent, color reserved for tags and status. 8px grid. IBM Plex.

export type Density = "compact" | "comfortable";
export type Mode = "light" | "dark";

const ACCENT = { light: "#3451d1", dark: "#8ea2ff" };
// Chart steps, validated with the dataviz skill's contrast check against each surface:
// bar 6.47:1 (light) / 7.20:1 (dark); muted (outside a selection) 3.18:1 / 3.15:1 — both ≥ 3:1.
const CHART = {
  light: { bar: "#3451d1", barMuted: "#7f8dcf", wash: "rgba(52,81,209,0.10)", grid: "#e3e6ea" },
  dark: { bar: "#8ea2ff", barMuted: "#5a669f", wash: "rgba(142,162,255,0.12)", grid: "#2a2f37" },
};

const SURFACES = {
  light: { default: "#f6f7f9", paper: "#ffffff", raised: "#ffffff", sunken: "#eef0f3", line: "#e3e6ea", text: "#1b1f24", muted: "#5d6672", faint: "#8a929c" },
  dark: { default: "#111317", paper: "#181b20", raised: "#1e2228", sunken: "#0c0e11", line: "#2a2f37", text: "#e6e8eb", muted: "#a0a8b3", faint: "#6f7782" },
};

export const STATUS = {
  draft: { light: "#9a6700", dark: "#e3b341" },
  hidden: { light: "#6e7781", dark: "#8b949e" },
  deleted: { light: "#cf222e", dark: "#f47067" },
};

declare module "@mui/material/styles" {
  interface Palette {
    surface: { raised: string; sunken: string; line: string; faint: string };
    chart: { bar: string; barMuted: string; wash: string; grid: string };
    density: Density;
  }
  interface PaletteOptions {
    surface?: { raised: string; sunken: string; line: string; faint: string };
    chart?: { bar: string; barMuted: string; wash: string; grid: string };
    density?: Density;
  }
}

export function createAppTheme(mode: Mode, density: Density, reducedMotion = false): Theme {
  const s = SURFACES[mode];
  const accent = ACCENT[mode];
  const compact = density === "compact";
  const theme = createTheme({
    spacing: 8,
    palette: {
      mode,
      primary: { main: accent, contrastText: mode === "light" ? "#fff" : "#0b0d10" },
      secondary: { main: s.muted },
      error: { main: mode === "light" ? "#cf222e" : "#f47067" },
      warning: { main: STATUS.draft[mode] },
      success: { main: mode === "light" ? "#1a7f37" : "#57ab5a" },
      background: { default: s.default, paper: s.paper },
      text: { primary: s.text, secondary: s.muted, disabled: s.faint },
      divider: s.line,
      surface: { raised: s.raised, sunken: s.sunken, line: s.line, faint: s.faint },
      chart: CHART[mode],
      density,
    },
    shape: { borderRadius: 6 },
    typography: {
      fontFamily: "'IBM Plex Sans', system-ui, -apple-system, 'Segoe UI', sans-serif",
      fontSize: compact ? 13 : 14,
      h1: { fontSize: "1.6rem", fontWeight: 600, letterSpacing: "-0.01em" },
      h2: { fontSize: "1.3rem", fontWeight: 600, letterSpacing: "-0.01em" },
      h3: { fontSize: "1.1rem", fontWeight: 600 },
      h4: { fontSize: "1rem", fontWeight: 600 },
      subtitle2: { fontWeight: 600 },
      button: { textTransform: "none", fontWeight: 600 },
      overline: { fontFamily: "'IBM Plex Mono', ui-monospace, monospace", letterSpacing: "0.08em", fontSize: "0.68rem", lineHeight: 1.6 },
    },
    transitions: reducedMotion
      ? { create: () => "none" }
      : { duration: { shortest: 120, shorter: 150, short: 180, standard: 200, complex: 200, enteringScreen: 180, leavingScreen: 150 } },
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          body: { WebkitFontSmoothing: "antialiased" },
          "code, kbd, pre": { fontFamily: "'IBM Plex Mono', ui-monospace, monospace" },
          mark: { background: alpha(accent, mode === "light" ? 0.16 : 0.28), color: "inherit", borderRadius: 2, padding: "0 1px" },
          "*:focus-visible": { outline: `2px solid ${accent}`, outlineOffset: 2 },
          "@media print": { "[data-print-hide], .MuiSnackbar-root": { display: "none !important" }, body: { background: "#fff" } },
          // @mention suggestions (rendered by the comment editor outside React)
          ".tal-mentions": {
            position: "absolute",
            zIndex: 1600,
            minWidth: 200,
            padding: 4,
            background: s.paper,
            border: `1px solid ${s.line}`,
            borderRadius: 6,
            boxShadow: "0 8px 24px rgba(0,0,0,0.18)",
            fontSize: 13,
            "& > div": { padding: "5px 10px", borderRadius: 4, cursor: "pointer", color: s.text },
            "& > div.on": { background: alpha(accent, 0.14) },
            "& > div.none": { color: s.faint, cursor: "default" },
          },
          "@media (prefers-reduced-motion: reduce)": { "*": { animationDuration: "0.01ms !important", transitionDuration: "0.01ms !important" } },
        },
      },
      MuiPaper: { defaultProps: { elevation: 0 }, styleOverrides: { root: { backgroundImage: "none" } } },
      MuiButton: { defaultProps: { disableElevation: true, size: compact ? "small" : "medium" } },
      MuiIconButton: { defaultProps: { size: compact ? "small" : "medium" } },
      MuiTextField: { defaultProps: { size: "small" } },
      MuiSelect: { defaultProps: { size: "small" } },
      MuiChip: { defaultProps: { size: "small" }, styleOverrides: { root: { borderRadius: 4, fontWeight: 500 } } },
      MuiTooltip: { defaultProps: { enterDelay: 400, disableInteractive: true }, styleOverrides: { tooltip: { fontSize: "0.75rem" } } },
      MuiMenuItem: { styleOverrides: { root: { fontSize: compact ? "0.85rem" : "0.9rem", minHeight: compact ? 32 : 36 } } },
      MuiListItemButton: { styleOverrides: { root: { borderRadius: 6 } } },
      MuiDialog: { defaultProps: { PaperProps: { variant: "outlined" } } },
      MuiSkeleton: { defaultProps: { animation: reducedMotion ? false : "wave" } },
    },
  });
  return theme;
}

/** Background tint for a tag/status color that reads in both modes. */
export const tint = (color: string, mode: Mode) => alpha(color, mode === "light" ? 0.12 : 0.22);
