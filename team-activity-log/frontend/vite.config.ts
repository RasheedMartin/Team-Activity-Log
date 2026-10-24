/// <reference types="vitest/config" />
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  base: "/",
  // Live mode: forward /v1 to the FastAPI backend (VITE_API_PROXY, default localhost:8000).
  server:
    (process.env.VITE_API_MODE ?? loadEnv(mode, process.cwd(), "").VITE_API_MODE) === "live"
      ? { proxy: { "/v1": { target: process.env.VITE_API_PROXY ?? loadEnv(mode, process.cwd(), "").VITE_API_PROXY ?? "http://localhost:8000", changeOrigin: false } } }
      : undefined,
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
}));
