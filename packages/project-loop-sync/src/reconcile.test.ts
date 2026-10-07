import { describe, expect, it } from "vitest";
import { stringify } from "yaml";

import type {
  LocalFileInventory,
  ProjectLoopCatalogV2,
  ProjectLoopLock,
  ProjectLoopManifest,
} from "./contracts";
import { planProjectLoopSyncV2 } from "./reconcile";
import { createStagePackageFileGroup } from "./stage-package";
import { explicitV1MigrationReportPath } from "./migration";

const synchronizedAt = "2026-08-07T06:30:00.000Z";

const emptyInventory: LocalFileInventory = { files: [] };

function catalogV2(input: { name?: string; includeTest?: boolean } = {}): ProjectLoopCatalogV2 {
  const nodes: ProjectLoopCatalogV2["publishedLoops"][number]["publishedVersions"][number]["graph"]["nodes"] = [
    { key: "start", nodeId: "node_start", label: "Start", type: "start", offlinePolicy: "online_required" },
    {
      key: "develop",
      nodeId: "node_develop",
      label: "Develop",
      type: "agent_action",
      executionTarget: "local",
      offlinePolicy: "local_capable",
      responsibility: "Implement the approved requirement.",
      allowedRouteTargets: [input.includeTest ? "node_test" : "node_end"],
    },
    ...(input.includeTest ? [{
      key: "test",
      nodeId: "node_test",
      label: "Test",
      type: "agent_action" as const,
      executionTarget: "local" as const,
      offlinePolicy: "local_capable" as const,
      responsibility: "Verify the implementation and evidence.",
      allowedRouteTargets: ["node_end"],
    }] : []),
    { key: "end", nodeId: "node_end", label: "End", type: "end", offlinePolicy: "online_required" },
  ];
  return {
    contractVersion: 2,
    projectId: "project_1",
    catalogVersion: `sha256:${(input.includeTest ? "b" : "a").repeat(64)}` as ProjectLoopCatalogV2["catalogVersion"],
    projectBindings: [{
      id: "binding_1",
      loopDefinitionId: "loop_project",
      activeVersionId: "version_2",
      status: "enabled",
      bindingRole: "root",
      version: 1,
    }],
    publishedLoops: [{
      loopDefinitionId: "loop_project",
      spaceId: "space_1",
      name: input.name ?? "Project Loop",
      description: null,
      scope: "project",
      origin: "space",
      readOnly: false,
      latestPublishedVersionId: "version_2",
      publishedVersions: [{
        loopVersionId: "version_2",
        versionNumber: 2,
        graph: {
          schemaVersion: 2,
          limits: { maxStages: 8, maxRepeatCount: 2 },
          nodes,
          edges: [
            { id: "edge_start", source: "start", target: "develop", kind: "normal", outcome: "success" },
            ...(input.includeTest
              ? [{ id: "edge_test", source: "develop", target: "test", kind: "normal" as const, outcome: "success" as const }]
              : []),
            { id: "edge_end", source: input.includeTest ? "test" : "develop", target: "end", kind: "normal", outcome: "success" },
          ],
        },
      }],
    }],
  };
}

function legacyFixture(): {
  manifest: ProjectLoopManifest;
  lock: ProjectLoopLock;
  contents: Record<string, string>;
} {
  const loopPath = ".humanthread/loops/project-loop--loop_project";
  const sourcePath = `${loopPath}/nodes/develop--node_develop`;
  const graph = {
    schemaVersion: 1 as const,
    limits: { maxStages: 8, maxRepeatCount: 2 },
    nodes: [
      { key: "start", nodeId: "node_start", label: "Start", type: "start" as const, offlinePolicy: "online_required" as const },
      { key: "develop", nodeId: "node_develop", label: "Develop", type: "agent_action" as const, executionTarget: "local" as const, offlinePolicy: "local_capable" as const },
      { key: "end", nodeId: "node_end", label: "End", type: "end" as const, offlinePolicy: "online_required" as const },
    ],
    edges: [
      { id: "edge_start", source: "start", target: "develop", kind: "normal" as const, outcome: "success" as const },
      { id: "edge_end", source: "develop", target: "end", kind: "normal" as const, outcome: "success" as const },
    ],
  };
  const manifest: ProjectLoopManifest = {
    schemaVersion: 1,
    projectId: "project_1",
    catalogVersion: `sha256:${"a".repeat(64)}`,
    synchronizedAt,
    projectBindings: [{ id: "binding_1", loopDefinitionId: "loop_project", activeVersionId: "version_1", status: "enabled", bindingRole: "root", version: 1 }],
    publishedLoops: [{
      loopDefinitionId: "loop_project",
      spaceId: "space_1",
      name: "Project Loop",
      description: null,
      scope: "project",
      origin: "space",
      readOnly: false,
      latestPublishedVersionId: "version_1",
      publishedVersions: [{ loopVersionId: "version_1", versionNumber: 1, graph }],
    }],
  };
  const expectedFiles = ["node.yaml", "rules.md", "prompt.md", "schemas/output.schema.json"]
    .map((path) => `${sourcePath}/${path}`);
  const lock: ProjectLoopLock = {
    schemaVersion: 1,
    loops: {
      loop_project: {
        stableId: "loop_project",
        path: loopPath,
        materialized: true,
        expectedFiles: [`${loopPath}/loop.yaml`],
        localContractVersion: 1,
        platformContractVersion: 1,
        state: "active",
      },
    },
    nodes: {
      node_develop: {
        stableId: "node_develop",
        parentLoopId: "loop_project",
        path: sourcePath,
        materialized: true,
        expectedFiles,
        localContractVersion: 1,
        platformContractVersion: 1,
        state: "unconfigured",
      },
    },
  };
  const contents = {
    [`${sourcePath}/node.yaml`]: stringify({
      schemaVersion: 1,
      loopId: "loop_project",
      nodeId: "node_develop",
      configured: false,
      instructions: "rules.md",
      prompt: "prompt.md",
      skillsDirectory: "skills",
      outputSchema: "schemas/output.schema.json",
      checks: [],
    }),
    [`${sourcePath}/rules.md`]: "# Develop Rules\n\nConfigure this node for the current project.\n",
    [`${sourcePath}/prompt.md`]: "Execute the Develop node for this project.\n",
    [`${sourcePath}/schemas/output.schema.json`]: `${JSON.stringify({
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      additionalProperties: false,
      properties: {},
    }, null, 2)}\n`,
  };
  return { manifest, lock, contents };
}

describe("planProjectLoopSyncV2", () => {
  it("只物化项目已启用绑定的 Loop，不落地未选择的发布 Loop", () => {
    const selected = catalogV2();
    const dormant = {
      ...selected.publishedLoops[0]!,
      loopDefinitionId: "loop_dormant",
      name: "Dormant Loop",
      latestPublishedVersionId: "version_dormant",
      publishedVersions: selected.publishedLoops[0]!.publishedVersions.map((version) => ({
        ...version,
        loopVersionId: "version_dormant",
      })),
    };
    const plan = planProjectLoopSyncV2({
      catalog: { ...selected, publishedLoops: [...selected.publishedLoops, dormant] },
      previousManifest: null,
      previousLock: null,
      inventory: emptyInventory,
      synchronizedAt,
    });

    expect(plan.kind).toBe("ready");
    expect(plan.lock.loops.loop_project).toBeDefined();
    expect(plan.lock.loops.loop_dormant).toBeUndefined();
    expect(plan.generatedWrites.map(({ path }) => path).join("\n")).not.toContain("dormant");
  });

  it("递归物化已选 Loop 引用的 SubLoop 依赖", () => {
    const root = catalogV2();
    const dependency = {
      ...root.publishedLoops[0]!,
      loopDefinitionId: "loop_dependency",
      name: "Dependency Loop",
      latestPublishedVersionId: "version_dependency",
      publishedVersions: root.publishedLoops[0]!.publishedVersions.map((version) => ({
        ...version,
        loopVersionId: "version_dependency",
        graph: {
          ...version.graph,
          nodes: [
            { key: "start", nodeId: "dep_start", label: "Start", type: "start" as const, offlinePolicy: "online_required" as const },
            { key: "work", nodeId: "dep_work", label: "Dependency Work", type: "agent_action" as const, executionTarget: "local" as const, offlinePolicy: "local_capable" as const, responsibility: "Run dependency work.", allowedRouteTargets: ["dep_end"] },
            { key: "end", nodeId: "dep_end", label: "End", type: "end" as const, offlinePolicy: "online_required" as const },
          ],
          edges: [
            { id: "dep_start_work", source: "start", target: "work", kind: "normal" as const, outcome: "success" as const },
            { id: "dep_work_end", source: "work", target: "end", kind: "normal" as const, outcome: "success" as const },
          ],
        },
      })),
    };
    const rootVersion = root.publishedLoops[0]!.publishedVersions[0]!;
    const rootLoop = {
      ...root.publishedLoops[0]!,
      publishedVersions: [{
        ...rootVersion,
        graph: {
          ...rootVersion.graph,
          nodes: [
            ...rootVersion.graph.nodes.map((node) => node.key === "develop"
              ? { ...node, allowedRouteTargets: ["dependency_call"] }
              : node),
            {
              key: "dependency",
              nodeId: "dependency_call",
              label: "Dependency",
              type: "subloop_call" as const,
              executionTarget: "platform" as const,
              offlinePolicy: "online_required" as const,
              targetLoopDefinitionId: "loop_dependency",
              targetLoopVersionId: "version_dependency",
              inputMapping: {},
              terminalOutcomeMapping: { success: "success" as const },
              responsibility: "Run dependency.",
              allowedRouteTargets: ["node_end"],
            },
          ],
          edges: [
            ...rootVersion.graph.edges.filter((edge) => edge.id !== "edge_end"),
            { id: "edge_dependency", source: "develop", target: "dependency", kind: "normal" as const, outcome: "success" as const },
            { id: "edge_end", source: "dependency", target: "end", kind: "normal" as const, outcome: "success" as const },
          ],
        },
      }],
    };
    const plan = planProjectLoopSyncV2({
      catalog: {
        ...root,
        publishedLoops: [rootLoop, dependency],
      },
      previousManifest: null,
      previousLock: null,
      inventory: emptyInventory,
      synchronizedAt,
    });

    expect(plan.kind).toBe("ready");
    expect(plan.lock.loops.loop_project).toBeDefined();
    expect(plan.lock.loops.loop_dependency).toBeDefined();
    expect(plan.lock.subloops.dep_work).toBeDefined();
  });

  it("对启用绑定引用的缺失 Loop 返回明确阻塞诊断", () => {
    const base = catalogV2();
    const plan = planProjectLoopSyncV2({
      catalog: { ...base, projectBindings: [{ ...base.projectBindings[0]!, loopDefinitionId: "loop_missing", activeVersionId: "version_missing" }], publishedLoops: [] },
      previousManifest: null,
      previousLock: null,
      inventory: emptyInventory,
      synchronizedAt,
    });

    expect(plan.kind).toBe("blocked");
    expect(plan.blockingIssues).toContainEqual(expect.objectContaining({ code: "active_subloop_unreachable", loopId: "loop_missing" }));
  });

  it("keeps every project-owned byte unchanged on repeated init and preserves stable paths", () => {
    const first = planProjectLoopSyncV2({
      catalog: catalogV2(),
      previousManifest: null,
      previousLock: null,
      inventory: emptyInventory,
      synchronizedAt,
    });
    expect(first.kind).toBe("ready");
    const stage = first.lock.subloops.node_develop!;
    const projectFiles = new Map(first.projectOwnedCreates.map((file) => [file.path, file.content]));
    projectFiles.set(`${stage.path}/rules/project.md`, "必须执行项目测试\n");
    projectFiles.set(`${stage.path}/prompts/main.md`, "项目自定义执行步骤\n");
    const before = new Map(projectFiles);

    const second = planProjectLoopSyncV2({
      catalog: catalogV2({ name: "Renamed Project Loop" }),
      previousManifest: first.manifest,
      previousLock: first.lock,
      inventory: { files: [...projectFiles.keys()] },
      synchronizedAt,
    });

    expect(second.kind).toBe("ready");
    expect(second.projectOwnedCreates).toEqual([]);
    expect(second.lock.loops.loop_project?.path).toBe(first.lock.loops.loop_project?.path);
    expect(second.lock.subloops.node_develop?.path).toBe(stage.path);
    expect(projectFiles).toEqual(before);
    expect(second.generatedWrites.map(({ path }) => path)).toEqual(expect.arrayContaining([
      ".humanthread/structure/manifest.json",
      ".humanthread/structure/lock.json",
      expect.stringMatching(/\/loop\.yaml$/u),
    ]));
  });

  it("creates only a newly published local stage and retains removed entries as orphaned", () => {
    const first = planProjectLoopSyncV2({
      catalog: catalogV2(), previousManifest: null, previousLock: null, inventory: emptyInventory, synchronizedAt,
    });
    const firstFiles = first.projectOwnedCreates.map(({ path }) => path);
    const second = planProjectLoopSyncV2({
      catalog: catalogV2({ includeTest: true }),
      previousManifest: first.manifest,
      previousLock: first.lock,
      inventory: { files: firstFiles },
      synchronizedAt,
    });

    expect(second.projectOwnedCreates.length).toBeGreaterThan(0);
    expect(second.projectOwnedCreates.every(({ path }) => path.startsWith(second.lock.subloops.node_test!.path))).toBe(true);
    expect(second.projectOwnedCreates.some(({ path }) => path.startsWith(first.lock.subloops.node_develop!.path))).toBe(false);

    const removed = planProjectLoopSyncV2({
      catalog: { ...catalogV2(), projectBindings: [], publishedLoops: [] },
      previousManifest: second.manifest,
      previousLock: second.lock,
      inventory: { files: [...firstFiles, ...second.projectOwnedCreates.map(({ path }) => path)] },
      synchronizedAt,
    });
    expect(removed.lock.loops.loop_project?.state).toBe("orphaned");
    expect(removed.lock.subloops.node_develop?.state).toBe("orphaned");
    expect(removed.lock.subloops.node_test?.state).toBe("orphaned");
    expect(removed.projectOwnedCreates).toEqual([]);
  });

  it("rebuilds an automatic v1 migration plan from a transaction backup after restart", () => {
    const legacy = legacyFixture();
    const contents = { ...legacy.contents };
    const first = planProjectLoopSyncV2({
      catalog: catalogV2(),
      previousManifest: legacy.manifest,
      previousLock: legacy.lock,
      inventory: { files: Object.keys(contents), contents },
      synchronizedAt,
    });
    expect(first.kind).toBe("ready");
    expect(first.migrationMoves).toHaveLength(1);

    const move = first.migrationMoves[0]!;
    const afterBackup = Object.fromEntries(Object.entries(contents).map(([path, content]) => (
      path.startsWith(`${move.from}/`)
        ? [`${move.to}${path.slice(move.from.length)}`, content]
        : [path, content]
    )));
    const retry = planProjectLoopSyncV2({
      catalog: catalogV2(),
      previousManifest: legacy.manifest,
      previousLock: legacy.lock,
      inventory: { files: Object.keys(afterBackup), contents: afterBackup },
      synchronizedAt,
    });

    expect(retry.kind).toBe("ready");
    expect(retry.migrationMoves).toEqual(first.migrationMoves);
  });

  it("returns a write-free blocked plan when any v1 template byte changed", () => {
    const legacy = legacyFixture();
    const contents = { ...legacy.contents };
    const rulesPath = Object.keys(contents).find((path) => path.endsWith("/rules.md"))!;
    contents[rulesPath] = "用户规则\n";

    const plan = planProjectLoopSyncV2({
      catalog: catalogV2(),
      previousManifest: legacy.manifest,
      previousLock: legacy.lock,
      inventory: { files: Object.keys(contents), contents },
      synchronizedAt,
    });

    expect(plan.kind).toBe("blocked");
    expect(plan.blockingIssues).toContainEqual(expect.objectContaining({ code: "migration_required", nodeId: "node_develop" }));
    expect(plan.generatedWrites).toEqual([]);
    expect(plan.projectOwnedCreates).toEqual([]);
    expect(plan.migrationMoves).toEqual([]);
  });

  it("accepts a prepared explicit v1 migration on the next init", () => {
    const legacy = legacyFixture();
    const sourcePath = legacy.lock.nodes.node_develop!.path;
    const blockedContents = { ...legacy.contents };
    const rulesPath = Object.keys(blockedContents).find((path) => path.endsWith("/rules.md"))!;
    blockedContents[rulesPath] = "Project-specific rule.\n";
    const blocked = planProjectLoopSyncV2({
      catalog: catalogV2(),
      previousManifest: legacy.manifest,
      previousLock: legacy.lock,
      inventory: { files: Object.keys(blockedContents), contents: blockedContents },
      synchronizedAt,
    });
    const stagePath = blocked.lock.subloops.node_develop!.path;
    const backupPath = `.humanthread/runtime/sync/explicit-v1-to-v2-loop_project-node_develop/backup/${sourcePath.slice(".humanthread/".length)}`;
    const group = createStagePackageFileGroup({ loopId: "loop_project", subloopId: "node_develop", path: stagePath, label: "Develop" });
    const prepared = Object.fromEntries([
      ...Object.entries(blockedContents).map(([path, content]) => [`${backupPath}${path.slice(sourcePath.length)}`, content]),
      ...group.files.map((file) => [file.path, file.content]),
    ]);
    const reportPath = explicitV1MigrationReportPath("loop_project", "node_develop");
    prepared[reportPath] = `${JSON.stringify({
      schemaVersion: 1,
      stageId: "loop_project/node_develop",
      loopId: "loop_project",
      subloopId: "node_develop",
      sourcePath,
      backupPath,
      stagePath,
      status: "prepared",
      createdAt: synchronizedAt,
    }, null, 2)}\n`;

    const plan = planProjectLoopSyncV2({
      catalog: catalogV2(),
      previousManifest: legacy.manifest,
      previousLock: legacy.lock,
      inventory: { files: Object.keys(prepared), contents: prepared },
      synchronizedAt,
    });

    expect(plan.kind).toBe("ready");
    expect(plan.lock.migrations.node_develop).toEqual({ fromVersion: 1, toVersion: 2, status: "completed" });
    expect(plan.projectOwnedCreates).toEqual([]);
    expect(plan.migrationMoves).toEqual([]);
  });
});

export type ReconciliationFixtureTypes = ProjectLoopManifest | ProjectLoopLock;
