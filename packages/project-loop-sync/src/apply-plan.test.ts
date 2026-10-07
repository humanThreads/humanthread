import { describe, expect, it } from "vitest";

import { applyLoopSyncPlan, applyLoopSyncPlanV2 } from "./apply-plan";
import type { LoopSyncPlan, LoopSyncPlanV2, ProjectLoopSyncFilesystem } from "./index";

function plan(): LoopSyncPlan {
  return {
    manifest: {
      schemaVersion: 1,
      projectId: "project_1",
      catalogVersion: `sha256:${"a".repeat(64)}`,
      synchronizedAt: "2026-08-07T06:30:00.000Z",
      projectBindings: [],
      publishedLoops: [],
    },
    lock: { schemaVersion: 1, loops: {}, nodes: {} },
    createDirectories: [".humanthread/loops/example"],
    createFiles: [
      { path: ".humanthread/loops/example/rules.md", content: "local rules\n" },
      { path: ".humanthread/loops/example/node.yaml", content: "configured: false\n" },
    ],
    modifyFiles: [],
    deletePaths: [],
    diagnostics: [],
    blockingIssues: [],
  };
}

function memoryFilesystem(initial: Record<string, string> = {}, failAfterExclusiveWrites?: number) {
  const files = new Map(Object.entries(initial));
  const exclusiveWrites: string[] = [];
  let failed = false;
  const fs: ProjectLoopSyncFilesystem = {
    readText: async (path) => files.get(path) ?? null,
    listTree: async (prefix) => [...files.keys()].filter((path) => path.startsWith(prefix)),
    mkdir: async () => undefined,
    writeTextExclusive: async (path, content) => {
      if (files.has(path)) throw Object.assign(new Error("exists"), { code: "path_exists" });
      files.set(path, content);
      exclusiveWrites.push(path);
      if (!failed && failAfterExclusiveWrites !== undefined && exclusiveWrites.length === failAfterExclusiveWrites) {
        failed = true;
        throw new Error("simulated crash");
      }
    },
    writeTextAtomic: async (path, content) => { files.set(path, content); },
    renameExclusive: async (from, to) => {
      if ([...files.keys()].some((path) => path === to || path.startsWith(`${to}/`))) {
        throw Object.assign(new Error("exists"), { code: "path_exists" });
      }
      const sources = [...files.entries()].filter(([path]) => path === from || path.startsWith(`${from}/`));
      if (sources.length === 0) throw Object.assign(new Error("missing source"), { code: "path_missing" });
      for (const [path, content] of sources) {
        files.set(`${to}${path.slice(from.length)}`, content);
        files.delete(path);
      }
    },
    removeTransactionTree: async (path) => {
      for (const file of [...files.keys()]) if (file === path || file.startsWith(`${path}/`)) files.delete(file);
    },
  };
  return { fs, files, exclusiveWrites };
}

describe("applyLoopSyncPlan", () => {
  it("never overwrites an existing project-owned rule", async () => {
    const fixture = memoryFilesystem({ ".humanthread/loops/example/rules.md": "user content\n" });

    await expect(applyLoopSyncPlan({ plan: plan(), fs: fixture.fs })).rejects.toMatchObject({ code: "local_rule_conflict" });
    expect(fixture.files.get(".humanthread/loops/example/rules.md")).toBe("user content\n");
  });

  it("adopts matching files after an interrupted first init", async () => {
    const fixture = memoryFilesystem({}, 1);

    await expect(applyLoopSyncPlan({ plan: plan(), fs: fixture.fs })).rejects.toThrow("simulated crash");
    await expect(applyLoopSyncPlan({ plan: plan(), fs: fixture.fs })).resolves.toMatchObject({ recovered: true, createdFiles: 1 });
    expect(fixture.files.get(".humanthread/structure/manifest.json")).toContain('"projectId": "project_1"');
    expect(fixture.files.get(".humanthread/structure/lock.json")).toContain('"schemaVersion": 1');
  });
});

function v2Plan(): LoopSyncPlanV2 {
  const source = ".humanthread/loops/project/nodes/develop";
  const backup = ".humanthread/runtime/sync/v1-to-v2-project_1/backup/loops/project/nodes/develop";
  const stage = ".humanthread/loops/project/subloops/develop";
  const manifest = {
    schemaVersion: 2 as const,
    contractVersion: 2 as const,
    projectId: "project_1",
    catalogVersion: `sha256:${"a".repeat(64)}` as const,
    synchronizedAt: "2026-08-07T06:30:00.000Z",
    projectBindings: [],
    publishedLoops: [],
  };
  return {
    kind: "ready",
    transactionId: "v1-to-v2-project_1",
    manifest,
    lock: {
      schemaVersion: 2,
      loops: {},
      subloops: {},
      migrations: { node_develop: { fromVersion: 1, toVersion: 2, status: "completed" } },
    },
    createDirectories: [stage],
    generatedWrites: [
      { path: ".humanthread/structure/manifest.json", content: `${JSON.stringify(manifest)}\n` },
      { path: ".humanthread/structure/lock.json", content: '{"schemaVersion":2}\n' },
    ],
    projectOwnedCreates: [{ path: `${stage}/stage.yaml`, content: "schemaVersion: 2\n" }],
    migrationMoves: [{ from: source, to: backup }],
    diagnostics: [],
    blockingIssues: [],
  };
}

describe("applyLoopSyncPlanV2", () => {
  it("recovers after interruption between v1 backup and v2 lock commit", async () => {
    const source = ".humanthread/loops/project/nodes/develop/node.yaml";
    const fixture = memoryFilesystem({ [source]: "schemaVersion: 1\n" }, 1);

    await expect(applyLoopSyncPlanV2({ plan: v2Plan(), fs: fixture.fs })).rejects.toThrow("simulated crash");
    expect(fixture.files.has(source)).toBe(false);
    expect([...fixture.files.keys()].some((path) => path.includes("/backup/"))).toBe(true);

    await expect(applyLoopSyncPlanV2({ plan: v2Plan(), fs: fixture.fs })).resolves.toMatchObject({
      recovered: true,
      migratedStages: 1,
    });
    expect(fixture.files.get(".humanthread/structure/lock.json")).toContain('"schemaVersion":2');
    expect([...fixture.files.keys()].some((path) => path.includes("/runtime/sync/"))).toBe(false);
  });

  it("does not perform writes for a blocked migration", async () => {
    const fixture = memoryFilesystem({ ".humanthread/loops/project/nodes/develop/rules.md": "user rules\n" });
    const blocked: LoopSyncPlanV2 = {
      ...v2Plan(),
      kind: "blocked",
      generatedWrites: [],
      projectOwnedCreates: [],
      migrationMoves: [],
      blockingIssues: [{ code: "migration_required", nodeId: "node_develop", message: "Migration required" }],
    };

    await expect(applyLoopSyncPlanV2({ plan: blocked, fs: fixture.fs })).rejects.toMatchObject({ code: "migration_required" });
    expect(fixture.files).toEqual(new Map([[".humanthread/loops/project/nodes/develop/rules.md", "user rules\n"]]));
  });

  it("cleans a committed transaction backup even when no migration move remains", async () => {
    const transactionFile = ".humanthread/runtime/sync/v1-to-v2-project_1/backup/loops/project/nodes/develop/node.yaml";
    const fixture = memoryFilesystem({ [transactionFile]: "schemaVersion: 1\n" });
    const committed = { ...v2Plan(), migrationMoves: [] };

    await applyLoopSyncPlanV2({ plan: committed, fs: fixture.fs });

    expect([...fixture.files.keys()].some((path) => path.startsWith(".humanthread/runtime/sync/v1-to-v2-project_1/"))).toBe(false);
  });
});
