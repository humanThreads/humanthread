export * from "./runner";
export * from "./recovery";

import { pathToFileURL } from "node:url";
import { runWorkerLoop } from "./runner";
import { createProductionWorkerIteration } from "./production-runtime";

export * from "./runtime";
export * from "./production-runtime";
export * from "./loop-task-trigger";
export * from "./outbox-router";
export * from "./loop-scheduler";
export * from "./platform-node-executors";
export * from "./loop-platform-execution";
export * from "./loop-waits";
export * from "./loop-knowledge";
export * from "./knowledge-generation-trigger";
export * from "./knowledge-index-dispatcher";
export * from "./knowledge-schedule-runner";
export * from "./scheduled-task-runner";

export async function main() {
  const controller = new AbortController();
  process.once("SIGTERM", () => controller.abort());
  process.once("SIGINT", () => controller.abort());
  const pollMs = Number(process.env.HUMANTHREAD_ORCHESTRATION_POLL_MS ?? "1000");
  if (!Number.isFinite(pollMs) || pollMs < 100) throw new Error("HUMANTHREAD_ORCHESTRATION_POLL_MS must be at least 100");
  await runWorkerLoop({
    pollMs,
    signal: controller.signal,
    iteration: createProductionWorkerIteration(),
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "Orchestration worker failed");
    process.exitCode = 1;
  });
}
