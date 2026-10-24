/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  base: "/",
  build: {
    rollupOptions: {
      output: {
        // Only vendor-split what every page needs; the editor and the mock server are
        // dynamically imported, so Vite already gives them their own lazy chunks.
        manualChunks: { mui: ["@mui/material", "@emotion/react", "@emotion/styled"] },
      },
    },
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["./src/test/setup.ts"],
  },
});
