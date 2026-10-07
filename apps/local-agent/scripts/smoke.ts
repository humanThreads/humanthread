import { runLocalAgentSmoke } from "../src/lib/smoke.ts";

function readRequiredEnv(name: string): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`Missing required env: ${name}`);
  }

  return value;
}

async function main() {
  const result = await runLocalAgentSmoke({
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
  });

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : "local-agent smoke failed"}\n`,
  );
  process.exitCode = 1;
});
