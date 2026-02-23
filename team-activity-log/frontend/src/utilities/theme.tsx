import { createTheme } from "@mui/material";

// ─── MUI THEME ────────────────────────────────────────────────────────────────
export const theme = createTheme({
  palette: {
    mode: "dark",
    primary: { main: "#1976d2" }, // MUI blue
    secondary: { main: "#9c27b0" },
    error: { main: "#d32f2f" }, // MUI red
    warning: { main: "#ed6c02" },
    info: { main: "#0288d1" },
    success: { main: "#2e7d32" }, // MUI green
    background: { default: "#0b0f18", paper: "#1a1f2e" },
    text: { primary: "#e2e8f0", secondary: "#90a4ae" },
    grey: {
      50: "#fafafa",
      100: "#f5f5f5",
      200: "#eeeeee",
      300: "#e0e0e0",
      400: "#bdbdbd",
      500: "#9e9e9e",
      600: "#757575",
      700: "#616161",
      800: "#424242",
      900: "#212121",
    },
    divider: "rgba(255,255,255,0.08)",
  },
  shape: { borderRadius: 10 },
  typography: {
    fontFamily: "'IBM Plex Sans', sans-serif",
    overline: { fontFamily: "'IBM Plex Mono', monospace", letterSpacing: 3 },
  },
  components: {
    MuiPaper: { styleOverrides: { root: { backgroundImage: "none" } } },
    MuiButton: {
      styleOverrides: { root: { textTransform: "none", fontWeight: 600 } },
    },
    MuiChip: {
      styleOverrides: {
        root: { fontFamily: "'IBM Plex Mono', monospace", fontSize: "0.7rem" },
      },
    },
  },
});
