import { build } from "esbuild";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export async function runElectronBundle(cwd = process.cwd()): Promise<void> {
  await build({
    entryPoints: {
      main: resolve(cwd, "electron/main.ts"),
      preload: resolve(cwd, "electron/preload.ts"),
    },
    outdir: resolve(cwd, "dist-electron"),
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node22",
    external: ["electron"],
    outExtension: { ".js": ".cjs" },
    sourcemap: false,
    logLevel: "silent",
  });
}

const currentScriptPath = process.argv[1];

if (
  currentScriptPath &&
  fileURLToPath(import.meta.url) === resolve(currentScriptPath)
) {
  const cwd = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  runElectronBundle(cwd)
    .then(() => {
      console.log("Bundled Electron main process and preload script.");
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    });
}
