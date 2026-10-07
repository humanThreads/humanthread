import { describe, expect, it } from "vitest";

import type { ProjectLoopSyncFilesystem } from "@humanthread/project-loop-sync";
import { runHtRepair } from "./repair";

describe("runHtRepair", () => {
  it("repairs only the requested missing v2 stage without overwriting surviving files", async () => {
    const path = ".humanthread/loops/project--loop_1/subloops/develop--node_a";
    const files = new Map<string, string>([
      [".humanthread/structure/lock.json", JSON.stringify({
        schemaVersion: 2,
        loops: {},
        subloops: {
          node_a: { stableId: "node_a", parentLoopId: "loop_1", path, materialized: true, expectedFiles: [], localContractVersion: 2, platformContractVersion: 2, state: "missing" },
          node_b: { stableId: "node_b", parentLoopId: "loop_1", path: `${path}-b`, materialized: true, expectedFiles: [], localContractVersion: 2, platformContractVersion: 2, state: "missing" },
        },
        migrations: {},
      })],
      [`${path}/rules/project.md`, "Keep this project rule.\n"],
    ]);
    const created: string[] = [];
    const fs: ProjectLoopSyncFilesystem = {
      readText: async (file) => files.get(file) ?? null,
      listTree: async () => [...files.keys()],
      mkdir: async () => undefined,
      writeTextExclusive: async (file, content) => { files.set(file, content); created.push(file); },
      writeTextAtomic: async (file, content) => { files.set(file, content); },
      renameExclusive: async () => undefined,
      removeTransactionTree: async () => undefined,
    };

    const result = await runHtRepair({ cwd: "/repo", stageId: "loop_1/node_a" }, { fs });

    expect(created).toHaveLength(8);
    expect(created.every((file) => file.startsWith(`${path}/`))).toBe(true);
    expect(result).toMatchObject({ stageId: "loop_1/node_a", state: "unconfigured" });
    expect(files.get(`${path}/stage.yaml`)).toContain("configured: false");
    expect(files.get(`${path}/rules/project.md`)).toBe("Keep this project rule.\n");
    expect(files.has(`${path}-b/stage.yaml`)).toBe(false);
  });
});
