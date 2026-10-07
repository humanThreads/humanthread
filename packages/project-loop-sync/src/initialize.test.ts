import { describe, expect, it } from "vitest";

import type { ProjectLoopCatalogV2, ProjectLoopSyncFilesystem } from "./contracts";
import { initializeProjectLoops, readProjectLoopInitializationState } from "./initialize";

function catalog(): ProjectLoopCatalogV2 {
  return {
    contractVersion: 2,
    projectId: "project_1",
    catalogVersion: `sha256:${"a".repeat(64)}`,
    projectBindings: [{
      id: "binding_1",
      loopDefinitionId: "loop_1",
      activeVersionId: "version_1",
      status: "enabled",
      bindingRole: "root",
      version: 1,
    }],
    publishedLoops: [{
      loopDefinitionId: "loop_1",
      spaceId: "space_1",
      name: "Project Development",
      description: null,
      scope: "project",
      origin: "space",
      readOnly: false,
      latestPublishedVersionId: "version_1",
      publishedVersions: [{
        loopVersionId: "version_1",
        versionNumber: 1,
        graph: {
          schemaVersion: 2,
          limits: { maxStages: 8, maxRepeatCount: 2 },
          nodes: [
            { key: "start", nodeId: "start", label: "Start", type: "start", offlinePolicy: "online_required" },
            {
              key: "develop",
              nodeId: "develop",
              label: "Develop",
              type: "agent_action",
              executionTarget: "local",
              offlinePolicy: "local_capable",
              responsibility: "Implement the approved requirement.",
              allowedRouteTargets: ["end"],
            },
            { key: "end", nodeId: "end", label: "End", type: "end", offlinePolicy: "online_required" },
          ],
          edges: [
            { id: "start-develop", source: "start", target: "develop", kind: "normal", outcome: "success" },
            { id: "develop-end", source: "develop", target: "end", kind: "normal", outcome: "success" },
          ],
        },
      }],
    }],
  };
}

function memoryFilesystem(initial: Record<string, string> = {}) {
  const files = new Map(Object.entries(initial));
  const fs: ProjectLoopSyncFilesystem = {
    readText: async (path) => files.get(path) ?? null,
    listTree: async (prefix) => [...files.keys()].filter((path) => path === prefix || path.startsWith(`${prefix}/`)).sort(),
    mkdir: async () => undefined,
    writeTextExclusive: async (path, content) => {
      if (files.has(path)) throw Object.assign(new Error(`exists: ${path}`), { code: "path_exists" });
      files.set(path, content);
    },
    writeTextAtomic: async (path, content) => { files.set(path, content); },
    renameExclusive: async (from, to) => {
      const moved = [...files.entries()].filter(([path]) => path.startsWith(`${from}/`));
      for (const [path] of moved) files.delete(path);
      for (const [path, content] of moved) files.set(`${to}${path.slice(from.length)}`, content);
    },
    removeTransactionTree: async (prefix) => {
      for (const path of [...files.keys()]) if (path === prefix || path.startsWith(`${prefix}/`)) files.delete(path);
    },
  };
  return { files, fs };
}

describe("initializeProjectLoops", () => {
  it("does not read runtime logs while collecting migration state", async () => {
    const fixture = memoryFilesystem({ ".humanthread/runtime/run_1/provider.log": "large runtime output" });
    const readText = fixture.fs.readText;
    fixture.fs.readText = async (path) => {
      if (path === ".humanthread/runtime/run_1/provider.log") throw new Error("runtime log must not be read by init");
      return readText(path);
    };

    await expect(readProjectLoopInitializationState(fixture.fs)).resolves.toMatchObject({
      inventory: { files: [".humanthread/runtime/run_1/provider.log"], contents: {} },
    });
  });

  it("produces deterministic v2 files and preserves CLAUDE.md outside its managed block", async () => {
    const first = memoryFilesystem({ "CLAUDE.md": "# User rules\n\nKeep this text.\n" });
    const second = memoryFilesystem({ "CLAUDE.md": "# User rules\n\nKeep this text.\n" });

    const run = async (fixture: ReturnType<typeof memoryFilesystem>) => initializeProjectLoops({
      fs: fixture.fs,
      catalog: catalog(),
      previousState: await readProjectLoopInitializationState(fixture.fs),
      now: new Date("2026-08-07T06:30:00.000Z"),
    });
    const firstResult = await run(first);
    const secondResult = await run(second);

    expect(firstResult).toMatchObject({
      createdFiles: 8,
      adoptedFiles: 0,
      migratedStages: 0,
      configurationGuide: ".humanthread/CONFIGURATION.md",
      warnings: [],
      blockingIssues: [],
    });
    expect(first.files.get("CLAUDE.md")).toContain("# User rules\n\nKeep this text.\n");
    expect(first.files.get("CLAUDE.md")).toContain("<!-- HUMANTHREAD:SKILLS:START -->");
    expect(first.files.get("CLAUDE.md")).toContain(".agents/skills/");
    expect(first.files.get(".humanthread/CONFIGURATION.md")).toContain("Implement the approved requirement.");
    expect(first.files.get(".humanthread/CONFIGURATION.md")).toContain("本地规则整理引导");
    expect(Object.fromEntries(first.files)).toEqual(Object.fromEntries(second.files));

    const repeated = await run(first);
    expect(repeated).toMatchObject({ createdFiles: 0, adoptedFiles: 0, migratedStages: 0 });
    expect(first.files.get("CLAUDE.md")).toContain("Keep this text.");
  });
});
