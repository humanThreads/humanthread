/// <reference types="vitest/config" />
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";
import packageManifest from "./package.json" with { type: "json" };

export default defineConfig({
  base: "./",
  define: {
    __HUMANTHREAD_AGENT_VERSION__: JSON.stringify(packageManifest.version),
    __HUMANTHREAD_BUILD_REVISION__: JSON.stringify(process.env.HUMANTHREAD_BUILD_REVISION ?? ""),
  },
  plugins: [react()],
  resolve: {
    alias: {
      "@humanthread/shared": fileURLToPath(
        new URL("../../packages/shared/src/index.ts", import.meta.url),
      ),
      "@humanthread/workbench-client": fileURLToPath(
        new URL("../../packages/workbench-client/src/index.ts", import.meta.url),
      ),
    },
  },
  test: {
    environment: "jsdom",
    include: [
      "src/**/*.test.ts",
      "src/**/*.test.tsx",
      "scripts/**/*.test.ts",
      "electron/**/*.test.ts",
    ],
    setupFiles: ["./src/test-setup.ts"],
  },
});
