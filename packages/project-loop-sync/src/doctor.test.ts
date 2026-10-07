import { describe, expect, it } from "vitest";

import { parse, stringify } from "yaml";

import type { ProjectLoopLockV2, ProjectLoopManifestV2 } from "./contracts";
import { renderConfigurationGuide } from "./configuration-guide";
import { readProjectLoopStageContract, validateProjectLoopReadiness } from "./doctor";
import { createStagePackageFileGroup } from "./stage-package";

function v2Fixture() {
  const stage = (loopId: string, versionId: string, subloopId: string) => ({
    loopDefinitionId: loopId,
    spaceId: "space_1",
    name: loopId,
    description: null,
    scope: "task" as const,
    origin: "space" as const,
    readOnly: false,
    latestPublishedVersionId: versionId,
    publishedVersions: [{
      loopVersionId: versionId,
      versionNumber: 1,
      graph: {
        schemaVersion: 2 as const,
        limits: { maxStages: 4, maxRepeatCount: 2 },
        nodes: [
          { key: "start", nodeId: `start_${subloopId}`, label: "Start", type: "start" as const, offlinePolicy: "online_required" as const },
          { key: "work", nodeId: subloopId, label: subloopId, type: "agent_action" as const, executionTarget: "local" as const, offlinePolicy: "local_capable" as const, responsibility: `Execute ${subloopId}`, allowedRouteTargets: [`end_${subloopId}`] },
          { key: "end", nodeId: `end_${subloopId}`, label: "End", type: "end" as const, offlinePolicy: "online_required" as const },
        ],
        edges: [
          { id: `to_${subloopId}`, source: "start", target: "work", kind: "normal" as const, outcome: "success" as const },
          { id: `from_${subloopId}`, source: "work", target: "end", kind: "normal" as const, outcome: "success" as const },
        ],
      },
    }],
  });
  const manifest: ProjectLoopManifestV2 = {
    schemaVersion: 2,
    contractVersion: 2,
    projectId: "project_1",
    catalogVersion: `sha256:${"b".repeat(64)}`,
    synchronizedAt: "2026-08-07T06:30:00.000Z",
    projectBindings: [{ id: "binding_1", loopDefinitionId: "loop_active", activeVersionId: "version_active", status: "enabled", bindingRole: "root", version: 1 }],
    publishedLoops: [stage("loop_active", "version_active", "develop"), stage("loop_dormant", "version_dormant", "unused-loop")],
  };
  const groups = [
    createStagePackageFileGroup({ loopId: "loop_active", subloopId: "develop", path: ".humanthread/loops/active/subloops/develop", label: "Develop" }),
    createStagePackageFileGroup({ loopId: "loop_dormant", subloopId: "unused-loop", path: ".humanthread/loops/dormant/subloops/unused", label: "Unused" }),
  ];
  const files = Object.fromEntries(groups.flatMap((group) => group.files.map((file) => [file.path, file.content])));
  const entry = (stableId: string, parentLoopId: string, path: string, expectedFiles: string[], state: "unconfigured" | "orphaned" = "unconfigured") => ({
    stableId,
    parentLoopId,
    path,
    materialized: true,
    expectedFiles,
    localContractVersion: 2,
    platformContractVersion: 2,
    state,
  });
  const lock: ProjectLoopLockV2 = {
    schemaVersion: 2,
    loops: {},
    subloops: {
      develop: entry("develop", "loop_active", ".humanthread/loops/active/subloops/develop", groups[0]!.files.map(({ path }) => path)),
      "unused-loop": entry("unused-loop", "loop_dormant", ".humanthread/loops/dormant/subloops/unused", groups[1]!.files.map(({ path }) => path)),
      orphan: entry("orphan", "loop_removed", ".humanthread/loops/removed/subloops/orphan", [], "orphaned"),
    },
    migrations: {},
  };
  const readText = async (path: string) => files[path] ?? null;
  const listTree = async (path: string) => Object.keys(files).filter((file) => file.startsWith(`${path}/`)).sort();
  return { manifest, lock, files, readText, listTree };
}

describe("Stage Package v2 Doctor", () => {
  it("blocks a reachable stage but only warns for dormant and orphaned stages", async () => {
    const fixture = v2Fixture();
    const report = await validateProjectLoopReadiness(fixture);

    expect(report.errors).toContainEqual(expect.objectContaining({ code: "stage_unconfigured", subloopId: "develop" }));
    expect(report.warnings).toContainEqual(expect.objectContaining({ code: "stage_unconfigured", subloopId: "unused-loop" }));
    expect(report.warnings).toContainEqual(expect.objectContaining({ code: "stage_orphaned", subloopId: "orphan" }));
  });

  it("reads a strict configured Stage Package and accepts the current generated guide", async () => {
    const fixture = v2Fixture();
    const stagePath = fixture.lock.subloops.develop!.path;
    const stageYaml = parse(fixture.files[`${stagePath}/stage.yaml`]!);
    fixture.files[`${stagePath}/stage.yaml`] = stringify({ ...stageYaml, configured: true, businessGoal: "Implement and verify the approved change." });
    fixture.files[".humanthread/CONFIGURATION.md"] = renderConfigurationGuide({ manifest: fixture.manifest, lock: fixture.lock });

    const contract = await readProjectLoopStageContract({ entry: fixture.lock.subloops.develop!, readText: fixture.readText });
    expect(contract).toMatchObject({ loopId: "loop_active", subloopId: "develop", configured: true, businessGoal: "Implement and verify the approved change." });
    expect(contract.fingerprint).toMatch(/^sha256:[a-f0-9]{64}$/u);

    const report = await validateProjectLoopReadiness({
      ...fixture,
      expectedCatalogVersion: fixture.manifest.catalogVersion,
    });
    expect(report.errors).toEqual([]);
    expect(report.fingerprints.develop).toMatch(/^sha256:[a-f0-9]{64}$/u);
  });

  it("reports stale Catalog and configuration guide projections", async () => {
    const fixture = v2Fixture();
    fixture.files[".humanthread/CONFIGURATION.md"] = "stale guide\n";
    const report = await validateProjectLoopReadiness({
      ...fixture,
      expectedCatalogVersion: `sha256:${"c".repeat(64)}`,
    });

    expect(report.errors).toContainEqual(expect.objectContaining({ code: "catalog_digest_mismatch" }));
    expect(report.errors).toContainEqual(expect.objectContaining({ code: "configuration_guide_outdated" }));
  });

  it("blocks an enabled binding whose published Loop disappeared", async () => {
    const fixture = v2Fixture();
    fixture.manifest.publishedLoops = fixture.manifest.publishedLoops.filter((loop) => loop.loopDefinitionId !== "loop_active");
    const report = await validateProjectLoopReadiness(fixture);

    expect(report.errors).toContainEqual(expect.objectContaining({ code: "active_subloop_unreachable", loopId: "loop_active" }));
  });

  it("blocks a reachable Stage when one of the six resource directories is missing", async () => {
    const fixture = v2Fixture();
    const rulesKeep = `${fixture.lock.subloops.develop!.path}/rules/.gitkeep`;
    delete fixture.files[rulesKeep];
    const report = await validateProjectLoopReadiness(fixture);

    expect(report.errors).toContainEqual(expect.objectContaining({ code: "stage_directory_missing", subloopId: "develop" }));
  });
});
