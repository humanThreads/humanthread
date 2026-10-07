import { describe, expect, it } from "vitest";

import type { ProjectLoopLockV2, ProjectLoopManifestV2 } from "./contracts";
import { renderConfigurationGuide } from "./configuration-guide";

function manifest(): ProjectLoopManifestV2 {
  const loop = (loopId: string, versionId: string, nodeId: string, responsibility: string) => ({
    loopDefinitionId: loopId,
    spaceId: "space_1",
    name: loopId === "loop_active" ? "Active Loop" : "Dormant Loop",
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
          { key: "start", nodeId: `start_${nodeId}`, label: "Start", type: "start" as const, offlinePolicy: "online_required" as const },
          { key: "work", nodeId, label: "Work", type: "agent_action" as const, executionTarget: "local" as const, offlinePolicy: "local_capable" as const, responsibility, allowedRouteTargets: [`end_${nodeId}`] },
          { key: "end", nodeId: `end_${nodeId}`, label: "End", type: "end" as const, offlinePolicy: "online_required" as const },
        ],
        edges: [
          { id: `to_${nodeId}`, source: "start", target: "work", kind: "normal" as const, outcome: "success" as const },
          { id: `from_${nodeId}`, source: "work", target: "end", kind: "normal" as const, outcome: "success" as const },
        ],
      },
    }],
  });
  return {
    schemaVersion: 2,
    contractVersion: 2,
    projectId: "project_1",
    catalogVersion: `sha256:${"a".repeat(64)}`,
    synchronizedAt: "2026-08-07T06:30:00.000Z",
    projectBindings: [{ id: "binding_1", loopDefinitionId: "loop_active", activeVersionId: "version_active", status: "enabled", bindingRole: "root", version: 1 }],
    publishedLoops: [
      loop("loop_active", "version_active", "develop", "Implement approved requirements and produce evidence."),
      loop("loop_dormant", "version_dormant", "unused-loop", "DORMANT_SECRET_SHOULD_NOT_APPEAR"),
    ],
  };
}

function lock(): ProjectLoopLockV2 {
  const entry = (stableId: string, parentLoopId: string, path: string) => ({
    stableId,
    parentLoopId,
    path,
    materialized: true,
    expectedFiles: [`${path}/stage.yaml`],
    localContractVersion: 2,
    platformContractVersion: 2,
    state: "unconfigured" as const,
  });
  return {
    schemaVersion: 2,
    loops: {},
    subloops: {
      develop: entry("develop", "loop_active", ".humanthread/loops/active/subloops/develop"),
      "unused-loop": entry("unused-loop", "loop_dormant", ".humanthread/loops/dormant/subloops/unused"),
    },
    migrations: {},
  };
}

describe("renderConfigurationGuide", () => {
  it("lists only enabled reachable stages and every required setup topic without repository content", () => {
    const guide = renderConfigurationGuide({ manifest: manifest(), lock: lock() });

    expect(guide).toContain("全局约束");
    expect(guide).toContain("本地规则整理引导");
    expect(guide).toContain("AGENTS.md");
    expect(guide).toContain("MCP 与凭据");
    expect(guide).toContain(".agents/skills/");
    expect(guide).toContain("Stage Package 配置顺序");
    expect(guide).toContain("mode: all");
    expect(guide).toContain("mode: none");
    expect(guide).toContain("mode: include");
    expect(guide).toContain("configured");
    expect(guide).toContain("ht doctor");
    expect(guide).toContain("Implement approved requirements and produce evidence.");
    expect(guide).toContain(".humanthread/loops/active/subloops/develop");
    expect(guide).not.toContain("DORMANT_SECRET_SHOULD_NOT_APPEAR");
    expect(guide).not.toContain("OPENAI_API_KEY");
  });
});
