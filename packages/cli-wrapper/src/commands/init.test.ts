import { describe, expect, it, vi } from "vitest";

import type { ProjectLoopSyncFilesystem } from "@humanthread/project-loop-sync";
import { runHtInit } from "./init";

function memoryFilesystem(initial: Record<string, string> = {}) {
  const files = new Map(Object.entries(initial));
  const writes: string[] = [];
  const fs: ProjectLoopSyncFilesystem = {
    readText: async (path) => files.get(path) ?? null,
    listTree: async (prefix) => [...files.keys()].filter((path) => path.startsWith(prefix)),
    mkdir: async () => undefined,
    writeTextExclusive: async (path, content) => {
      if (files.has(path)) throw new Error("exists");
      files.set(path, content);
      writes.push(path);
    },
    writeTextAtomic: async (path, content) => { files.set(path, content); writes.push(path); },
    renameExclusive: async () => undefined,
    removeTransactionTree: async () => undefined,
  };
  return { fs, files, writes };
}

const catalog = {
  contractVersion: 2 as const,
  projectId: "project_existing",
  catalogVersion: `sha256:${"a".repeat(64)}` as const,
  projectBindings: [],
  publishedLoops: [],
};

describe("runHtInit", () => {
  it("creates project constraints and structural files on first init", async () => {
    const fixture = memoryFilesystem();
    const readCatalog = vi.fn().mockResolvedValue({ ...catalog, projectId: "project_1" });

    const result = await runHtInit({ cwd: "/repo", projectId: "project_1" }, { fs: fixture.fs, readCatalog, now: () => new Date("2026-08-07T06:30:00.000Z") });

    expect(readCatalog).toHaveBeenCalledWith("project_1");
    expect(fixture.files.get("humanthread.yaml")).toContain("schemaVersion: 1");
    expect(fixture.files.get(".humanthread/structure/manifest.json")).toContain('"projectId": "project_1"');
    expect(result).toMatchObject({
      synchronized: true,
      configurationGuide: ".humanthread/CONFIGURATION.md",
      migratedStages: 0,
      warnings: [],
    });
    expect(fixture.files.get(".humanthread/CONFIGURATION.md")).toContain("HumanThread 项目 Loop 配置向导");
    expect(fixture.files.get("CLAUDE.md")).toContain(".agents/skills/");
  });

  it("uses the existing manifest project and preserves all project-owned files", async () => {
    const existingManifest = JSON.stringify({ ...catalog, schemaVersion: 2, synchronizedAt: "2026-08-07T06:00:00.000Z" });
    const existingLock = JSON.stringify({ schemaVersion: 2, loops: {}, subloops: {}, migrations: {} });
    const fixture = memoryFilesystem({
      "humanthread.yaml": "user constraints\n",
      ".humanthread/structure/manifest.json": existingManifest,
      ".humanthread/structure/lock.json": existingLock,
    });
    const readCatalog = vi.fn().mockResolvedValue(catalog);

    await runHtInit({ cwd: "/repo", projectId: "project_other" }, { fs: fixture.fs, readCatalog, now: () => new Date("2026-08-07T06:30:00.000Z") });

    expect(readCatalog).toHaveBeenCalledWith("project_existing");
    expect(fixture.files.get("humanthread.yaml")).toBe("user constraints\n");
  });

  it("requires a project identity on first init", async () => {
    const fixture = memoryFilesystem();
    await expect(runHtInit({ cwd: "/repo" }, { fs: fixture.fs, readCatalog: vi.fn(), now: () => new Date() })).rejects.toMatchObject({ code: "project_identity_required" });
  });
});
