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
        manualChunks: {
          mui: ["@mui/material", "@emotion/react", "@emotion/styled"],
          editor: ["@tiptap/react", "@tiptap/starter-kit", "@tiptap/pm"],
          mock: ["msw", "dexie", "@faker-js/faker", "minisearch"],
        },
      },
    },
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["./src/test/setup.ts"],
  },
});
