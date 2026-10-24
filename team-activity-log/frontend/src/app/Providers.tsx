import { CssBaseline, ThemeProvider, useMediaQuery } from "@mui/material";
import { QueryClientProvider } from "@tanstack/react-query";
import { useMemo, type ReactNode } from "react";
import { useMe } from "../api/hooks";
import { createAppTheme } from "../theme/theme";
import { UndoProvider } from "../components/Undo";
import { queryClient } from "./queryClient";


/** Theme follows the user's preferences (light/dark/system, density, reduced motion). */
function ThemedApp({ children }: { children: ReactNode }) {
  const { data: me } = useMe();
  const prefersDark = useMediaQuery("(prefers-color-scheme: dark)");
  const prefersReduced = useMediaQuery("(prefers-reduced-motion: reduce)");
  const prefs = me?.preferences;
  const mode = prefs?.theme === "dark" || (prefs?.theme !== "light" && prefersDark) ? "dark" : "light";
  const density = prefs?.density ?? "compact";
  const reduced = !!prefs?.reducedMotion || prefersReduced;
  const theme = useMemo(() => createAppTheme(mode, density, reduced), [mode, density, reduced]);
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline enableColorScheme />
      <UndoProvider>{children}</UndoProvider>
    </ThemeProvider>
  );
}

export function Providers({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemedApp>{children}</ThemedApp>
    </QueryClientProvider>
  );
}
