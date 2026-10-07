import { spawn, type ChildProcess } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  findAvailablePort,
  stopChildProcess,
  waitForChildProcessExit,
  waitForHttpReady,
} from "../src/lib/e2e-server";

export const DEFAULT_ELECTRON_DEV_PORT = 1420;

export interface ElectronDevPlan {
  port: number;
  url: string;
  viteArgs: string[];
  electronEnvironment: NodeJS.ProcessEnv;
}

export function buildElectronDevPlan(port: number): ElectronDevPlan {
  const url = `http://127.0.0.1:${port}`;
  return {
    port,
    url,
    viteArgs: ["exec", "vite", "--port", String(port), "--strictPort"],
    electronEnvironment: {
      ...process.env,
      HUMANTHREAD_DEV_SERVER_URL: url,
    },
  };
}

function isDirectExecution(): boolean {
  const currentScriptPath = process.argv[1];
  if (!currentScriptPath) return false;
  return fileURLToPath(import.meta.url) === resolve(currentScriptPath);
}

async function waitForViteReady(url: string, viteExit: Promise<unknown>): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const exited = await Promise.race([
      viteExit.then(() => true),
      new Promise<boolean>((resolvePromise) => setTimeout(() => resolvePromise(false), 300)),
    ]);
    if (exited) {
      throw new Error("Vite dev server exited before becoming ready");
    }
    try {
      const response = await fetch(url, { method: "GET" });
      if (response.status < 500) return;
    } catch {
      // retry until deadline
    }
  }
  throw new Error(`Vite dev server did not become ready: ${url}`);
}

export async function runElectronDev(): Promise<void> {
  const cwd = process.cwd();
  const port = await findAvailablePort({ preferredPort: DEFAULT_ELECTRON_DEV_PORT });
  const plan = buildElectronDevPlan(port);
  const spawnPnpm = (args: string[], environment: NodeJS.ProcessEnv): ChildProcess => {
    if (process.platform === "win32") {
      return spawn("cmd.exe", ["/d", "/s", "/c", "pnpm", ...args], {
        cwd,
        env: environment,
        stdio: "inherit",
      });
    }
    return spawn("pnpm", args, { cwd, env: environment, stdio: "inherit" });
  };

  const vite = spawnPnpm(plan.viteArgs, process.env);
  const viteExit = waitForChildProcessExit(vite);
  try {
    await waitForViteReady(plan.url, viteExit);
    const electron = spawnPnpm(["exec", "electron", "."], plan.electronEnvironment);
    await waitForChildProcessExit(electron);
  } finally {
    await stopChildProcess(vite);
  }
}

if (isDirectExecution()) {
  runElectronDev().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
