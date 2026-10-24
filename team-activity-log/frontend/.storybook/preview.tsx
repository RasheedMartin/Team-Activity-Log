import { CssBaseline, ThemeProvider } from "@mui/material";
import type { Preview } from "@storybook/react-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { UndoProvider } from "../src/components/Undo";
import { createAppTheme, type Density, type Mode } from "../src/theme/theme";

// Every story renders in light/dark × compact/comfortable via the toolbar (§0 rule 9).
const preview: Preview = {
  globalTypes: {
    theme: { description: "Theme", toolbar: { title: "Theme", icon: "mirror", items: ["light", "dark"], dynamicTitle: true } },
    density: { description: "Density", toolbar: { title: "Density", icon: "component", items: ["compact", "comfortable"], dynamicTitle: true } },
  },
  initialGlobals: { theme: "light", density: "compact" },
  parameters: { layout: "padded", a11y: { test: "error" } },
  decorators: [
    (Story, ctx) => {
      const theme = createAppTheme(ctx.globals.theme as Mode, ctx.globals.density as Density);
      const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
      return (
        <QueryClientProvider client={qc}>
          <ThemeProvider theme={theme}>
            <CssBaseline />
            <UndoProvider>
              <MemoryRouter>
                <Story />
              </MemoryRouter>
            </UndoProvider>
          </ThemeProvider>
        </QueryClientProvider>
      );
    },
  ],
};
export default preview;
