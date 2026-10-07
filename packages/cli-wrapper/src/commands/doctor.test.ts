import { describe, expect, it } from "vitest";

import { renderConfigurationGuide, type ProjectLoopManifestV2, type ProjectLoopSyncFilesystem } from "@humanthread/project-loop-sync";
import { runHtDoctor } from "./doctor";

function fsWith(files: Record<string, string>): ProjectLoopSyncFilesystem {
  return {
    readText: async (path) => files[path] ?? null,
    listTree: async () => Object.keys(files),
    mkdir: async () => undefined,
    writeTextExclusive: async () => undefined,
    writeTextAtomic: async () => undefined,
    renameExclusive: async () => undefined,
    removeTransactionTree: async () => undefined,
  };
}

describe("runHtDoctor", () => {
  it("returns a configuration error before runtime when init has not run", async () => {
    await expect(runHtDoctor({ cwd: "/repo" }, { fs: fsWith({}) })).rejects.toMatchObject({ code: "project_not_initialized" });
  });

  it("validates an initialized v2 project", async () => {
    const manifest: ProjectLoopManifestV2 = {
      contractVersion: 2,
      schemaVersion: 2,
      projectId: "project_1",
      catalogVersion: `sha256:${"a".repeat(64)}`,
      synchronizedAt: "2026-08-07T06:30:00.000Z",
      projectBindings: [],
      publishedLoops: [],
    };
    const lock = { schemaVersion: 2 as const, loops: {}, subloops: {}, migrations: {} };
    const files = {
      ".humanthread/structure/manifest.json": JSON.stringify(manifest),
      ".humanthread/structure/lock.json": JSON.stringify(lock),
      ".humanthread/CONFIGURATION.md": renderConfigurationGuide({ manifest, lock }),
    };

    await expect(runHtDoctor({ cwd: "/repo" }, { fs: fsWith(files) })).resolves.toMatchObject({ ready: true });
  });

  it("reports migration_required for a v1 repository without reading legacy node rules", async () => {
    const legacyPath = ".humanthread/loops/project/nodes/develop";
    const files = {
      ".humanthread/structure/manifest.json": JSON.stringify({
        schemaVersion: 1,
        projectId: "project_1",
        catalogVersion: `sha256:${"a".repeat(64)}`,
        synchronizedAt: "2026-08-07T06:30:00.000Z",
        projectBindings: [],
        publishedLoops: [],
      }),
      ".humanthread/structure/lock.json": JSON.stringify({
        schemaVersion: 1,
        loops: {},
        nodes: {
          develop: {
            stableId: "develop",
            parentLoopId: "loop_project",
            path: legacyPath,
            materialized: true,
            expectedFiles: [
              `${legacyPath}/node.yaml`,
              `${legacyPath}/rules.md`,
              `${legacyPath}/prompt.md`,
              `${legacyPath}/schemas/output.schema.json`,
            ],
            localContractVersion: 1,
            platformContractVersion: 1,
            state: "active",
          },
        },
      }),
      [`${legacyPath}/node.yaml`]: "this content must not be parsed by doctor",
    };

    await expect(runHtDoctor({ cwd: "/repo" }, { fs: fsWith(files) })).resolves.toEqual({
      ready: false,
      errors: [{
        code: "migration_required",
        message: "Local Loop contract v1 is not executable; run ht migrate before continuing",
        nodeId: "develop",
        loopId: "loop_project",
      }],
      warnings: [],
      fingerprints: {},
    });
  });
});
