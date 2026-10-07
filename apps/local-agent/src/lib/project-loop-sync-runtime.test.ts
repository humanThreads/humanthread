import { describe, expect, it, vi } from "vitest";
import { stringify } from "yaml";

import { readNativeProjectLoopStageContract, syncProjectLoops } from "./project-loop-sync-runtime";
import { createNativeProjectLoopFilesystem } from "./project-loop-sync-runtime";

describe("Desktop project Loop sync runtime", () => {
  it("identifies the project-relative file when native Workspace reads exceed the limit", async () => {
    const invoke = vi.fn().mockRejectedValue("Workspace file exceeds the requested read limit");
    const fs = createNativeProjectLoopFilesystem("/Volumes/code/project", invoke);

    await expect(fs.readText(".humanthread/structure/lock.json")).rejects.toMatchObject({
      code: "workspace_file_too_large",
      message: "Workspace file exceeds the requested read limit: .humanthread/structure/lock.json",
    });
  });

  it("delegates bounded migration moves and cleanup to native commands", async () => {
    const invoke = vi.fn().mockResolvedValue(true);
    const fs = createNativeProjectLoopFilesystem("/Volumes/code/project", invoke);

    await fs.renameExclusive(
      ".humanthread/loops/project/nodes/develop",
      ".humanthread/runtime/sync/v1-to-v2-project_1/backup/loops/project/nodes/develop",
    );
    await fs.removeTransactionTree(".humanthread/runtime/sync/v1-to-v2-project_1");

    expect(invoke).toHaveBeenCalledWith("rename_workspace_loop_path", expect.objectContaining({
      workspaceRoot: "/Volumes/code/project",
    }));
    expect(invoke).toHaveBeenCalledWith("remove_workspace_sync_transaction", expect.objectContaining({
      requestedPath: "/Volumes/code/project/.humanthread/runtime/sync/v1-to-v2-project_1",
    }));
  });

  it("normalizes a network failure for the offline local-contract fallback", async () => {
    const invoke = vi.fn(async (command: string) => {
      if (command === "read_workspace_file") return null;
      if (command === "list_workspace_tree") return [];
      throw new Error(`Unexpected command ${command}`);
    });

    await expect(syncProjectLoops({
      workspaceRoot: "/Volumes/code/project",
      projectId: "project_1",
      credentials: { apiBaseUrl: "http://localhost:3000", userId: "user_1", deviceId: "device_1", deviceToken: "device_token", apiToken: "api_token" },
    }, {
      invoke,
      fetch: vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
    })).rejects.toMatchObject({ code: "loop_catalog_unavailable" });
  });

  it("distinguishes an absent assigned Stage from duplicate Stage identities", async () => {
    const invoke = vi.fn(async (command: string, args?: Record<string, unknown>) => {
      const requestedPath = String(args?.requestedPath ?? "");
      if (command === "read_workspace_file" && requestedPath.endsWith("/.humanthread/structure/lock.json")) {
        return JSON.stringify({ schemaVersion: 2, loops: {}, subloops: {}, migrations: {} });
      }
      throw new Error(`Unexpected command ${command}`);
    });

    await expect(readNativeProjectLoopStageContract({
      workspaceRoot: "/Volumes/code/project",
      nodeId: "new_stage",
      assignmentGraph: { nodes: [], edges: [] },
      invoke,
    })).rejects.toMatchObject({
      code: "stage_not_found",
      message: "Local lockfile does not contain Stage new_stage",
    });
  });

  it("reuses native exclusive and structure-only atomic writes", async () => {
    const files = new Map<string, string>([["CLAUDE.md", "# User rules\n\nKeep this text.\n"]]);
    const invoke = vi.fn(async (command: string, args?: Record<string, unknown>) => {
      const requestedPath = String(args?.requestedPath ?? "");
      const relativePath = requestedPath.replace("/Volumes/code/project/", "");
      if (command === "read_workspace_file") return files.get(relativePath) ?? null;
      if (command === "list_workspace_tree") return [...files.keys()].filter((path) => path.startsWith(String(args?.relativePath ?? "")));
      if (command === "create_workspace_directory") return true;
      if (command === "create_workspace_file") { files.set(relativePath, String(args?.content ?? "")); return requestedPath; }
      if (command === "replace_workspace_structure_file") { files.set(relativePath, String(args?.content ?? "")); return requestedPath; }
      if (command === "remove_workspace_sync_transaction") return true;
      throw new Error(`Unexpected command ${command}`);
    });
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({
        ok: true,
        result: {
          contractVersion: 2,
          projectId: "project_1",
          catalogVersion: `sha256:${"a".repeat(64)}`,
          projectBindings: [],
          publishedLoops: [],
        },
      }),
    });

    const result = await syncProjectLoops({
      workspaceRoot: "/Volumes/code/project",
      projectId: "project_1",
      credentials: { apiBaseUrl: "http://localhost:3000", userId: "user_1", deviceId: "device_1", deviceToken: "device_token", apiToken: "api_token" },
    }, { invoke, fetch, now: () => new Date("2026-08-07T06:30:00.000Z") });

    expect(result.projectId).toBe("project_1");
    expect(result).toMatchObject({
      configurationGuide: ".humanthread/CONFIGURATION.md",
      migratedStages: 0,
      warnings: [],
    });
    expect(files.get("humanthread.yaml")).toContain("schemaVersion: 1");
    expect(files.get(".humanthread/structure/manifest.json")).toContain('"projectId": "project_1"');
    expect(files.get(".humanthread/CONFIGURATION.md")).toContain("HumanThread 项目 Loop 配置向导");
    expect(files.get("CLAUDE.md")).toContain("Keep this text.");
    expect(files.get("CLAUDE.md")).toContain(".agents/skills/");
    expect(String(fetch.mock.calls[0]?.[0])).not.toContain("contractVersion");
    expect(invoke).not.toHaveBeenCalledWith("write_workspace_file", expect.anything());
  });

  it("uses the stable Loop definition to disambiguate duplicate Stage IDs without coupling to the Loop version", async () => {
    const stagePath = ".humanthread/loops/task/subloops/develop";
    const graph = {
      schemaVersion: 2,
      limits: { maxStages: 4, maxRepeatCount: 2 },
      nodes: [
        { key: "start", label: "Start", type: "start", offlinePolicy: "online_required" },
        { key: "develop", nodeId: "develop", label: "Develop", type: "agent_action", executionTarget: "local", offlinePolicy: "local_capable", responsibility: "Implement the task", allowedRouteTargets: ["end"] },
        { key: "end", label: "End", type: "end", offlinePolicy: "online_required" },
      ],
      edges: [{ id: "develop-end", source: "develop", target: "end", kind: "normal", outcome: "success" }],
    } as const;
    const files = new Map<string, string>([
      [".humanthread/structure/manifest.json", JSON.stringify({
        schemaVersion: 2,
        contractVersion: 2,
        projectId: "project_1",
        catalogVersion: `sha256:${"a".repeat(64)}`,
        synchronizedAt: "2026-08-07T06:30:00.000Z",
        projectBindings: [{ id: "binding_1", loopDefinitionId: "loop_task", activeVersionId: "version_task", status: "enabled", bindingRole: null, version: 1 }],
        publishedLoops: [{ loopDefinitionId: "loop_task", spaceId: "space_1", name: "Task", description: null, scope: "task", origin: "space", readOnly: false, latestPublishedVersionId: "version_task", publishedVersions: [{ loopVersionId: "version_task", versionNumber: 1, graph }] }],
      })],
      [".humanthread/structure/lock.json", JSON.stringify({
        schemaVersion: 2,
        loops: {},
        subloops: {
          develop: { stableId: "develop", parentLoopId: "loop_task", path: stagePath, materialized: true, expectedFiles: [], localContractVersion: 2, platformContractVersion: 2, state: "active" },
          "loop_release::develop": { stableId: "develop", parentLoopId: "loop_release", path: ".humanthread/loops/release/subloops/develop", materialized: true, expectedFiles: [], localContractVersion: 2, platformContractVersion: 2, state: "active" },
        },
        migrations: {},
      })],
      [`${stagePath}/stage.yaml`, stringify({
        schemaVersion: 2,
        loopId: "loop_task",
        subloopId: "develop",
        configured: true,
        businessGoal: "Implement the task",
        inputScope: { codeAccess: true, writeAccess: true, include: ["src/**"], exclude: [], allowedCommands: [], blockedPaths: [".env"] },
        resourceScope: { prompts: true, resources: true, rules: true, schemas: true, skills: true, templates: true },
        checklist: [],
        qualityGate: { checks: [], requiredArtifacts: [], minConfidence: 0.8 },
      })],
      [`${stagePath}/agents.yaml`, stringify({ schemaVersion: 1, executionMode: "SINGLE_WRITER", execRuns: [{ execId: "main", role: "primary", resumePolicy: "CHECKPOINT" }] })],
      [`${stagePath}/skills/index.yaml`, stringify({ schemaVersion: 1, mode: "none" })],
      [`${stagePath}/schemas/output-schema.json`, JSON.stringify({ type: "object" })],
      [`${stagePath}/prompts/main.md`, "Implement the approved task."],
      [`${stagePath}/rules/project.md`, "Never read .env."],
    ]);
    const invoke = vi.fn(async (command: string, args?: Record<string, unknown>) => {
      const relativePath = String(args?.requestedPath ?? "").replace("/Volumes/code/project/", "");
      if (command === "read_workspace_file") return files.get(relativePath) ?? null;
      if (command === "list_workspace_tree") return [...files.keys()].filter((path) => path.startsWith(relativePath));
      throw new Error(`Unexpected command ${command}`);
    });

    const loaded = await readNativeProjectLoopStageContract({
      workspaceRoot: "/Volumes/code/project",
      nodeId: "platform_develop",
      stageRef: {
        loopDefinitionId: "loop_task",
        loopVersionId: "platform_version_v100",
        nodeId: "platform_develop",
        subloopId: "develop",
      },
      assignmentGraph: {
        schemaVersion: 1,
        inputSchema: {},
        outputSchema: {},
        limits: graph.limits,
        nodes: [
          graph.nodes[0],
          { key: "develop", nodeId: "develop", label: "Develop", type: "agent_action", executionTarget: "local", offlinePolicy: "local_capable" },
          graph.nodes[2],
        ],
        edges: graph.edges,
      },
      invoke,
    });

    expect(loaded.stage).toMatchObject({ loopId: "loop_task", subloopId: "develop", configured: true });
    expect(loaded.resourcesByExecId.main).toMatchObject({
      prompt: "Implement the approved task.",
      rules: [{ path: `${stagePath}/rules/project.md`, content: "Never read .env." }],
    });
  });

  it("loads the local Stage by node ID when the assignment has no explicit mapping", async () => {
    const stagePath = ".humanthread/loops/task/subloops/develop";
    const files = new Map<string, string>([
      [".humanthread/structure/manifest.json", JSON.stringify({
        schemaVersion: 2,
        contractVersion: 2,
        projectId: "project_1",
        catalogVersion: `sha256:${"a".repeat(64)}`,
        synchronizedAt: "2026-08-07T06:30:00.000Z",
        projectBindings: [],
        publishedLoops: [{
          loopDefinitionId: "loop_task",
          spaceId: "space_1",
          name: "Task",
          description: null,
          scope: "task",
          origin: "space",
          readOnly: false,
          latestPublishedVersionId: "version_task",
          publishedVersions: [{
            loopVersionId: "version_task",
            versionNumber: 1,
            graph: {
              schemaVersion: 2,
              limits: { maxStages: 3, maxRepeatCount: 1 },
              nodes: [
                { key: "start", nodeId: "start", label: "Start", type: "start", offlinePolicy: "online_required" },
                { key: "develop", nodeId: "develop", label: "Develop", type: "agent_action", executionTarget: "local", offlinePolicy: "local_capable", responsibility: "Implement", allowedRouteTargets: ["end"] },
                { key: "end", nodeId: "end", label: "End", type: "end", offlinePolicy: "online_required" },
              ],
              edges: [{ id: "develop-end", source: "develop", target: "end", kind: "normal", outcome: "success" }],
            },
          }],
        }],
      })],
      [".humanthread/structure/lock.json", JSON.stringify({
        schemaVersion: 2,
        loops: {},
        subloops: {
          develop: { stableId: "develop", parentLoopId: "loop_task", path: stagePath, materialized: true, expectedFiles: [], localContractVersion: 2, platformContractVersion: 2, state: "active" },
        },
        migrations: {},
      })],
      [`${stagePath}/stage.yaml`, stringify({
        schemaVersion: 2,
        loopId: "loop_task",
        subloopId: "develop",
        configured: true,
        businessGoal: "Implement the task",
        inputScope: { codeAccess: true, writeAccess: true, include: [], exclude: [], allowedCommands: [], blockedPaths: [] },
        resourceScope: { prompts: true, resources: true, rules: true, schemas: true, skills: true, templates: true },
        checklist: [],
        qualityGate: { checks: [], requiredArtifacts: [], minConfidence: 0.8 },
      })],
      [`${stagePath}/agents.yaml`, stringify({ schemaVersion: 1, executionMode: "SINGLE_WRITER", execRuns: [{ execId: "main", role: "primary", resumePolicy: "CHECKPOINT" }] })],
      [`${stagePath}/skills/index.yaml`, stringify({ schemaVersion: 1, mode: "none" })],
      [`${stagePath}/schemas/output-schema.json`, JSON.stringify({ type: "object" })],
      [`${stagePath}/prompts/main.md`, "Implement the task."],
    ]);
    const invoke = vi.fn(async (command: string, args?: Record<string, unknown>) => {
      const relativePath = String(args?.requestedPath ?? "").replace("/Volumes/code/project/", "");
      if (command === "read_workspace_file") return files.get(relativePath) ?? null;
      if (command === "list_workspace_tree") return [];
      throw new Error(`Unexpected command ${command}`);
    });

    const loaded = await readNativeProjectLoopStageContract({
      workspaceRoot: "/Volumes/code/project",
      nodeId: "develop",
      assignmentGraph: { nodes: [], edges: [] },
      invoke,
    });

    expect(loaded.stage).toMatchObject({ loopId: "loop_task", subloopId: "develop", configured: true });
  });
});
