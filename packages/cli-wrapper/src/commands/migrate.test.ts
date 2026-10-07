import { describe, expect, it } from "vitest";

import type { ProjectLoopSyncFilesystem } from "@humanthread/project-loop-sync";
import { runHtMigrate } from "./migrate";

describe("runHtMigrate", () => {
  it("writes a report before moving the selected modified v1 stage and never overwrites a v2 target", async () => {
    const source = ".humanthread/loops/project--loop_1/nodes/develop--node_a";
    const files = new Map<string, string>([
      [".humanthread/structure/lock.json", JSON.stringify({
        schemaVersion: 1,
        loops: { loop_1: { stableId: "loop_1", path: ".humanthread/loops/project--loop_1", materialized: true, expectedFiles: [], localContractVersion: 1, platformContractVersion: 1, state: "active" } },
        nodes: { node_a: { stableId: "node_a", parentLoopId: "loop_1", path: source, materialized: true, expectedFiles: [], localContractVersion: 1, platformContractVersion: 2, state: "migration_required" } },
      })],
      [`${source}/node.yaml`, "schemaVersion: 1\nloopId: loop_1\nnodeId: node_a\nconfigured: true\n"],
      [`${source}/rules.md`, "Project-specific rule.\n"],
      [`${source}/prompt.md`, "Implement the task.\n"],
      [`${source}/schemas/output.schema.json`, "{\"type\":\"object\"}\n"],
    ]);
    const events: string[] = [];
    const fs: ProjectLoopSyncFilesystem = {
      readText: async (file) => files.get(file) ?? null,
      listTree: async (prefix) => [...files.keys()].filter((file) => file.startsWith(`${prefix}/`)),
      mkdir: async () => undefined,
      writeTextExclusive: async (file, content) => {
        if (files.has(file)) throw new Error(`exists: ${file}`);
        events.push(`write:${file}`);
        files.set(file, content);
      },
      writeTextAtomic: async (file, content) => { events.push(`atomic:${file}`); files.set(file, content); },
      renameExclusive: async (from, to) => {
        events.push(`move:${from}`);
        for (const [file, content] of [...files.entries()]) {
          if (!file.startsWith(`${from}/`)) continue;
          files.delete(file);
          files.set(`${to}${file.slice(from.length)}`, content);
        }
      },
      removeTransactionTree: async () => undefined,
    };

    const result = await runHtMigrate({ cwd: "/repo", stageId: "loop_1/node_a" }, {
      fs,
      now: () => new Date("2026-08-07T06:30:00.000Z"),
    });

    expect(result).toMatchObject({ stageId: "loop_1/node_a", changed: true });
    expect(result.reportPath).toMatch(/^\.humanthread\/migrations\//u);
    expect(events.indexOf(`write:${result.reportPath}`)).toBeLessThan(events.indexOf(`move:${source}`));
    expect([...files.values()]).toContain("Project-specific rule.\n");
    expect([...files.values()]).toContain("Implement the task.\n");

    await expect(runHtMigrate({ cwd: "/repo", stageId: "loop_1/node_a" }, {
      fs,
      now: () => new Date("2026-08-07T07:30:00.000Z"),
    })).resolves.toMatchObject({ reportPath: result.reportPath, createdFiles: [] });
  });
});
