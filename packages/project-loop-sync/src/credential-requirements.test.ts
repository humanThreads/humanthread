import { describe, expect, it } from "vitest";

import type { ProjectLoopCatalogV2 } from "./contracts";
import { inferCredentialRequirements } from "./credential-requirements";

function catalog(): ProjectLoopCatalogV2 {
  return {
    contractVersion: 2,
    projectId: "project_1",
    catalogVersion: `sha256:${"a".repeat(64)}`,
    projectBindings: [{
      id: "binding_1",
      loopDefinitionId: "loop_selected",
      activeVersionId: "version_selected",
      status: "enabled",
      bindingRole: "root",
      version: 1,
    }],
    publishedLoops: [
      {
        loopDefinitionId: "loop_selected",
        spaceId: "space_1",
        name: "Selected Loop",
        description: null,
        scope: "project",
        origin: "space",
        readOnly: false,
        latestPublishedVersionId: "version_selected",
        publishedVersions: [{
          loopVersionId: "version_selected",
          versionNumber: 1,
          graph: {
            schemaVersion: 2,
            limits: { maxStages: 4, maxRepeatCount: 1 },
            nodes: [
              { key: "start", nodeId: "start", label: "Start", type: "start", offlinePolicy: "online_required" },
              {
                key: "work",
                nodeId: "work",
                label: "Work",
                type: "agent_action",
                executionTarget: "either",
                offlinePolicy: "local_capable",
                responsibility: "Use ${OPENAI_API_KEY} and MCP_URL.",
                allowedRouteTargets: ["end"],
              },
              { key: "end", nodeId: "end", label: "End", type: "end", offlinePolicy: "online_required" },
            ],
            edges: [
              { id: "start_work", source: "start", target: "work", kind: "normal", outcome: "success" },
              { id: "work_end", source: "work", target: "end", kind: "normal", outcome: "success" },
            ],
          },
        }],
      },
      {
        loopDefinitionId: "loop_dormant",
        spaceId: "space_1",
        name: "Dormant Loop",
        description: null,
        scope: "task",
        origin: "space",
        readOnly: false,
        latestPublishedVersionId: "version_dormant",
        publishedVersions: [{
          loopVersionId: "version_dormant",
          versionNumber: 1,
          graph: {
            schemaVersion: 2,
            limits: { maxStages: 4, maxRepeatCount: 1 },
            nodes: [
              { key: "start", nodeId: "dormant_start", label: "Start", type: "start", offlinePolicy: "online_required" },
              {
                key: "work",
                nodeId: "dormant_work",
                label: "Dormant",
                type: "agent_action",
                executionTarget: "local",
                offlinePolicy: "local_capable",
                responsibility: "Use DORMANT_TOKEN.",
                allowedRouteTargets: ["dormant_end"],
              },
              { key: "end", nodeId: "dormant_end", label: "End", type: "end", offlinePolicy: "online_required" },
            ],
            edges: [
              { id: "dormant_start_work", source: "start", target: "work", kind: "normal", outcome: "success" },
              { id: "dormant_work_end", source: "work", target: "end", kind: "normal", outcome: "success" },
            ],
          },
        }],
      },
    ],
  };
}

describe("inferCredentialRequirements", () => {
  it("只从已选 Loop 闭包推导配置，并区分本地 Agent 与 Worker", async () => {
    const result = await inferCredentialRequirements({
      catalog: catalog(),
      projectFiles: {
        "AGENTS.md": "本项目使用 ${OPENAI_API_KEY}。",
        ".env.production.local": "OPENAI_API_KEY=redacted-value\nMCP_URL=https://example.invalid/mcp\nUNUSED_TOKEN=ignored\n",
        ".humanthread/loops/selected--loop_selected/subloops/work/rules/rule.md": "需要 SERVICE_TOKEN。",
        ".humanthread/loops/dormant--loop_dormant/subloops/work/rules/rule.md": "DORMANT_TOKEN",
      },
      localEnvironment: { OPENAI_API_KEY: "local-value" },
    });

    expect(result.requirements.map((item) => item.name)).toEqual(["MCP_URL", "OPENAI_API_KEY", "SERVICE_TOKEN"]);
    expect(result.requirements.find((item) => item.name === "OPENAI_API_KEY")).toMatchObject({
      projectSource: ".env.production.local",
      localAgent: { status: "available", source: "project_file" },
      worker: { status: "available", source: "project_file" },
    });
    expect(result.requirements.find((item) => item.name === "MCP_URL")).toMatchObject({
      localAgent: { status: "missing" },
      worker: { status: "available", source: "project_file" },
    });
    expect(JSON.stringify(result)).not.toContain("redacted-value");
    expect(JSON.stringify(result)).not.toContain("local-value");
    expect(result.requirements.map((item) => item.name)).not.toContain("DORMANT_TOKEN");
    expect(result.requirements.map((item) => item.name)).not.toContain("UNUSED_TOKEN");
  });

  it("记录脱敏快照指纹且不修改项目配置文件", async () => {
    const files = { ".env.production.local": "SERVICE_TOKEN=secret\n" };
    const result = await inferCredentialRequirements({
      catalog: catalog(),
      projectFiles: files,
      localEnvironment: {},
    });

    expect(result.snapshot).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(files).toEqual({ ".env.production.local": "SERVICE_TOKEN=secret\n" });
    expect(result.requirements.find((item) => item.name === "SERVICE_TOKEN")).toBeUndefined();
  });
});
