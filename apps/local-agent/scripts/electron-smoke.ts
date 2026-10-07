import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ELECTRON_SMOKE_TIMEOUT_MS = 60_000;

export interface ElectronSmokeResult {
  exitCode: number | null;
  marker: boolean;
  output: string;
}

export function runElectronSmoke(
  cwd = process.cwd(),
  dependencies: {
    spawn?: typeof spawn;
    timeoutMs?: number;
  } = {},
): Promise<ElectronSmokeResult> {
  const spawnProcess = dependencies.spawn ?? spawn;
  const timeoutMs = dependencies.timeoutMs ?? ELECTRON_SMOKE_TIMEOUT_MS;
  const electronBin = resolve(cwd, "node_modules", ".bin", process.platform === "win32" ? "electron.cmd" : "electron");
  const distIndex = resolve(cwd, "dist", "index.html");
  const mainBundle = resolve(cwd, "dist-electron", "main.cjs");
  if (!existsSync(distIndex) || !existsSync(mainBundle)) {
    return Promise.reject(
      new Error("Electron smoke requires built renderer (dist) and main bundle (dist-electron)"),
    );
  }

  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawnProcess(electronBin, ["."], {
      cwd,
      env: {
        ...process.env,
        HUMANTHREAD_DESKTOP_SMOKE_MS: "250",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    let marker = false;
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      rejectPromise(new Error(`Electron smoke timed out after ${timeoutMs}ms: ${output.slice(-400)}`));
    }, timeoutMs);
    const onData = (chunk: Buffer) => {
      output += chunk.toString("utf8");
      if (output.includes("[humanthread-smoke] renderer-loaded")) marker = true;
    };
    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    child.once("error", (error) => {
      clearTimeout(timer);
      rejectPromise(error);
    });
    child.once("exit", (exitCode) => {
      clearTimeout(timer);
      resolvePromise({ exitCode, marker, output });
    });
  });
}

const currentScriptPath = process.argv[1];

if (
  currentScriptPath &&
  fileURLToPath(import.meta.url) === resolve(currentScriptPath)
) {
  runElectronSmoke()
    .then((result) => {
      if (result.exitCode !== 0 || !result.marker) {
        console.error(result.output.slice(-2_000));
        throw new Error(`Electron smoke failed (exit=${result.exitCode}, marker=${result.marker})`);
      }
      console.log("Electron smoke passed: renderer loaded and the app exited cleanly.");
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    });
}
