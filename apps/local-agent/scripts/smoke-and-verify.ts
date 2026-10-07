import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { runSmokeAndVerifyEvents } from "../src/lib/smoke-verification.ts";
import type { AgentEventVerificationSummary } from "../src/lib/agent-event-verification-report.ts";
import { runLocalAgentSmoke } from "../src/lib/smoke.ts";

const execFileAsync = promisify(execFile);

function readRequiredEnv(name: string): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`Missing required env: ${name}`);
  }

  return value;
}

function parseTake(): number | undefined {
  const raw = process.env.HUMANTHREAD_VERIFY_EVENT_TAKE?.trim();

  if (!raw) {
    return undefined;
  }

  const value = Number(raw);

  if (!Number.isFinite(value) || value <= 0) {
    throw new Error("HUMANTHREAD_VERIFY_EVENT_TAKE must be a positive number.");
  }

  return Math.floor(value);
}

async function runVerify(input: {
  taskId: string;
  take?: number;
  expectedTypes: string[];
  latestOnly: boolean;
}): Promise<AgentEventVerificationSummary> {
  const env = {
    ...process.env,
    HUMANTHREAD_VERIFY_TASK_ID: input.taskId,
    HUMANTHREAD_VERIFY_EXPECT_TYPES: input.expectedTypes.join(","),
    HUMANTHREAD_VERIFY_LATEST_ONLY: input.latestOnly ? "true" : "false",
    ...(typeof input.take === "number"
      ? { HUMANTHREAD_VERIFY_EVENT_TAKE: String(input.take) }
      : {}),
  };

  const { stdout } = await execFileAsync(
    "pnpm",
    ["--filter", "@humanthread/local-agent", "verify:events"],
    {
      cwd: process.cwd(),
      env,
    },
  );

  const jsonStart = stdout.lastIndexOf("\n{") >= 0
    ? stdout.lastIndexOf("\n{") + 1
    : stdout.indexOf("{");

  if (jsonStart < 0) {
    throw new Error("Failed to parse verify:events output.");
  }

  return JSON.parse(stdout.slice(jsonStart)) as AgentEventVerificationSummary;
}

async function main() {
  const verifyTake = parseTake();
  const result = await runSmokeAndVerifyEvents(
    {
      smokeInput: {
        apiBaseUrl: readRequiredEnv("HUMANTHREAD_API_BASE_URL"),
        teamId: process.env.HUMANTHREAD_TEAM_ID?.trim() || "team_1",
        userId: process.env.HUMANTHREAD_USER_ID?.trim() || "user_owner",
        deviceId: readRequiredEnv("HUMANTHREAD_DEVICE_ID"),
        deviceName:
          process.env.HUMANTHREAD_DEVICE_NAME?.trim() || "humanthread-smoke-device",
        apiToken: readRequiredEnv("HUMANTHREAD_API_TOKEN"),
        deviceToken: process.env.HUMANTHREAD_DEVICE_TOKEN?.trim() || "",
        platform:
          (process.env.HUMANTHREAD_PLATFORM?.trim() as
            | "macos"
            | "windows"
            | "linux"
            | "web"
            | "unknown"
            | undefined) || "macos",
      },
      verifyInput:
        typeof verifyTake === "number"
          ? {
              take: verifyTake,
            }
          : {},
    },
    {
      runSmoke: runLocalAgentSmoke,
      runVerify,
    },
  );

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);

  if (result.verify && !result.verify.ok) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : "local-agent smoke-and-verify failed"}\n`,
  );
  process.exitCode = 1;
});
