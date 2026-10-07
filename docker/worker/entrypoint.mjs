import { spawn } from "node:child_process";

export function validateRuntimeEnvironment(environment) {
  const errors = [];
  if (!environment.HT_WORKER_POOL_TOKEN?.trim()) errors.push("HT_WORKER_POOL_TOKEN is required");
  if (!environment.HT_WORKER_POOL_NAME?.trim()) errors.push("HT_WORKER_POOL_NAME is required");
  return errors;
}

export function renderWorkerName(environment) {
  return environment.HT_WORKER_POOL_NAME?.trim() || "linux-worker";
}

export function runtimeWorkerEnvironment(environment) {
  const instanceId = environment.HT_WORKER_INSTANCE_ID?.trim();
  return {
    ...environment,
    ...(instanceId ? { HT_WORKER_INSTANCE_ID: instanceId } : {}),
  };
}

function main(environment = process.env) {
  const errors = validateRuntimeEnvironment(environment);
  if (!environment.HT_PLATFORM_URL?.trim()) errors.push("HT_PLATFORM_URL is required");
  if (errors.length > 0) throw Object.assign(new Error(errors.join("; ")), { code: "invalid_arguments" });
  const child = spawn("ht", [
    "worker", "run",
    "--platform-url", environment.HT_PLATFORM_URL,
    "--pool-token-env", "HT_WORKER_POOL_TOKEN",
    "--state-dir", environment.HT_WORKER_STATE_DIR?.trim() || "/var/lib/humanthread",
  ], {
    env: runtimeWorkerEnvironment(environment),
    stdio: "inherit",
  });
  child.once("exit", (code, signal) => process.exitCode = signal ? 1 : (code ?? 1));
}

if (import.meta.url === new URL(process.argv[1], "file:").href) main();
