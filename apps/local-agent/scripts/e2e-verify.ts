import { spawn, type ChildProcess } from "node:child_process";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  findAvailablePort,
  stopChildProcess,
  waitForChildProcessExit,
  waitForHttpReady,
} from "../src/lib/e2e-server.ts";
import { runE2eVerification } from "../src/lib/e2e-verification.ts";

const execFileAsync = promisify(execFile);

function parsePort(): number {
  const raw = process.env.HUMANTHREAD_E2E_PORT?.trim() ?? "3010";
  const port = Number(raw);

  if (!Number.isFinite(port) || port <= 0) {
    throw new Error("HUMANTHREAD_E2E_PORT must be a positive number.");
  }

  return Math.floor(port);
}

function readRequiredEnv(name: string): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`Missing required env: ${name}`);
  }

  return value;
}

function spawnServerProcess(port: number): ChildProcess {
  return spawn(
    "pnpm",
    [
      "--filter",
      "@humanthread/web",
      "exec",
      "next",
      "start",
      "--hostname",
      "127.0.0.1",
      "--port",
      String(port),
    ],
    {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["ignore", "inherit", "inherit"],
    },
  );
}

async function startServer(input: { preferredPort: number }) {
  const port = await findAvailablePort({
    preferredPort: input.preferredPort,
  });
  const child = spawnServerProcess(port);

  return {
    port,
    child,
    async stop() {
      await stopChildProcess(child);
    },
  };
}

async function runSmokeVerify(input: { apiBaseUrl: string }) {
  const env = {
    ...process.env,
    HUMANTHREAD_API_BASE_URL: input.apiBaseUrl,
    HUMANTHREAD_TEAM_ID: process.env.HUMANTHREAD_TEAM_ID?.trim() || "team_1",
    HUMANTHREAD_USER_ID: process.env.HUMANTHREAD_USER_ID?.trim() || "user_owner",
    HUMANTHREAD_DEVICE_ID: readRequiredEnv("HUMANTHREAD_DEVICE_ID"),
    HUMANTHREAD_DEVICE_NAME:
      process.env.HUMANTHREAD_DEVICE_NAME?.trim() || "humanthread-smoke-device",
    HUMANTHREAD_API_TOKEN: readRequiredEnv("HUMANTHREAD_API_TOKEN"),
    HUMANTHREAD_DEVICE_TOKEN: process.env.HUMANTHREAD_DEVICE_TOKEN?.trim() || "",
    HUMANTHREAD_PLATFORM: process.env.HUMANTHREAD_PLATFORM?.trim() || "macos",
  };

  const { stdout } = await execFileAsync(
    "pnpm",
    ["--filter", "@humanthread/local-agent", "smoke:verify"],
    {
      cwd: process.cwd(),
      env,
    },
  );

  const jsonStart = stdout.indexOf("{");

  if (jsonStart < 0) {
    throw new Error("Failed to parse smoke:verify output.");
  }

  return JSON.parse(stdout.slice(jsonStart)) as {
    smoke: unknown;
    verify: unknown;
  };
}

async function main() {
  let startedChild: ChildProcess | null = null;
  const result = await runE2eVerification(
    {
      port: parsePort(),
    },
    {
      startServer: async (input) => {
        const server = await startServer(input);
        startedChild = server.child;
        return server;
      },
      waitUntilReady: async ({ baseUrl }) => {
        if (!startedChild) {
          throw new Error("Missing started server process.");
        }

        await waitForHttpReady({
          baseUrl,
          serverExit: waitForChildProcessExit(startedChild),
        });
      },
      runSmokeVerify,
    },
  );

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : "local-agent e2e verification failed"}\n`,
  );
  process.exitCode = 1;
});
