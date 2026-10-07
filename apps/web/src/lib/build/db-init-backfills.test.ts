import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const repoRoot = new URL("../../../../../", import.meta.url);

const requiredLocalConfigurationSequence = [
  "node prisma/backfill-loop-local-config.mjs",
  "node prisma/backfill-loop-local-config.mjs --apply",
  "node prisma/backfill-loop-local-config.mjs",
] as const;

const requiredProjectWorkerResourceSequence = [
  "node prisma/backfill-project-worker-resources.mjs",
  "node prisma/backfill-project-worker-resources.mjs --apply",
  "node prisma/backfill-project-worker-resources.mjs",
] as const;

function assertLocalConfigurationBackfillSequence(path: string): void {
  const manifest = readFileSync(new URL(path, repoRoot), "utf8");
  const userTasks = manifest.indexOf("node prisma/backfill-user-tasks.mjs");
  const businessIdentifiers = manifest.indexOf("node prisma/backfill-task-business-identifiers.mjs");
  const loopEngine = manifest.indexOf("node prisma/backfill-loop-engine.mjs");
  expect(userTasks).toBeGreaterThanOrEqual(0);
  expect(businessIdentifiers).toBeGreaterThan(userTasks);
  expect(loopEngine).toBeGreaterThan(businessIdentifiers);

  let cursor = manifest.indexOf("node prisma/backfill-loop-engine.mjs --apply");
  expect(cursor).toBeGreaterThanOrEqual(0);

  for (const command of requiredLocalConfigurationSequence) {
    cursor = manifest.indexOf(command, cursor + 1);
    expect(cursor).toBeGreaterThanOrEqual(0);
  }

  for (const command of requiredProjectWorkerResourceSequence) {
    cursor = manifest.indexOf(command, cursor + 1);
    expect(cursor).toBeGreaterThanOrEqual(0);
  }

  expect(cursor).toBeLessThan(manifest.indexOf("node prisma/seed.mjs"));
}

describe("database initialization manifests", () => {
  it.each([
    "deploy/docker-compose.db-init.yml",
    "k8s/humanthread/db-init-job.yaml",
  ])("runs the Loop local configuration backfill idempotently in %s", (path) => {
    assertLocalConfigurationBackfillSequence(path);
  });
});
