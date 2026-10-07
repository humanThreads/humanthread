/// <reference types="vitest/config" />
import { resolve } from "node:path";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const apiTarget = process.env.HUMANTHREAD_PREVIEW_API_TARGET ?? "http://localhost:3000";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@humanthread/workbench-client": resolve(
        import.meta.dirname,
        "../../packages/workbench-client/src/index.ts",
      ),
    },
  },
  server: {
    host: "0.0.0.0",
    port: 4174,
    proxy: {
      "/api": {
        target: apiTarget,
        changeOrigin: true,
        secure: true,
      },
    },
  },
  preview: {
    host: "0.0.0.0",
    port: 4174,
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, "index.html"),
        tuiPreview: resolve(import.meta.dirname, "tui.html"),
      },
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test-setup.ts"],
  },
});
