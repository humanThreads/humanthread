import { describe, expect, it, vi } from "vitest";
import { scheduledTaskProjectDigest } from "@humanthread/db";
import { loopAssignmentV2Schema } from "../../../../../packages/shared/src/index";
import type { LoopAssignment } from "../../../../../packages/shared/src/index";
import {
  appendLoopAssignmentEvents,
  appendLinuxWorkerAssignmentEvents,
  appendRunEvents,
  buildLoopAssignmentContract,
  buildClaimExecutionConfiguration,
  buildLinuxWorkerStagePrompt,
  buildLoopAssignmentExecutionView,
  claimLinuxWorkerAssignment,
  claimLoopAssignment,
  completeLoopAssignment,
  completeLinuxWorkerAssignment,
  heartbeatLoopAssignment,
  heartbeatLinuxWorkerAssignment,
  resolveWorkerExecutionSnapshot,
  resolveLinuxWorkerBranch,
  resolveScheduledTaskRunForClaim,
  saveLinuxWorkerAssignmentCheckpoint,
  saveLoopAssignmentCheckpoint,
  saveRunCheckpoint,
  sanitizeWorkerInputSnapshot,
  scheduledTaskPromptTask,
  submitRunResult,
  withTaskExecutionContext,
  withScheduledTaskExecutionContext,
  type LinuxWorkerClaimDependencies,
} from "./worker-commands";

const lease = { runId: "run_1", workerId: "worker_1", leaseGeneration: 3 };

describe("worker orchestration commands", () => {
  it("resolves a Linux Worker snapshot only from explicit stage configuration", () => {
    const resolved = resolveWorkerExecutionSnapshot({
      workerPoolId: "a".repeat(32),
      repository: {
        url: "https://github.com/humanthread/disaster.git",
        branch: "main",
        branchPolicy: { allowedBranches: ["main"] },
      },
      stageConfigurations: {
        work: {
          siteId: "b".repeat(32),
          model: "configured-model",
          reasoningEffort: "high",
        },
      },
      modelSites: [{
        id: "b".repeat(32),
        endpoint: "https://codex.example.com/v1",
        apiKeyReference: "c".repeat(32),
      }],
      nodeKey: "work",
      requiredCapabilities: [],
      requireGitDelivery: true,
      grants: [{ id: "grant_1" }],
    });

    expect(resolved).toMatchObject({
      workerPoolId: "a".repeat(32),
      model: {
        model: "configured-model",
        reasoningEffort: "high",
        endpoint: "https://codex.example.com/v1",
      },
    });
    expect(resolved).not.toHaveProperty("fallbackModel");
    expect(JSON.stringify(resolved)).not.toContain("configured-key");
  });

  it("rejects Linux Worker snapshot resolution when the phase has no explicit model configuration", () => {
    expect(() => resolveWorkerExecutionSnapshot({
      workerPoolId: "a".repeat(32),
      repository: {
        url: "https://github.com/humanthread/disaster.git",
        branch: "main",
        branchPolicy: { allowedBranches: ["main"] },
      },
      stageConfigurations: {},
      modelSites: [],
      nodeKey: "work",
      requiredCapabilities: [],
      requireGitDelivery: false,
      grants: [],
    })).toThrow("Worker execution configuration is required");
  });

  it("restores authoritative task identity when a routed node input no longer contains it", () => {
    expect(withTaskExecutionContext({ execId: "main", status: "SUCCESS" }, {
      id: "task_1",
      projectId: "project_1",
      taskNumber: 100023,
      shortId: "HT100023",
      taskBranch: null,
      createdAt: new Date("2026-07-29T04:00:00.000Z"),
      project: { productionBranch: "main", stagingBranch: "staging" },
    })).toEqual({
      execId: "main",
      status: "SUCCESS",
      taskId: "task_1",
      projectId: "project_1",
      taskNumber: 100023,
      shortId: "HT100023",
      taskBranch: "2026-HT100023",
      taskCreatedAt: "2026-07-29T04:00:00.000Z",
      productionBranch: "main",
      stagingBranch: "staging",
    });
  });

  it("keeps the persisted task branch authoritative over routed node output", () => {
    expect(withTaskExecutionContext({ taskBranch: "wrong-branch" }, {
      id: "task_1",
      projectId: "project_1",
      taskNumber: 100023,
      shortId: "HT100023",
      taskBranch: "2026-HT100023",
      createdAt: new Date("2026-07-29T04:00:00.000Z"),
      project: { productionBranch: "main", stagingBranch: "staging" },
    })).toMatchObject({ taskBranch: "2026-HT100023" });
  });

  it("injects platform scheduled task content into the claim input", () => {
    expect(withScheduledTaskExecutionContext({ nodeInput: true }, {
      id: "a".repeat(32),
      taskSnapshot: { name: "每日巡检", description: "检查昨日交付" },
      contentMode: "platform",
      contentSnapshot: "# 巡检项\n- 检查日志",
    })).toEqual({
      nodeInput: true,
      scheduledTask: {
        id: "a".repeat(32),
        name: "每日巡检",
        description: "检查昨日交付",
        contentMode: "platform",
        contentMarkdown: "# 巡检项\n- 检查日志",
      },
    });
  });

  it("does not expose a markdown field for loop-managed scheduled tasks", () => {
    const result = withScheduledTaskExecutionContext({}, {
      id: "a".repeat(32),
      taskSnapshot: { name: "项目巡检", description: "" },
      contentMode: "loop_managed",
      contentSnapshot: null,
    }) as { scheduledTask: Record<string, unknown> };
    expect(result.scheduledTask).toEqual({
      id: "a".repeat(32), name: "项目巡检", description: "", contentMode: "loop_managed",
    });
    expect(result.scheduledTask).not.toHaveProperty("contentMarkdown");
  });

  it("fails closed when platform scheduled task content is missing", () => {
    let failure: unknown;
    try {
      withScheduledTaskExecutionContext({}, {
        id: "a".repeat(32),
        taskSnapshot: { name: "每日巡检", description: "" },
        contentMode: "platform",
        contentSnapshot: null,
      });
    } catch (error) {
      failure = error;
    }
    expect(failure).toMatchObject({
      code: "configuration_required",
      message: "Worker execution configuration is required",
    });
  });

  it("does not add a top-level content snapshot to scheduled task input", () => {
    const result = withScheduledTaskExecutionContext({}, {
      id: "a".repeat(32),
      taskSnapshot: { name: "每日巡检", description: "" },
      contentMode: "platform",
      contentSnapshot: "# 巡检项",
    }) as Record<string, unknown>;

    expect(result).not.toHaveProperty("contentSnapshot");
    expect(result).toMatchObject({ scheduledTask: { contentMarkdown: "# 巡检项" } });
  });

  const graph = {
    schemaVersion: 1 as const,
    inputSchema: { type: "object" },
    outputSchema: { type: "object" },
    limits: { maxStages: 3, maxRepeatCount: 1 },
    nodes: [
      { key: "start", type: "start" as const, label: "Start", offlinePolicy: "online_required" as const },
      { key: "work", type: "agent_action" as const, label: "Work", executionTarget: "local" as const, promptTemplate: "Work", offlinePolicy: "online_required" as const },
      { key: "end", type: "end" as const, label: "End", offlinePolicy: "online_required" as const },
    ],
    edges: [
      { id: "start-work", source: "start", target: "work", kind: "normal" as const, outcome: "success" as const },
      { id: "work-end", source: "work", target: "end", kind: "normal" as const, outcome: "success" as const },
    ],
  };
  const assignment = {
    id: "assignment_1",
    agentRunId: "run_1",
    loopRunId: "loop_run_1",
    loopNodeRunId: "node_run_1",
    loopNodeAttemptId: "attempt_1",
    attemptNo: 1,
    leaseGeneration: 3,
    leaseExpiresAt: "2026-07-30T09:00:00.000Z",
    acceptedThroughSequence: 0,
    node: graph.nodes[1],
    graph,
    inputSnapshot: { task: "implement" },
    policySnapshot: {},
    grantSnapshot: {},
    runtime: { agentProfileId: "profile_codex", provider: "codex", runtimeProfileId: "runtime_1", configurationVersion: 1 },
    workspace: { bindingId: "workspace_1", configurationVersion: 1, pathFingerprint: "hmac-sha256:abcdef" },
    prompt: "Work",
    resultSchemaPath: "results/output.json",
    checkpointSnapshot: { phase: "working" },
  };

  it("claims a strict graph assignment with its lease projection", async () => {
    await expect(claimLoopAssignment({
      userId: "user_1",
      workerId: "local-worker:device_1",
      deviceId: "device_1",
      capabilities: ["workspace", "commands"],
      now: new Date("2026-07-30T08:00:00.000Z"),
      leaseDurationMs: 60_000,
    }, {
      claim: vi.fn().mockResolvedValue(assignment),
    })).resolves.toEqual({
      assignment,
      leaseGeneration: 3,
      leaseExpiresAt: "2026-07-30T09:00:00.000Z",
      leaseDurationMs: 60_000,
    });
  });

  it("carries platform scheduled task content through the Local Agent claim boundary", async () => {
    const scheduledTaskRun = {
      id: "d".repeat(32),
      taskSnapshot: { name: "每日巡检", description: "检查昨日交付", contentMode: "platform" },
      contentSnapshot: "# 巡检项\n- 检查日志",
    };
    const claim = vi.fn(async () => ({
      ...assignment,
      inputSnapshot: withScheduledTaskExecutionContext({}, {
        id: scheduledTaskRun.id,
        taskSnapshot: scheduledTaskRun.taskSnapshot,
        contentMode: "platform",
        contentSnapshot: scheduledTaskRun.contentSnapshot,
      }),
    } as LoopAssignment));

    const result = await claimLoopAssignment({
      userId: "user_1",
      workerId: "local-worker:device_1",
      deviceId: "device_1",
      capabilities: ["workspace", "commands"],
      now: new Date("2026-07-30T08:00:00.000Z"),
      leaseDurationMs: 60_000,
    }, { claim });

    expect(result.assignment?.inputSnapshot).toEqual({
      scheduledTask: {
        id: "d".repeat(32),
        name: "每日巡检",
        description: "检查昨日交付",
        contentMode: "platform",
        contentMarkdown: "# 巡检项\n- 检查日志",
      },
    });
    expect(JSON.stringify(result)).not.toContain("contentSnapshot");
  });

  it("omits scheduled task content for loop-managed Local Agent claims", async () => {
    const claim = vi.fn(async () => ({
      ...assignment,
      inputSnapshot: withScheduledTaskExecutionContext({}, {
        id: "d".repeat(32),
        taskSnapshot: { name: "项目巡检", description: "", contentMode: "loop_managed" },
        contentMode: "loop_managed",
        contentSnapshot: "# 不应泄漏",
      }),
    } as LoopAssignment));

    const result = await claimLoopAssignment({
      userId: "user_1",
      workerId: "local-worker:device_1",
      deviceId: "device_1",
      capabilities: ["workspace", "commands"],
      now: new Date("2026-07-30T08:00:00.000Z"),
      leaseDurationMs: 60_000,
    }, { claim });
    const scheduledTask = (result.assignment?.inputSnapshot as { scheduledTask?: Record<string, unknown> }).scheduledTask;

    expect(scheduledTask).toEqual({
      id: "d".repeat(32), name: "项目巡检", description: "", contentMode: "loop_managed",
    });
    expect(scheduledTask).not.toHaveProperty("contentMarkdown");
    expect(JSON.stringify(result)).not.toContain("contentSnapshot");
    expect(JSON.stringify(result)).not.toContain("不应泄漏");
  });

  it("fails closed at the Local Agent claim boundary when platform content is missing", async () => {
    const claim = vi.fn(async () => ({
      ...assignment,
      inputSnapshot: withScheduledTaskExecutionContext({}, {
        id: "d".repeat(32),
        taskSnapshot: { name: "每日巡检", description: "", contentMode: "platform" },
        contentMode: "platform",
        contentSnapshot: null,
      }),
    } as LoopAssignment));

    await expect(claimLoopAssignment({
      userId: "user_1",
      workerId: "local-worker:device_1",
      deviceId: "device_1",
      capabilities: ["workspace", "commands"],
      now: new Date("2026-07-30T08:00:00.000Z"),
      leaseDurationMs: 60_000,
    }, { claim })).rejects.toMatchObject({ code: "configuration_required" });
  });

  it("resolves project-root and task-scoped-root child context for Local Agent claims", async () => {
    const scheduledTaskId = "d".repeat(32);
    const scheduledTaskRunId = "e".repeat(32);
    const loadRun = vi.fn(async () => ({
      id: scheduledTaskRunId,
      scheduledTaskId,
      projectDigest: scheduledTaskProjectDigest("project_1"),
      taskSnapshot: { name: "每日巡检", description: "", contentMode: "platform" },
      contentSnapshot: "# 巡检",
    }));
    const projectRoot = await resolveScheduledTaskRunForClaim({
      projectId: "project_1",
      direct: null,
      inputSnapshot: { scheduledTaskId, scheduledTaskRunId, request: "child" },
      parent: {
        id: "root_project",
        projectId: "project_1",
        scheduledTaskRunId,
        inputSnapshot: { scheduledTaskId, scheduledTaskRunId },
      },
      loadRun,
    });
    const taskScopedRoot = await resolveScheduledTaskRunForClaim({
      projectId: "project_1",
      direct: null,
      inputSnapshot: { scheduledTaskId, scheduledTaskRunId, taskId: "task_1" },
      parent: {
        id: "root_task",
        projectId: "project_1",
        scheduledTaskRunId: null,
        inputSnapshot: { scheduledTaskId, scheduledTaskRunId, taskId: "task_1" },
      },
      loadRun,
    });

    expect(projectRoot).toMatchObject({ id: scheduledTaskRunId, contentSnapshot: "# 巡检" });
    expect(taskScopedRoot).toMatchObject({ id: scheduledTaskRunId, contentSnapshot: "# 巡检" });
    expect(loadRun).toHaveBeenCalledTimes(2);
  });

  it("rejects a child scheduled-task reference that does not match its parent ancestry", async () => {
    await expect(resolveScheduledTaskRunForClaim({
      projectId: "project_1",
      direct: null,
      inputSnapshot: { scheduledTaskRunId: "e".repeat(32) },
      parent: {
        id: "parent",
        projectId: "project_1",
        scheduledTaskRunId: "f".repeat(32),
        inputSnapshot: {},
      },
      loadRun: vi.fn(),
    })).rejects.toMatchObject({ code: "configuration_required" });
  });

  it("rejects an invalid scheduled task content mode at the Local Agent claim boundary", async () => {
    const claim = vi.fn(async () => ({
      ...assignment,
      inputSnapshot: withScheduledTaskExecutionContext({}, {
        id: "d".repeat(32),
        taskSnapshot: { name: "每日巡检", description: "", contentMode: "unexpected" },
        contentMode: "unexpected",
        contentSnapshot: "# 不应使用未知模式",
      }),
    } as LoopAssignment));

    await expect(claimLoopAssignment({
      userId: "user_1",
      workerId: "local-worker:device_1",
      deviceId: "device_1",
      capabilities: ["workspace", "commands"],
      now: new Date("2026-07-30T08:00:00.000Z"),
      leaseDurationMs: 60_000,
    }, { claim })).rejects.toMatchObject({ code: "configuration_required" });
  });

  it("builds a V2 assignment execution view without exposing authoring routing metadata", () => {
    const v2Graph = {
      schemaVersion: 2,
      inputSchema: { type: "object" },
      outputSchema: { type: "object" },
      limits: { maxStages: 3, maxRepeatCount: 2 },
      nodes: [
        { key: "start", label: "Start", type: "start", offlinePolicy: "online_required" },
        { key: "work", label: "Work", type: "agent_action", executionTarget: "local", promptTemplate: "Work", offlinePolicy: "local_capable" },
        { key: "end", label: "End", type: "end", offlinePolicy: "online_required" },
      ],
      edges: [
        { id: "start-work", source: "start", target: "work", kind: "normal", outcome: "success" },
        { id: "work-end", source: "work", target: "end", kind: "normal", outcome: "success" },
      ],
      routingMetadata: { work: { responsibility: "Complete the checked stage." } },
    };

    expect(buildLoopAssignmentExecutionView(v2Graph)).toEqual({
      schemaVersion: 1,
      inputSchema: { type: "object" },
      outputSchema: { type: "object" },
      limits: { maxStages: 3, maxRepeatCount: 2 },
      nodes: v2Graph.nodes,
      edges: v2Graph.edges,
    });
  });

  it("preserves the frozen Agent reasoning effort in assignment node and graph projections", () => {
    const persistedGraph = {
      ...graph,
      nodes: graph.nodes.map((node) => node.key === "work"
        ? { ...node, reasoningEffort: "max" as const }
        : node),
    };
    const executionGraph = buildLoopAssignmentExecutionView(persistedGraph);
    const contract = buildLoopAssignmentContract({
      baseAssignment: {
        ...assignment,
        node: executionGraph.nodes.find((node) => node.key === "work"),
        graph: executionGraph,
      },
      runGraphSnapshot: null,
    });

    expect(contract.node).toMatchObject({ key: "work", reasoningEffort: "max" });
    expect(contract.graph.nodes).toContainEqual(expect.objectContaining({ key: "work", reasoningEffort: "max" }));
  });

  it("returns the current assignment without protocol version gating", () => {
    const snapshot = {
      snapshotId: "snapshot_v1",
      graphDigest: `sha256:${"a".repeat(64)}`,
      rootLoopVersionId: "loop_version_1",
      loopVersions: [{
        loopDefinitionId: "loop_definition_1",
        loopVersionId: "loop_version_1",
        scope: "project",
        graph: {
          schemaVersion: 1,
          limits: { maxStages: 3, maxRepeatCount: 2 },
          nodes: [
            { key: "work", nodeId: "work", label: "Work", type: "agent_action", executionTarget: "local" },
            { key: "end", nodeId: "end", label: "End", type: "end" },
          ],
          edges: [{ id: "work-end", source: "work", target: "end", kind: "normal", outcome: "success" }],
        },
      }],
      reachableNodeIds: ["work", "end"],
    };

    expect(buildLoopAssignmentContract({
      baseAssignment: assignment,
      runGraphSnapshot: snapshot,
    })).toMatchObject({
      contractVersion: 2,
      runGraphSnapshot: snapshot,
      routerContract: expect.objectContaining({ version: 1 }),
      offlineContinuation: null,
    });

    const current = buildLoopAssignmentContract({
      baseAssignment: assignment,
      runGraphSnapshot: snapshot,
    });
    expect(current).toMatchObject({
      contractVersion: 2,
      runGraphSnapshot: snapshot,
    });
  });

  it("does not reject a V2 run snapshot when a legacy capability list is supplied", () => {
    const snapshot = {
      schemaVersion: 2,
      snapshotId: "snapshot_v2",
      graphDigest: `sha256:${"b".repeat(64)}`,
      rootLoopVersionId: "loop_version_2",
      loopVersions: [{
        loopDefinitionId: "loop_definition_2",
        loopVersionId: "loop_version_2",
        scope: "project",
        graph: {
          schemaVersion: 2,
          limits: { maxStages: 1, maxRepeatCount: 1 },
          nodes: [
            { key: "start", nodeId: "start", label: "Start", type: "start" },
            { key: "end", nodeId: "end", label: "End", type: "end" },
          ],
          edges: [{ id: "start-end", source: "start", target: "end", kind: "normal", outcome: "success" }],
        },
      }],
      reachableNodeIds: ["start", "end"],
    };

    expect(buildLoopAssignmentContract({
      baseAssignment: assignment,
      runGraphSnapshot: snapshot,
    })).toMatchObject({
      contractVersion: 2,
      runGraphSnapshot: snapshot,
    });
  });

  it("returns an upgraded Decision assignment from the claim boundary", async () => {
    const snapshot = {
      snapshotId: "snapshot_v1",
      graphDigest: `sha256:${"a".repeat(64)}`,
      rootLoopVersionId: "loop_version_1",
      loopVersions: [{
        loopDefinitionId: "loop_definition_1",
        loopVersionId: "loop_version_1",
        scope: "project",
        graph: {
          schemaVersion: 1,
          limits: { maxStages: 3, maxRepeatCount: 2 },
          nodes: [
            { key: "work", nodeId: "work", label: "Work", type: "agent_action", executionTarget: "local" },
            { key: "end", nodeId: "end", label: "End", type: "end" },
          ],
          edges: [{ id: "work-end", source: "work", target: "end", kind: "normal", outcome: "success" }],
        },
      }],
      reachableNodeIds: ["work", "end"],
    };
    const decisionAssignment = buildLoopAssignmentContract({
      baseAssignment: assignment,
      runGraphSnapshot: snapshot,
    });

    const claimResult = await claimLoopAssignment({
      userId: "user_1",
      workerId: "local-worker:device_1",
      deviceId: "device_1",
      capabilities: ["workspace", "commands"],
      now: new Date("2026-07-30T08:00:00.000Z"),
      leaseDurationMs: 60_000,
    }, {
      claim: vi.fn().mockResolvedValue(decisionAssignment),
    });
    expect(claimResult).toEqual({
      assignment: decisionAssignment,
      leaseGeneration: 3,
      leaseExpiresAt: "2026-07-30T09:00:00.000Z",
      leaseDurationMs: 60_000,
    });

    expect(loopAssignmentV2Schema.parse(
      JSON.parse(JSON.stringify(claimResult.assignment)),
    )).toEqual(decisionAssignment);
  });

  it("assembles a pathless assignment configuration from the live claim fence", () => {
    const workspace = {
      id: "workspace_1",
      projectId: "project_1",
      userId: "user_1",
      localDeviceId: "device_1",
      status: "ready",
      configurationVersion: 3,
      pathFingerprint: "hmac-sha256:current03",
      absolutePath: "/Users/alice/private-project",
    };
    const runtime = {
      id: "runtime_1",
      userId: "user_1",
      localDeviceId: "device_1",
      provider: "codex",
      status: "ready",
      version: 4,
      command: "/opt/homebrew/bin/codex",
      environment: { OPENAI_API_KEY: "secret" },
    };

    const result = buildClaimExecutionConfiguration({
      command: {
        userId: "user_1",
        workerId: "local-worker:device_1",
        deviceId: "device_1",
        capabilities: ["codex", "workspace"],
      },
      projectId: "project_1",
      agentProfile: { id: "profile_codex", provider: "codex", status: "active" },
      worker: {
        id: "local-worker:device_1",
        localDeviceId: "device_1",
        status: "online",
      },
      bindingSnapshot: {
        allowedAgentProfileIds: ["profile_codex"],
        allowedProviders: ["codex"],
      },
      workspace,
      runtime,
      liveGrantScopes: [{
        workspaceBindingIds: ["workspace_1"],
        agentProfileIds: ["profile_codex"],
        providers: ["codex"],
        deviceIds: ["device_1"],
        workerIds: ["local-worker:device_1"],
        credentials: ["secret"],
      }],
    });

    expect(result).toEqual({
      runtime: {
        agentProfileId: "profile_codex",
        provider: "codex",
        runtimeProfileId: "runtime_1",
        configurationVersion: 4,
      },
      workspace: {
        bindingId: "workspace_1",
        configurationVersion: 3,
        pathFingerprint: "hmac-sha256:current03",
      },
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("/Users/");
    expect(serialized).not.toContain("command");
    expect(serialized).not.toContain("environment");
    expect(serialized).not.toContain("credentials");
    expect(serialized).not.toContain("secret");
  });

  it("rejects a claim configuration without a matching live grant", () => {
    expect(() => buildClaimExecutionConfiguration({
      command: {
        userId: "user_1",
        workerId: "local-worker:device_1",
        deviceId: "device_1",
        capabilities: ["codex"],
      },
      projectId: "project_1",
      agentProfile: { id: "profile_codex", provider: "codex", status: "active" },
      worker: {
        id: "local-worker:device_1",
        localDeviceId: "device_1",
        status: "online",
      },
      bindingSnapshot: {
        allowedAgentProfileIds: ["profile_codex"],
        allowedProviders: ["codex"],
      },
      workspace: {
        id: "workspace_1",
        projectId: "project_1",
        userId: "user_1",
        localDeviceId: "device_1",
        status: "ready",
        configurationVersion: 3,
        pathFingerprint: "hmac-sha256:current03",
      },
      runtime: {
        id: "runtime_1",
        userId: "user_1",
        localDeviceId: "device_1",
        provider: "codex",
        status: "ready",
        version: 4,
      },
      liveGrantScopes: [],
    })).toThrow(expect.objectContaining({ code: "stale_lease" }));
  });

  it("rejects a worker identity that is not the authenticated device", async () => {
    const claim = vi.fn();

    await expect(claimLoopAssignment({
      userId: "user_1",
      workerId: "worker_other",
      deviceId: "device_1",
      capabilities: ["workspace", "commands"],
      now: new Date("2026-07-30T08:00:00.000Z"),
      leaseDurationMs: 60_000,
    }, { claim })).rejects.toMatchObject({ code: "stale_lease" });

    expect(claim).not.toHaveBeenCalled();
  });

  it("returns no assignment when the worker only accepts a heartbeat", async () => {
    const claim = vi.fn();

    await expect(claimLoopAssignment({
      userId: "user_1",
      workerId: "local-worker:device_1",
      deviceId: "device_1",
      capabilities: ["workspace", "commands"],
      acceptAssignments: false,
      now: new Date("2026-08-10T12:00:00.000Z"),
      leaseDurationMs: 60_000,
    }, { claim })).resolves.toEqual({
      assignment: null,
      leaseGeneration: null,
      leaseExpiresAt: null,
    });

    expect(claim).not.toHaveBeenCalled();
  });

  it("does not return an assignment whose action authorization requires approval", async () => {
    const authorizeAssignment = vi.fn().mockResolvedValue({
      outcome: "require_approval",
      reasonCode: "automation_grant_scope_miss",
      matchedGrantId: null,
      actionFingerprint: "sha256:assignment",
    });

    await expect(claimLoopAssignment({
      userId: "user_1",
      workerId: "local-worker:device_1",
      deviceId: "device_1",
      capabilities: ["workspace", "commands"],
      now: new Date("2026-07-30T08:00:00.000Z"),
      leaseDurationMs: 60_000,
    }, {
      claim: vi.fn().mockResolvedValue(assignment),
      authorizeAssignment,
    })).rejects.toMatchObject({ code: "approval_required" });

    expect(authorizeAssignment).toHaveBeenCalledWith(assignment, expect.anything());
  });

  it("returns the same accepted result and never advances a stale lease", async () => {
    const runningRun = {
      id: "run_1",
      taskId: null,
      loopRunId: "loop_run_1",
      loopNodeRunId: "node_run_1",
      loopNodeAttemptId: "attempt_1",
      attempt: 1,
      status: "running",
      workerId: "local-worker:device_1",
      leaseGeneration: 3,
      leaseExpiresAt: new Date("2026-07-30T09:00:00.000Z"),
      lastEventSequence: 0,
      nodeRunVersion: 1,
      nodeRunAttemptCount: 1,
      attemptVersion: 1,
    };
    const loadRun = vi.fn()
      .mockResolvedValueOnce(runningRun)
      .mockResolvedValue({ ...runningRun, status: "succeeded" });
    const persistResult = vi.fn().mockResolvedValue({ completed: true, loopRunStatus: "running" });
    const receipts = new Map<string, unknown>();
    const executeIdempotent = vi.fn(async ({ commandId, apply }: { commandId: string; apply(): Promise<unknown> }) => {
      if (receipts.has(commandId)) return receipts.get(commandId);
      const result = await apply();
      receipts.set(commandId, result);
      return result;
    });
    const input = {
      agentRunId: "run_1",
      workerId: "local-worker:device_1",
      deviceId: "device_1",
      leaseGeneration: 3,
      commandId: "command_1",
      loopRunId: "loop_run_1",
      loopNodeRunId: "node_run_1",
      loopNodeAttemptId: "attempt_1",
      attemptNo: 1,
      result: { outcome: "success" as const, output: { done: true }, artifactRefs: [], effectReceipts: [] },
      now: new Date("2026-07-30T08:00:00.000Z"),
    };
    const dependencies = { loadRun, persistResult, executeIdempotent };

    const first = await completeLoopAssignment(input, dependencies);
    const duplicate = await completeLoopAssignment(input, dependencies);
    await expect(completeLoopAssignment({ ...input, leaseGeneration: 2 }, dependencies))
      .rejects.toMatchObject({ code: "stale_lease" });

    expect(duplicate).toEqual(first);
    expect(persistResult).toHaveBeenCalledOnce();
  });

  it("rejects a result submitted by a different authenticated device", async () => {
    const loadRun = vi.fn();

    await expect(completeLoopAssignment({
      agentRunId: "run_1",
      workerId: "local-worker:device_1",
      deviceId: "device_other",
      leaseGeneration: 3,
      commandId: "command_other_device",
      loopRunId: "loop_run_1",
      loopNodeRunId: "node_run_1",
      loopNodeAttemptId: "attempt_1",
      attemptNo: 1,
      result: { outcome: "success", output: {}, artifactRefs: [], effectReceipts: [] },
      now: new Date("2026-07-30T08:00:00.000Z"),
    }, {
      loadRun,
      persistResult: vi.fn(),
      executeIdempotent: vi.fn(),
    })).rejects.toMatchObject({ code: "stale_lease" });

    expect(loadRun).not.toHaveBeenCalled();
  });

  it("acknowledges a duplicate routed failure after its Decision was persisted", async () => {
    const routeDecision = {
      decisionId: "decision_business_test_develop_2",
      fromNodeId: "business_test",
      nextNodeId: "develop",
      reasonCode: "PRODUCT_BEHAVIOR_REGRESSION",
      summary: "Return to development using the business-test evidence.",
      evidence: ["artifacts/business-test/business-test-report.json"],
      confidence: 0.99,
      snapshotDigest: `sha256:${"a".repeat(64)}`,
      routerContractVersion: 1 as const,
      routerContractDigest: `sha256:${"d".repeat(64)}`,
    };
    const loadRun = vi.fn().mockResolvedValue({
      id: "run_1",
      taskId: null,
      loopRunId: "loop_run_1",
      loopNodeRunId: "node_run_1",
      loopNodeAttemptId: "attempt_1",
      attempt: 2,
      status: "failed",
      workerId: "local-worker:device_1",
      leaseGeneration: 3,
      leaseExpiresAt: new Date("2026-07-30T09:00:00.000Z"),
      lastEventSequence: 0,
      nodeRunVersion: 5,
      nodeRunAttemptCount: 2,
      attemptVersion: 2,
      checkpoint: { routeDecisionId: routeDecision.decisionId },
    });
    const persistResult = vi.fn();
    const executeIdempotent = vi.fn();

    await expect(completeLoopAssignment({
      agentRunId: "run_1",
      workerId: "local-worker:device_1",
      deviceId: "device_1",
      leaseGeneration: 3,
      commandId: "command_routed_failure_2",
      loopRunId: "loop_run_1",
      loopNodeRunId: "node_run_1",
      loopNodeAttemptId: "attempt_1",
      attemptNo: 2,
      result: {
        outcome: "failure",
        output: { issueType: "PRODUCT_BEHAVIOR_REGRESSION" },
        artifactRefs: ["artifacts/business-test/business-test-report.json"],
        effectReceipts: [],
      },
      routeDecision,
      now: new Date("2026-07-30T08:00:00.000Z"),
    }, {
      loadRun,
      persistResult,
      executeIdempotent,
    })).resolves.toEqual({ completed: false, duplicate: true });

    expect(persistResult).not.toHaveBeenCalled();
    expect(executeIdempotent).not.toHaveBeenCalled();
  });

  it("rejects an old attempt that tries to borrow the current NodeRun version", async () => {
    const loadRun = vi.fn().mockResolvedValue({
      id: "run_1",
      taskId: null,
      loopRunId: "loop_run_1",
      loopNodeRunId: "node_run_1",
      loopNodeAttemptId: "attempt_1",
      attempt: 1,
      status: "running",
      workerId: "local-worker:device_1",
      leaseGeneration: 3,
      leaseExpiresAt: new Date("2026-07-30T09:00:00.000Z"),
      lastEventSequence: 0,
      nodeRunVersion: 9,
      nodeRunAttemptCount: 2,
      attemptVersion: 1,
      checkpoint: null,
    });
    const persistResult = vi.fn();

    await expect(completeLoopAssignment({
      agentRunId: "run_1",
      workerId: "local-worker:device_1",
      deviceId: "device_1",
      leaseGeneration: 3,
      commandId: "command_stale_attempt_1",
      loopRunId: "loop_run_1",
      loopNodeRunId: "node_run_1",
      loopNodeAttemptId: "attempt_1",
      attemptNo: 1,
      result: { outcome: "failure", output: { issueType: "REQUIREMENT_DECISION_PENDING" }, artifactRefs: [], effectReceipts: [] },
      now: new Date("2026-07-30T08:00:00.000Z"),
    }, {
      loadRun,
      persistResult,
      executeIdempotent: vi.fn(),
    })).rejects.toMatchObject({ code: "stale_lease" });

    expect(persistResult).not.toHaveBeenCalled();
  });

  it("rejects a delayed result after requirement input cancelled the AgentRun lease", async () => {
    const loadRun = vi.fn().mockResolvedValue({
      id: "run_1",
      taskId: null,
      loopRunId: "loop_run_1",
      loopNodeRunId: "node_run_1",
      loopNodeAttemptId: "attempt_1",
      attempt: 1,
      status: "cancelled",
      workerId: "local-worker:device_1",
      leaseGeneration: 4,
      leaseExpiresAt: new Date("2026-07-30T08:00:00.000Z"),
      lastEventSequence: 0,
      nodeRunVersion: 6,
      nodeRunAttemptCount: 1,
      attemptVersion: 3,
      checkpoint: null,
    });
    const persistResult = vi.fn();

    await expect(completeLoopAssignment({
      agentRunId: "run_1",
      workerId: "local-worker:device_1",
      deviceId: "device_1",
      leaseGeneration: 3,
      commandId: "command_delayed_after_requirement_input",
      loopRunId: "loop_run_1",
      loopNodeRunId: "node_run_1",
      loopNodeAttemptId: "attempt_1",
      attemptNo: 1,
      result: { outcome: "failure", output: { issueType: "REQUIREMENT_DECISION_PENDING" }, artifactRefs: [], effectReceipts: [] },
      now: new Date("2026-07-30T08:01:00.000Z"),
    }, {
      loadRun,
      persistResult,
      executeIdempotent: vi.fn(),
    })).rejects.toMatchObject({ code: "stale_lease" });

    expect(persistResult).not.toHaveBeenCalled();
  });

  it("rejects an event batch over 512 KiB before persistence", async () => {
    const persistEvents = vi.fn();
    await expect(appendLoopAssignmentEvents({
      agentRunId: "run_1",
      workerId: "local-worker:device_1",
      deviceId: "device_1",
      leaseGeneration: 3,
      commandId: "command_events_1",
      loopNodeAttemptId: "attempt_1",
      events: [{
        eventId: "event_1",
        loopRunId: "loop_run_1",
        loopNodeRunId: "node_run_1",
        loopNodeAttemptId: "attempt_1",
        attemptNo: 1,
        leaseGeneration: 3,
        sequence: 1,
        eventType: "loop.node.progressed",
        occurredAt: "2026-07-30T08:00:00.000Z",
        payloadSummary: { content: "x".repeat(524_288) },
        artifactRefs: [],
      }],
      now: new Date("2026-07-30T08:00:00.000Z"),
    }, { persistEvents })).rejects.toMatchObject({ code: "validation_failed" });
    expect(persistEvents).not.toHaveBeenCalled();
  });

  it("heartbeats the only lease and persists a validated capability snapshot", async () => {
    const heartbeat = vi.fn().mockResolvedValue({
      leaseExpiresAt: new Date("2026-07-30T08:01:00.000Z"),
    });
    const capabilitySnapshot = {
      providers: [{ name: "codex", version: "0.108.0" }],
      capabilities: ["workspace", "commands"] as Array<"workspace" | "commands">,
      loginStateCategories: ["provider_account"] as Array<"provider_account">,
      maxConcurrency: 1,
    };

    await expect(heartbeatLoopAssignment({
      agentRunId: "run_1",
      workerId: "local-worker:device_1",
      deviceId: "device_1",
      leaseGeneration: 3,
      commandId: "heartbeat_1",
      capabilitySnapshot,
      now: new Date("2026-07-30T08:00:00.000Z"),
      leaseDurationMs: 60_000,
    }, { heartbeat })).resolves.toEqual({
      leaseExpiresAt: "2026-07-30T08:01:00.000Z",
      leaseDurationMs: 60_000,
    });
    expect(heartbeat).toHaveBeenCalledWith(expect.objectContaining({
      capabilitySnapshot,
    }));
  });

  it("rejects a stale checkpoint before persistence", async () => {
    const loadRun = vi.fn().mockResolvedValue({
      id: "run_1",
      taskId: null,
      loopRunId: "loop_run_1",
      loopNodeRunId: "node_run_1",
      loopNodeAttemptId: "attempt_1",
      attempt: 1,
      status: "running",
      workerId: "local-worker:device_1",
      leaseGeneration: 4,
      leaseExpiresAt: new Date("2026-07-30T09:00:00.000Z"),
      lastEventSequence: 0,
    });
    const persistCheckpoint = vi.fn();

    await expect(saveLoopAssignmentCheckpoint({
      agentRunId: "run_1",
      workerId: "local-worker:device_1",
      deviceId: "device_1",
      leaseGeneration: 3,
      commandId: "checkpoint_1",
      loopRunId: "loop_run_1",
      loopNodeRunId: "node_run_1",
      loopNodeAttemptId: "attempt_1",
      attemptNo: 1,
      checkpoint: { phase: "working" },
      now: new Date("2026-07-30T08:00:00.000Z"),
    }, { loadRun, persistCheckpoint })).rejects.toMatchObject({ code: "stale_lease" });
    expect(persistCheckpoint).not.toHaveBeenCalled();
  });

  it("persists a checkpoint command once and rejects changed replay content", async () => {
    let checkpoint: unknown = null;
    const runningRun = () => ({
      id: "run_1",
      taskId: null,
      loopRunId: "loop_run_1",
      loopNodeRunId: "node_run_1",
      loopNodeAttemptId: "attempt_1",
      attempt: 1,
      status: "running",
      workerId: "local-worker:device_1",
      leaseGeneration: 3,
      leaseExpiresAt: new Date("2026-07-30T09:00:00.000Z"),
      lastEventSequence: 0,
      nodeRunVersion: 1,
      nodeRunAttemptCount: 1,
      attemptVersion: 1,
      checkpoint,
    });
    const persistCheckpoint = vi.fn(async ({ storedCheckpoint }: { storedCheckpoint: unknown }) => {
      checkpoint = storedCheckpoint;
      return { checkpointed: true, duplicate: false };
    });
    const input = {
      agentRunId: "run_1",
      workerId: "local-worker:device_1",
      deviceId: "device_1",
      leaseGeneration: 3,
      commandId: "checkpoint_once_1",
      loopRunId: "loop_run_1",
      loopNodeRunId: "node_run_1",
      loopNodeAttemptId: "attempt_1",
      attemptNo: 1,
      checkpoint: { phase: "working" },
      now: new Date("2026-07-30T08:00:00.000Z"),
    };
    const dependencies = { loadRun: vi.fn(async () => runningRun()), persistCheckpoint };

    await expect(saveLoopAssignmentCheckpoint(input, dependencies)).resolves.toEqual({
      checkpointed: true,
      duplicate: false,
    });
    await expect(saveLoopAssignmentCheckpoint(input, dependencies)).resolves.toEqual({
      checkpointed: true,
      duplicate: true,
    });
    await expect(saveLoopAssignmentCheckpoint({
      ...input,
      checkpoint: { phase: "changed" },
    }, dependencies)).rejects.toMatchObject({ code: "validation_failed" });
    expect(persistCheckpoint).toHaveBeenCalledOnce();
  });

  it("acknowledges duplicate events and rejects sequence gaps", async () => {
    const loadRun = vi.fn().mockResolvedValue({ id: "run_1", taskId: "task_1", status: "running", workerId: "worker_1", leaseGeneration: 3, leaseExpiresAt: new Date("2026-07-21T01:00:00.000Z"), lastEventSequence: 2 });
    await expect(appendRunEvents({ ...lease, firstSequence: 3, events: [{ id: "e3", type: "agent.message.completed", payload: {} }], now: new Date("2026-07-21T00:00:00.000Z") }, { loadRun, persist: vi.fn().mockResolvedValue({ acceptedThroughSequence: 3 }) })).resolves.toEqual({ acceptedThroughSequence: 3 });
    await expect(appendRunEvents({ ...lease, firstSequence: 4, events: [], now: new Date("2026-07-21T00:00:00.000Z") }, { loadRun, persist: vi.fn() })).rejects.toMatchObject({ code: "sequence_gap" });
  });

  it("bounds checkpoint size and leaves completed candidates verifying", async () => {
    const loadRun = vi.fn().mockResolvedValue({ id: "run_1", taskId: "task_1", status: "running", workerId: "worker_1", leaseGeneration: 3, leaseExpiresAt: new Date("2026-07-21T01:00:00.000Z"), lastEventSequence: 0 });
    await expect(saveRunCheckpoint({ ...lease, checkpoint: { summary: "x".repeat(70_000) }, now: new Date("2026-07-21T00:00:00.000Z") }, { loadRun, persist: vi.fn() })).rejects.toMatchObject({ code: "validation_failed" });
    await expect(submitRunResult({ ...lease, structuredResult: { summary: "done" }, artifacts: [], usage: {}, now: new Date("2026-07-21T00:00:00.000Z") }, { loadRun, persist: vi.fn().mockResolvedValue({ evaluationId: "eval_1", taskStatus: "verifying" }) })).resolves.toEqual({ evaluationId: "eval_1", taskStatus: "verifying" });
  });
});

describe("Linux Worker assignment claims", () => {
  const linuxGraph = {
    schemaVersion: 1 as const,
    inputSchema: { type: "object" },
    outputSchema: { type: "object" },
    limits: { maxStages: 3, maxRepeatCount: 1 },
    nodes: [
      { key: "start", type: "start" as const, label: "Start", offlinePolicy: "online_required" as const },
      {
        key: "work",
        type: "agent_action" as const,
        label: "Work",
        executionTarget: "local" as const,
        promptTemplate: "Implement the task",
        offlinePolicy: "online_required" as const,
        requiredCapabilities: ["files"],
      },
      { key: "end", type: "end" as const, label: "End", offlinePolicy: "online_required" as const },
    ],
    edges: [
      { id: "start-work", source: "start", target: "work", kind: "normal" as const, outcome: "success" as const },
      { id: "work-end", source: "work", target: "end", kind: "normal" as const, outcome: "success" as const },
    ],
  };

  function linuxCandidate(overrides: {
    projectScope?: { ownerType: "personal" | "company"; ownerUserId: string | null; companyId: string | null };
    poolId?: string;
    stageConfigurations?: Record<string, unknown>;
    allowedBranches?: string[];
    taskBranch?: string;
    taskAffinity?: { poolId: string | null; instanceId: string | null };
    projectRun?: boolean;
    inputSnapshot?: unknown;
    environmentConfiguration?: unknown;
    repositoryConfiguration?: unknown;
    scheduledTaskRun?: {
      id: string;
      taskSnapshot: unknown;
      contentSnapshot: string | null;
    } | null;
    loopRunInputSnapshot?: unknown;
    parentLoopRun?: {
      id: string;
      projectId: string | null;
      scheduledTaskRunId: string | null;
      inputSnapshot: unknown;
    } | null;
  } = {}) {
    return {
      id: "agent_run_linux_1",
      projectId: "project_1",
      project: {
        ...(overrides.projectScope ?? { ownerType: "personal" as const, ownerUserId: "user_owner", companyId: null }),
        environmentConfiguration: overrides.environmentConfiguration ?? null,
        repositoryConfiguration: overrides.repositoryConfiguration ?? null,
      },
      attempt: 1,
      leaseGeneration: 4,
      lastEventSequence: 2,
      inputSnapshot: overrides.inputSnapshot ?? { objective: "ship" },
      loopNodeAttempt: { id: "loop_attempt_linux_1" },
      agentProfile: { id: "profile_codex", provider: "codex", status: "active", capabilities: ["files"] },
      loopNodeRun: { id: "node_run_linux_1", nodeKey: "work" },
      loopRun: {
        id: "loop_run_linux_1",
        inputSnapshot: overrides.loopRunInputSnapshot ?? {},
        bindingSnapshot: {
          createdByUserId: "user_binding_creator",
          workerExecution: {
            workerPoolId: overrides.poolId ?? "a".repeat(32),
            workerRepositoryUrl: "https://github.com/humanthread/disaster.git",
            workerBranchPolicy: { allowedBranches: overrides.allowedBranches ?? ["main"] },
            workerStageConfigurations: overrides.stageConfigurations ?? {
              work: { siteId: "b".repeat(32), model: "configured-model", reasoningEffort: "high" },
            },
          },
        },
        grantSnapshot: {},
        policySnapshot: {},
        runGraphSnapshot: null,
        task: overrides.projectRun ? null : {
          taskBranch: overrides.taskBranch ?? "main",
          id: "task_linux_1",
          title: "Implement saved-view task management",
          description: "Add multi-select controls and an archive entry for saved task views.",
          contentMarkdown: "## Acceptance\n\n- Users can select multiple saved views.\n- Users can archive a saved view.",
          linuxWorkerPoolId: overrides.taskAffinity?.poolId ?? null,
          linuxWorkerInstanceId: overrides.taskAffinity?.instanceId ?? null,
        },
        scheduledTaskRun: overrides.scheduledTaskRun ?? null,
        parentLoopRun: overrides.parentLoopRun ?? null,
        loopVersion: { id: "loop_version_linux_1", loopDefinitionId: "loop_definition_linux_1", graph: linuxGraph },
      },
    };
  }

  function linuxClaimDependencies(input: {
    candidate?: ReturnType<typeof linuxCandidate> | null;
    activeCount?: number;
    poolActiveCount?: number;
    loadScheduledTaskRun?: LinuxWorkerClaimDependencies["tx"]["projectScheduledTaskRun"]["findUnique"];
    resolveProjectEnvironmentSecrets?: (input: { projectId: string; names: string[] }) => Promise<Record<string, string>>;
  } = {}) {
    const candidateValue = input.candidate === undefined ? linuxCandidate() : input.candidate;
    const tx = {
      agentRun: {
        count: vi.fn().mockImplementation(({ where }) => Promise.resolve(
          where.linuxWorkerPoolSession?.workerPoolId === "a".repeat(32)
            ? input.poolActiveCount ?? 0
            : input.activeCount ?? 0,
        )),
        findMany: vi.fn().mockResolvedValue(input.candidate === undefined ? [linuxCandidate()] : input.candidate ? [input.candidate] : []),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      task: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      loopNodeRun: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      projectScheduledTaskRun: {
        findUnique: input.loadScheduledTaskRun ?? vi.fn(async ({ where }: { where: { id: string } }) => {
          const direct = candidateValue?.loopRun.scheduledTaskRun;
          if (!direct || direct.id !== where.id) return null;
          return {
            id: direct.id,
            scheduledTaskId: "d".repeat(32),
            projectDigest: scheduledTaskProjectDigest(candidateValue.projectId),
            taskSnapshot: direct.taskSnapshot,
            contentSnapshot: direct.contentSnapshot,
          };
        }),
      },
    };
    return {
      tx,
      flags: { graphV1: true },
      resolveModelSiteSecret: vi.fn().mockResolvedValue({
        id: "b".repeat(32),
        endpoint: "https://codex.example.com/v1",
        apiKeyReference: "b".repeat(32),
        apiKey: "configured-key",
      }),
      resolveProjectEnvironmentSecrets: input.resolveProjectEnvironmentSecrets ?? vi.fn().mockResolvedValue({}),
    };
  }

  const linuxClaimInput = {
    poolId: "a".repeat(32),
    sessionId: "c".repeat(32),
    instanceId: "worker-01",
    ownerType: "personal" as const,
    ownerUserId: "user_owner",
    companyId: null,
    capabilities: { files: true },
    requestedConcurrency: 2,
    resourceLimits: { gpuConcurrency: 1, unityBuildConcurrency: 1 },
    maxConcurrentRuns: 2,
    acceptAssignments: true,
    now: new Date("2026-08-24T08:00:00.000Z"),
    leaseDurationMs: 60_000,
  };

  it("injects project-managed Worker environment values into the lease without snapshot persistence", async () => {
    const resolveProjectEnvironmentSecrets = vi.fn().mockResolvedValue({
      HT_GIT_USERNAME: "git-user",
      HT_GIT_TOKEN: "git-token",
    });
    const dependencies = linuxClaimDependencies({
      candidate: linuxCandidate({
        environmentConfiguration: {
          schemaVersion: 1,
          entries: [
            { name: "HT_GIT_USERNAME", sourceType: "humanthread", executionTargets: ["worker"], status: "configured" },
            { name: "HT_GIT_TOKEN", sourceType: "humanthread", executionTargets: ["worker"], status: "configured" },
            { name: "LOCAL_ONLY", sourceType: "humanthread", executionTargets: ["local_agent"], status: "configured" },
          ],
        },
      }),
      resolveProjectEnvironmentSecrets,
    });

    const result = await claimLinuxWorkerAssignment(linuxClaimInput, dependencies);

    expect(resolveProjectEnvironmentSecrets).toHaveBeenCalledWith({
      projectId: "project_1",
      names: ["HT_GIT_TOKEN", "HT_GIT_USERNAME"],
    });
    expect(result.assignment?.executionCredentials).toMatchObject({
      apiKey: "configured-key",
      environment: { HT_GIT_USERNAME: "git-user", HT_GIT_TOKEN: "git-token" },
    });
    expect(JSON.stringify(result.assignment?.executionSnapshot)).not.toContain("git-token");
  });

  it("maps verified project repository credentials to the internal Git secret", async () => {
    const resolveProjectEnvironmentSecrets = vi.fn().mockResolvedValue({
      HT_GIT_USERNAME: "x-access-token",
      HT_GIT_TOKEN: "verified-token",
    });
    const dependencies = linuxClaimDependencies({
      candidate: linuxCandidate({
        repositoryConfiguration: {
          schemaVersion: 1,
          provider: "github",
          creationMode: "existing",
          privateBaseUrl: null,
          privateWebUrl: null,
          privateTokenHelpUrl: null,
          authMode: "project_token",
          verification: { status: "passed", verifiedAt: "2026-09-28T12:00:00.000Z", defaultBranch: "main", headSha: "a".repeat(40), failureCode: null, apiChecked: false },
        },
      }),
      resolveProjectEnvironmentSecrets,
    });

    const result = await claimLinuxWorkerAssignment(linuxClaimInput, dependencies);

    expect(resolveProjectEnvironmentSecrets).toHaveBeenCalledWith({
      projectId: "project_1",
      names: ["HT_GIT_TOKEN", "HT_GIT_USERNAME"],
    });
    expect(result.assignment?.executionCredentials.environment).toMatchObject({
      HT_GIT_USERNAME: "x-access-token",
      HT_GIT_SECRET: "verified-token",
    });
    expect(JSON.stringify(result.assignment?.executionSnapshot)).not.toContain("verified-token");
  });

  it("fails closed before claiming work when project repository verification is incomplete", async () => {
    const dependencies = linuxClaimDependencies({
      candidate: linuxCandidate({
        repositoryConfiguration: {
          schemaVersion: 1,
          provider: "github",
          creationMode: "existing",
          privateBaseUrl: null,
          privateWebUrl: null,
          privateTokenHelpUrl: null,
          authMode: "project_token",
          verification: { status: "pending_verification", verifiedAt: null, defaultBranch: null, headSha: null, failureCode: null, apiChecked: false },
        },
      }),
      resolveProjectEnvironmentSecrets: vi.fn().mockResolvedValue({ HT_GIT_USERNAME: "x-access-token", HT_GIT_TOKEN: "pending-token" }),
    });

    await expect(claimLinuxWorkerAssignment(linuxClaimInput, dependencies)).rejects.toMatchObject({ code: "repository_credential_unverified" });
    expect(dependencies.tx.agentRun.updateMany).not.toHaveBeenCalled();
    expect(dependencies.tx.task.updateMany).not.toHaveBeenCalled();
  });

  it("maps verified account-password credentials without leaking the password slot", async () => {
    const resolveProjectEnvironmentSecrets = vi.fn().mockResolvedValue({
      HT_GIT_USERNAME: "deploy",
      HT_GIT_PASSWORD: "account-password",
    });
    const dependencies = linuxClaimDependencies({
      candidate: linuxCandidate({
        repositoryConfiguration: {
          schemaVersion: 1,
          provider: "private",
          creationMode: "existing",
          privateBaseUrl: "https://git.example.com",
          privateWebUrl: null,
          privateTokenHelpUrl: null,
          authMode: "account_password",
          verification: { status: "passed", verifiedAt: "2026-09-28T12:00:00.000Z", defaultBranch: "main", headSha: "a".repeat(40), failureCode: null, apiChecked: false },
        },
      }),
      resolveProjectEnvironmentSecrets,
    });

    const result = await claimLinuxWorkerAssignment(linuxClaimInput, dependencies);

    expect(resolveProjectEnvironmentSecrets).toHaveBeenCalledWith({
      projectId: "project_1",
      names: ["HT_GIT_PASSWORD", "HT_GIT_USERNAME"],
    });
    expect(result.assignment?.executionCredentials.environment).toMatchObject({
      HT_GIT_USERNAME: "deploy",
      HT_GIT_SECRET: "account-password",
    });
    expect(result.assignment?.executionCredentials.environment).not.toHaveProperty("HT_GIT_PASSWORD");
    expect(JSON.stringify(result.assignment?.executionSnapshot)).not.toContain("account-password");
  });

  it("fails closed when a Project has malformed repository configuration", async () => {
    const dependencies = linuxClaimDependencies({
      candidate: linuxCandidate({ repositoryConfiguration: { schemaVersion: 1 } }),
    });

    await expect(claimLinuxWorkerAssignment(linuxClaimInput, dependencies)).rejects.toMatchObject({ code: "repository_credential_unverified" });
    expect(dependencies.tx.agentRun.updateMany).not.toHaveBeenCalled();
  });

  it("fails closed when verified repository credentials were revoked", async () => {
    const dependencies = linuxClaimDependencies({
      candidate: linuxCandidate({
        repositoryConfiguration: {
          schemaVersion: 1,
          provider: "github",
          creationMode: "existing",
          privateBaseUrl: null,
          privateWebUrl: null,
          privateTokenHelpUrl: null,
          authMode: "project_token",
          verification: { status: "passed", verifiedAt: "2026-09-28T12:00:00.000Z", defaultBranch: "main", headSha: "a".repeat(40), failureCode: null, apiChecked: false },
        },
      }),
      resolveProjectEnvironmentSecrets: vi.fn().mockResolvedValue({}),
    });

    await expect(claimLinuxWorkerAssignment(linuxClaimInput, dependencies)).rejects.toMatchObject({ code: "repository_credential_unverified" });
    expect(dependencies.tx.agentRun.updateMany).not.toHaveBeenCalled();
  });

  it("does not claim a Linux assignment from another resource scope or Pool", async () => {
    const foreignOwner = linuxClaimDependencies({ candidate: linuxCandidate({
      projectScope: { ownerType: "personal", ownerUserId: "user_other", companyId: null },
    }) });
    const foreignPool = linuxClaimDependencies({ candidate: linuxCandidate({ poolId: "d".repeat(32) }) });

    await expect(claimLinuxWorkerAssignment(linuxClaimInput, foreignOwner)).resolves.toEqual({ assignment: null });
    await expect(claimLinuxWorkerAssignment(linuxClaimInput, foreignPool)).resolves.toEqual({ assignment: null });

    expect(foreignOwner.resolveModelSiteSecret).not.toHaveBeenCalled();
    expect(foreignPool.resolveModelSiteSecret).not.toHaveBeenCalled();
  });

  it("binds a task to the first Linux Worker instance and rejects a different instance", async () => {
    const firstDependencies = linuxClaimDependencies();
    const first = await claimLinuxWorkerAssignment(linuxClaimInput, firstDependencies);

    expect(first.assignment).toMatchObject({
      executionSnapshot: { workerInstanceId: "worker-01" },
    });
    expect(firstDependencies.tx.task.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: "task_linux_1" }),
      data: expect.objectContaining({ linuxWorkerPoolId: "a".repeat(32), linuxWorkerInstanceId: "worker-01" }),
    }));

    const otherDependencies = linuxClaimDependencies({ candidate: linuxCandidate({
      taskAffinity: { poolId: "a".repeat(32), instanceId: "worker-01" },
    }) });
    const other = await claimLinuxWorkerAssignment({ ...linuxClaimInput, instanceId: "worker-02" }, otherDependencies);
    expect(other).toEqual({ assignment: null });
    expect(otherDependencies.resolveModelSiteSecret).not.toHaveBeenCalled();
  });

  it("rejects a partially bound Docker task instead of allowing another instance to claim it", async () => {
    const dependencies = linuxClaimDependencies({ candidate: linuxCandidate({
      taskAffinity: { poolId: "a".repeat(32), instanceId: null },
    }) });

    await expect(claimLinuxWorkerAssignment({ ...linuxClaimInput, instanceId: "worker-02" }, dependencies))
      .resolves.toEqual({ assignment: null });
    expect(dependencies.resolveModelSiteSecret).not.toHaveBeenCalled();
  });

  it("does not pin a Kubernetes task to one replica", async () => {
    const dependencies = linuxClaimDependencies();

    const result = await claimLinuxWorkerAssignment({
      ...linuxClaimInput,
      runtime: "kubernetes",
    }, dependencies);

    expect(result.assignment).toMatchObject({
      executionSnapshot: { workerPoolId: "a".repeat(32) },
    });
    expect(result.assignment?.executionSnapshot).not.toHaveProperty("workerInstanceId");
    expect(dependencies.tx.task.updateMany).not.toHaveBeenCalled();
  });

  it("claims a company project using its company Pool even when a different member created the binding", async () => {
    const dependencies = linuxClaimDependencies({ candidate: linuxCandidate({
      projectScope: { ownerType: "company", ownerUserId: null, companyId: "company_1" },
    }) });
    const result = await claimLinuxWorkerAssignment({
      ...linuxClaimInput,
      ownerType: "company",
      ownerUserId: null,
      companyId: "company_1",
    }, dependencies);

    expect(result.assignment).toMatchObject({ workerKind: "linux" });
    expect(dependencies.resolveModelSiteSecret).toHaveBeenCalledWith({
      scope: { ownerType: "company", ownerUserId: null, companyId: "company_1" },
      siteId: "b".repeat(32),
    });
  });

  it("claims a generated task branch covered by a full-string policy glob", async () => {
    const dependencies = linuxClaimDependencies({ candidate: linuxCandidate({
      allowedBranches: ["2026-HUMANTHR*"],
      taskBranch: "2026-HUMANTHR1100008",
    }) });

    await expect(claimLinuxWorkerAssignment(linuxClaimInput, dependencies)).resolves.toMatchObject({
      assignment: { executionSnapshot: { repository: { branch: "2026-HUMANTHR1100008" } } },
    });
  });

  it("uses a literal checkout baseline when a project-level run has no task branch", () => {
    expect(resolveLinuxWorkerBranch(null, { allowedBranches: ["2026-HUMANTHR*", "main"] })).toBe("main");
  });

  it("claims project-level release input without inventing a task record", async () => {
    const dependencies = linuxClaimDependencies({ candidate: linuxCandidate({
      projectRun: true,
      allowedBranches: ["2026-HUMANTHR*", "main"],
      inputSnapshot: { selectedTasks: [{ taskBranch: "2026-HUMANTHR1100008" }] },
    }) });

    await expect(claimLinuxWorkerAssignment(linuxClaimInput, dependencies)).resolves.toMatchObject({
      assignment: {
        executionSnapshot: { repository: { branch: "main" } },
        inputSnapshot: { selectedTasks: [{ taskBranch: "2026-HUMANTHR1100008" }] },
        stageRef: {
          loopDefinitionId: "loop_definition_linux_1",
          loopVersionId: "loop_version_linux_1",
          nodeId: "work",
          subloopId: "work",
        },
      },
    });
  });

  it("does not require Local Agent profile capabilities when claiming Linux work", async () => {
    const candidate = linuxCandidate();
    candidate.agentProfile.capabilities = ["structured_result", "commands", "filesystem"];
    const dependencies = linuxClaimDependencies({ candidate });

    await expect(claimLinuxWorkerAssignment(linuxClaimInput, dependencies)).resolves.toMatchObject({
      assignment: { workerKind: "linux" },
    });
    expect(dependencies.resolveModelSiteSecret).toHaveBeenCalled();
  });

  it("fails closed when the claimed stage lacks explicit Linux configuration", async () => {
    const dependencies = linuxClaimDependencies({ candidate: linuxCandidate({ stageConfigurations: {} }) });

    await expect(claimLinuxWorkerAssignment(linuxClaimInput, dependencies))
      .rejects.toMatchObject({ code: "configuration_required" });
  });

  it("returns the configured model and transport-only key without persisting the key", async () => {
    const dependencies = linuxClaimDependencies();

    const result = await claimLinuxWorkerAssignment(linuxClaimInput, dependencies);

    expect(result.assignment).toMatchObject({
      executionSnapshot: {
        model: { model: "configured-model", reasoningEffort: "high" },
      },
      executionCredentials: { apiKey: "configured-key" },
    });
    expect(dependencies.tx.loopNodeRun.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: { selectedExecutionTarget: "linux_worker_pool" },
    }));
    const persistedInput = dependencies.tx.agentRun.updateMany.mock.calls[0]?.[0]?.data?.inputSnapshot;
    expect(JSON.stringify(persistedInput)).not.toContain("configured-key");
  });

  it("builds the Linux Worker prompt from the task, node, branch, and delivery contract", async () => {
    const result = await claimLinuxWorkerAssignment(linuxClaimInput, linuxClaimDependencies({
      candidate: linuxCandidate({
        stageConfigurations: {
          work: {
            siteId: "b".repeat(32),
            model: "configured-model",
            reasoningEffort: "high",
            requireGitDelivery: true,
          },
        },
      }),
    }));

    expect(result.assignment?.prompt).toContain("Implement saved-view task management");
    expect(result.assignment?.prompt).toContain("Add multi-select controls and an archive entry for saved task views.");
    expect(result.assignment?.prompt).toContain("Users can select multiple saved views.");
    expect(result.assignment?.prompt).toContain("Node: Work (work)");
    expect(result.assignment?.prompt).toContain("Task branch: main");
    expect(result.assignment?.prompt).toContain("Implement the task");
    expect(result.assignment?.prompt).toContain("commit and push the task branch");
    expect(result.assignment?.prompt).not.toContain("configured-key");
  });

  it("reads immutable platform scheduled task content into each Linux Worker claim without persisting it", async () => {
    const candidate = linuxCandidate({
      projectRun: true,
      scheduledTaskRun: {
        id: "d".repeat(32),
        taskSnapshot: { name: "每日巡检", description: "检查昨日交付", contentMode: "platform" },
        contentSnapshot: "# 巡检项\n- 检查日志",
      },
    });
    const firstDependencies = linuxClaimDependencies({ candidate });
    const secondDependencies = linuxClaimDependencies({ candidate });

    const first = await claimLinuxWorkerAssignment(linuxClaimInput, firstDependencies);
    const second = await claimLinuxWorkerAssignment(linuxClaimInput, secondDependencies);

    expect(first.assignment?.inputSnapshot).toMatchObject({
      scheduledTask: {
        id: "d".repeat(32),
        name: "每日巡检",
        description: "检查昨日交付",
        contentMode: "platform",
        contentMarkdown: "# 巡检项\n- 检查日志",
      },
    });
    expect(first.assignment).not.toHaveProperty("contentSnapshot");
    expect(first.assignment?.prompt).toContain("Task: 每日巡检");
    expect(first.assignment?.prompt).toContain("Task details and acceptance criteria:");
    expect(first.assignment?.prompt).toContain("# 巡检项");
    expect(second.assignment).toEqual(first.assignment);

    const persistedInput = firstDependencies.tx.agentRun.updateMany.mock.calls[0]?.[0]?.data?.inputSnapshot;
    expect(JSON.stringify(persistedInput)).not.toContain("每日巡检");
    expect(JSON.stringify(persistedInput)).not.toContain("巡检项");
  });

  it("omits loop-managed scheduled task content from Linux Worker claims", async () => {
    const dependencies = linuxClaimDependencies({
      candidate: linuxCandidate({
        projectRun: true,
        scheduledTaskRun: {
          id: "d".repeat(32),
          taskSnapshot: { name: "项目巡检", description: "", contentMode: "loop_managed" },
          contentSnapshot: "# 不应泄漏",
        },
      }),
    });

    const result = await claimLinuxWorkerAssignment(linuxClaimInput, dependencies);
    const inputSnapshot = result.assignment?.inputSnapshot as { scheduledTask?: Record<string, unknown> } | undefined;

    expect(inputSnapshot?.scheduledTask).toEqual({
      id: "d".repeat(32), name: "项目巡检", description: "", contentMode: "loop_managed",
    });
    expect(inputSnapshot?.scheduledTask).not.toHaveProperty("contentMarkdown");
    expect(result.assignment).not.toHaveProperty("contentSnapshot");
    expect(JSON.stringify(dependencies.tx.agentRun.updateMany.mock.calls[0]?.[0]?.data?.inputSnapshot)).not.toContain("不应泄漏");
  });

  it("injects scheduled content into a project-root child Linux Worker claim", async () => {
    const scheduledTaskRunId = "e".repeat(32);
    const scheduledTaskId = "d".repeat(32);
    const dependencies = linuxClaimDependencies({
      candidate: linuxCandidate({
        projectRun: true,
        loopRunInputSnapshot: { scheduledTaskId, scheduledTaskRunId },
        parentLoopRun: {
          id: "root_project",
          projectId: "project_1",
          scheduledTaskRunId,
          inputSnapshot: { scheduledTaskId, scheduledTaskRunId },
        },
      }),
      loadScheduledTaskRun: vi.fn().mockResolvedValue({
        id: scheduledTaskRunId,
        scheduledTaskId,
        projectDigest: scheduledTaskProjectDigest("project_1"),
        taskSnapshot: { name: "项目巡检", description: "检查", contentMode: "platform" },
        contentSnapshot: "# 项目根巡检",
      }),
    });

    const result = await claimLinuxWorkerAssignment(linuxClaimInput, dependencies);
    expect(result.assignment?.inputSnapshot).toMatchObject({
      scheduledTask: {
        id: scheduledTaskRunId,
        name: "项目巡检",
        contentMode: "platform",
        contentMarkdown: "# 项目根巡检",
      },
    });
  });

  it("injects scheduled content into a task-scoped-root child Linux Worker claim", async () => {
    const scheduledTaskRunId = "e".repeat(32);
    const scheduledTaskId = "d".repeat(32);
    const dependencies = linuxClaimDependencies({
      candidate: linuxCandidate({
        projectRun: true,
        loopRunInputSnapshot: { scheduledTaskId, scheduledTaskRunId, taskId: "task_1" },
        parentLoopRun: {
          id: "root_task",
          projectId: "project_1",
          scheduledTaskRunId: null,
          inputSnapshot: { scheduledTaskId, scheduledTaskRunId, taskId: "task_1" },
        },
      }),
      loadScheduledTaskRun: vi.fn().mockResolvedValue({
        id: scheduledTaskRunId,
        scheduledTaskId,
        projectDigest: scheduledTaskProjectDigest("project_1"),
        taskSnapshot: { name: "任务巡检", description: "检查", contentMode: "platform" },
        contentSnapshot: "# 任务根巡检",
      }),
    });

    const result = await claimLinuxWorkerAssignment(linuxClaimInput, dependencies);
    expect(result.assignment?.inputSnapshot).toMatchObject({
      scheduledTask: {
        id: scheduledTaskRunId,
        name: "任务巡检",
        contentMode: "platform",
        contentMarkdown: "# 任务根巡检",
      },
    });
  });

  it("keeps loop-managed child Linux Worker claims free of platform markdown", async () => {
    const scheduledTaskRunId = "e".repeat(32);
    const scheduledTaskId = "d".repeat(32);
    const dependencies = linuxClaimDependencies({
      candidate: linuxCandidate({
        projectRun: true,
        loopRunInputSnapshot: { scheduledTaskId, scheduledTaskRunId },
        parentLoopRun: {
          id: "root_project",
          projectId: "project_1",
          scheduledTaskRunId,
          inputSnapshot: { scheduledTaskId, scheduledTaskRunId },
        },
      }),
      loadScheduledTaskRun: vi.fn().mockResolvedValue({
        id: scheduledTaskRunId,
        scheduledTaskId,
        projectDigest: scheduledTaskProjectDigest("project_1"),
        taskSnapshot: { name: "项目巡检", description: "检查", contentMode: "loop_managed" },
        contentSnapshot: "# 不应泄漏",
      }),
    });

    const result = await claimLinuxWorkerAssignment(linuxClaimInput, dependencies);
    const scheduledTask = (result.assignment?.inputSnapshot as { scheduledTask?: Record<string, unknown> }).scheduledTask;
    expect(scheduledTask).toMatchObject({ id: scheduledTaskRunId, contentMode: "loop_managed" });
    expect(scheduledTask).not.toHaveProperty("contentMarkdown");
    expect(JSON.stringify(result.assignment)).not.toContain("不应泄漏");
  });

  it("fails a Linux Worker claim when platform scheduled task content is missing", async () => {
    const dependencies = linuxClaimDependencies({
      candidate: linuxCandidate({
        projectRun: true,
        scheduledTaskRun: {
          id: "d".repeat(32),
          taskSnapshot: { name: "每日巡检", description: "", contentMode: "platform" },
          contentSnapshot: null,
        },
      }),
    });

    await expect(claimLinuxWorkerAssignment(linuxClaimInput, dependencies)).rejects.toMatchObject({
      code: "configuration_required",
    });
    expect(dependencies.resolveModelSiteSecret).not.toHaveBeenCalled();
    expect(dependencies.tx.agentRun.updateMany).not.toHaveBeenCalled();
  });

  it("builds a Linux Worker prompt from scheduled task content when no normal task exists", () => {
    const prompt = buildLinuxWorkerStagePrompt({
      task: scheduledTaskPromptTask({
        id: "d".repeat(32),
        taskSnapshot: { name: "每日巡检", description: "检查昨日交付" },
        contentMode: "platform",
        contentSnapshot: "# 巡检项\n- 检查日志",
      }),
      node: { key: "work", label: "Work", promptTemplate: "执行巡检" },
      taskBranch: "main",
      requireGitDelivery: false,
    });

    expect(prompt).toContain("Task: 每日巡检");
    expect(prompt).toContain("检查昨日交付");
    expect(prompt).toContain("# 巡检项");
  });

  it("includes project-level run input and repository rules in a Linux Worker prompt", () => {
    const prompt = buildLinuxWorkerStagePrompt({
      task: null,
      node: { key: "staging", label: "staging", promptTemplate: "完成当前节点目标" },
      taskBranch: "main",
      requireGitDelivery: false,
      inputSnapshot: {
        releasePlanId: "plan_1",
        selectedTasks: [{ taskId: "task_1", taskBranch: "2026-HUMANTHR1100008" }],
        token: "must-not-appear",
      },
    });

    expect(prompt).toContain("repository-local instructions and Stage Package when present");
    expect(prompt).toContain("2026-HUMANTHR1100008");
    expect(prompt).toContain("[REDACTED]");
    expect(prompt).not.toContain("must-not-appear");
  });

  it("sanitizes credentials from project-level assignment input before Worker delivery", () => {
    const sanitized = sanitizeWorkerInputSnapshot({
      sshPrivateKey: "-----BEGIN OPENSSH PRIVATE KEY-----secret-----END OPENSSH PRIVATE KEY-----",
      privateKey: "-----BEGIN PRIVATE KEY-----secret-----END PRIVATE KEY-----",
      basicAuth: "user:password",
      notes: "password=inline-secret",
      jwt: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.signature-secret-value",
      dsn: "mysql://db-user:db-password@db.example.invalid/app",
      selectedTasks: [{ taskBranch: "2026-HUMANTHR1100008" }],
    });

    const serialized = JSON.stringify(sanitized);
    expect(serialized).not.toContain("inline-secret");
    expect(serialized).not.toContain("db-user");
    expect(serialized).not.toContain("db-password");
    expect(serialized).not.toContain("signature-secret-value");
    expect(serialized).toContain("password=[REDACTED]");
    expect(sanitized).toMatchObject({ selectedTasks: [{ taskBranch: "2026-HUMANTHR1100008" }] });
  });

  it("does not redact ordinary scheduled task content as a credential", () => {
    const contentMarkdown = "# 巡检项\n- 检查密码重置流程\n- 核对 token 使用说明";
    const sanitized = sanitizeWorkerInputSnapshot(withScheduledTaskExecutionContext({}, {
      id: "d".repeat(32),
      taskSnapshot: { name: "每日巡检", description: "" },
      contentMode: "platform",
      contentSnapshot: contentMarkdown,
    })) as { scheduledTask: { contentMarkdown: string } };

    expect(sanitized.scheduledTask.contentMarkdown).toBe(contentMarkdown);
  });

  it("does not exceed the authenticated session concurrency", async () => {
    const dependencies = linuxClaimDependencies({ activeCount: 2 });

    await expect(claimLinuxWorkerAssignment(linuxClaimInput, dependencies)).resolves.toEqual({ assignment: null });

    expect(dependencies.tx.agentRun.findMany).not.toHaveBeenCalled();
    expect(dependencies.resolveModelSiteSecret).not.toHaveBeenCalled();
  });

  it("does not exceed the Pool concurrency when another session has the active leases", async () => {
    const dependencies = linuxClaimDependencies({ poolActiveCount: 2 });

    await expect(claimLinuxWorkerAssignment(linuxClaimInput, dependencies)).resolves.toEqual({ assignment: null });

    expect(dependencies.tx.agentRun.findMany).not.toHaveBeenCalled();
    expect(dependencies.resolveModelSiteSecret).not.toHaveBeenCalled();
  });

  it("does not claim a second GPU stage when the session has reached its immutable GPU limit", async () => {
    const gpuCandidate = linuxCandidate();
    (gpuCandidate as { inputSnapshot: unknown }).inputSnapshot = { workerExecutionSnapshot: { resources: { gpu: true, unityBuild: false } } };
    (gpuCandidate.loopRun.loopVersion as { graph: unknown }).graph = {
      ...linuxGraph,
      nodes: linuxGraph.nodes.map((node) => node.key === "work" ? { ...node, requiredCapabilities: ["files", "gpu"] } : node),
    };
    const dependencies = linuxClaimDependencies({ candidate: gpuCandidate });

    await expect(claimLinuxWorkerAssignment(linuxClaimInput, dependencies)).resolves.toEqual({ assignment: null });

    expect(dependencies.resolveModelSiteSecret).not.toHaveBeenCalled();
  });
});

describe("Linux Worker heartbeats", () => {
  it("accepts only a bounded session identity and returns the renewed lease", async () => {
    const heartbeat = vi.fn().mockResolvedValue({
      leaseExpiresAt: new Date("2026-08-24T08:01:00.000Z"),
    });

    await expect(heartbeatLinuxWorkerAssignment({
      agentRunId: "agent_run_linux_1",
      poolId: "a".repeat(32),
      sessionId: "b".repeat(32),
      leaseGeneration: 5,
      commandId: "heartbeat_1",
      now: new Date("2026-08-24T08:00:00.000Z"),
      leaseDurationMs: 60_000,
    }, { heartbeat })).resolves.toEqual({
      leaseExpiresAt: "2026-08-24T08:01:00.000Z",
      leaseDurationMs: 60_000,
    });

    expect(heartbeat).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: "b".repeat(32),
      poolId: "a".repeat(32),
    }));
  });

  it("rejects a malformed Linux Worker session identity before touching persistence", async () => {
    const heartbeat = vi.fn();

    await expect(heartbeatLinuxWorkerAssignment({
      agentRunId: "agent_run_linux_1",
      poolId: "a".repeat(32),
      sessionId: "session-not-a-persistence-id",
      leaseGeneration: 5,
      commandId: "heartbeat_1",
      now: new Date("2026-08-24T08:00:00.000Z"),
      leaseDurationMs: 60_000,
    }, { heartbeat })).rejects.toMatchObject({ code: "stale_lease" });

    expect(heartbeat).not.toHaveBeenCalled();
  });
});

describe("Linux Worker event batches", () => {
  it("rejects an invalid execution phase payload before persistence", async () => {
    const persistEvents = vi.fn();

    await expect(appendLinuxWorkerAssignmentEvents({
      agentRunId: "agent_run_linux_1",
      sessionId: "b".repeat(32),
      leaseGeneration: 5,
      commandId: "events_phase_invalid",
      loopNodeAttemptId: "loop_attempt_linux_1",
      events: [{
        eventId: "event_phase_invalid",
        loopRunId: "loop_run_linux_1",
        loopNodeRunId: "node_run_linux_1",
        loopNodeAttemptId: "loop_attempt_linux_1",
        attemptNo: 1,
        leaseGeneration: 5,
        sequence: 1,
        eventType: "loop.node.execution_phase_changed",
        occurredAt: "2026-08-24T08:00:00.000Z",
        payloadSummary: {
          phase: "git.fetch",
          status: "unknown",
          startedAt: "2026-08-24T08:00:00.000Z",
          finishedAt: null,
          code: null,
          summary: null,
        },
        artifactRefs: [],
      }],
      now: new Date("2026-08-24T08:00:00.000Z"),
    }, { persistEvents })).rejects.toMatchObject({ code: "validation_failed" });

    expect(persistEvents).not.toHaveBeenCalled();
  });

  it("forwards a validated execution phase event to persistence", async () => {
    const persistEvents = vi.fn().mockResolvedValue({ acceptedThroughSequence: 2 });

    await expect(appendLinuxWorkerAssignmentEvents({
      agentRunId: "agent_run_linux_1",
      sessionId: "b".repeat(32),
      leaseGeneration: 5,
      commandId: "events_phase_valid",
      loopNodeAttemptId: "loop_attempt_linux_1",
      events: [{
        eventId: "event_phase_valid",
        loopRunId: "loop_run_linux_1",
        loopNodeRunId: "node_run_linux_1",
        loopNodeAttemptId: "loop_attempt_linux_1",
        attemptNo: 1,
        leaseGeneration: 5,
        sequence: 2,
        eventType: "loop.node.execution_phase_changed",
        occurredAt: "2026-08-24T08:00:05.000Z",
        payloadSummary: {
          phase: "git.fetch",
          status: "succeeded",
          startedAt: "2026-08-24T08:00:00.000Z",
          finishedAt: "2026-08-24T08:00:05.000Z",
          code: null,
          summary: null,
        },
        artifactRefs: [],
      }],
      now: new Date("2026-08-24T08:00:05.000Z"),
    }, { persistEvents })).resolves.toEqual({ acceptedThroughSequence: 2 });

    expect(persistEvents).toHaveBeenCalledOnce();
  });

  it("uses the Pool session as the event lease owner", async () => {
    const persistEvents = vi.fn().mockResolvedValue({ acceptedThroughSequence: 1 });

    await expect(appendLinuxWorkerAssignmentEvents({
      agentRunId: "agent_run_linux_1",
      sessionId: "b".repeat(32),
      leaseGeneration: 5,
      commandId: "events_1",
      loopNodeAttemptId: "loop_attempt_linux_1",
      events: [{
        eventId: "event_linux_1",
        loopRunId: "loop_run_linux_1",
        loopNodeRunId: "node_run_linux_1",
        loopNodeAttemptId: "loop_attempt_linux_1",
        attemptNo: 1,
        leaseGeneration: 5,
        sequence: 1,
        eventType: "loop.node.progressed",
        occurredAt: "2026-08-24T08:00:00.000Z",
        payloadSummary: { phase: "running" },
        artifactRefs: [],
      }],
      now: new Date("2026-08-24T08:00:00.000Z"),
    }, { persistEvents })).resolves.toEqual({ acceptedThroughSequence: 1 });

    expect(persistEvents).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: "b".repeat(32),
      workerId: undefined,
    }));
  });
});

describe("Linux Worker checkpoints", () => {
  it("stores an idempotent checkpoint only for the Pool session that owns the lease", async () => {
    const run = {
      id: "agent_run_linux_1",
      taskId: null,
      loopRunId: "loop_run_linux_1",
      loopNodeRunId: "node_run_linux_1",
      loopNodeAttemptId: "loop_attempt_linux_1",
      attempt: 1,
      nodeRunVersion: 4,
      nodeRunAttemptCount: 1,
      attemptVersion: 3,
      checkpoint: null,
      status: "running",
      workerId: null,
      linuxWorkerPoolSessionId: "b".repeat(32),
      leaseGeneration: 5,
      leaseExpiresAt: new Date("2026-08-24T08:01:00.000Z"),
      lastEventSequence: 1,
    };
    const loadRun = vi.fn().mockResolvedValue(run);
    const persistCheckpoint = vi.fn().mockResolvedValue({ checkpointed: true, duplicate: false });

    await expect(saveLinuxWorkerAssignmentCheckpoint({
      agentRunId: "agent_run_linux_1",
      sessionId: "b".repeat(32),
      leaseGeneration: 5,
      commandId: "checkpoint_1",
      loopRunId: "loop_run_linux_1",
      loopNodeRunId: "node_run_linux_1",
      loopNodeAttemptId: "loop_attempt_linux_1",
      attemptNo: 1,
      checkpoint: { phase: "running" },
      now: new Date("2026-08-24T08:00:00.000Z"),
    }, { loadRun, persistCheckpoint })).resolves.toEqual({ checkpointed: true, duplicate: false });

    expect(persistCheckpoint).toHaveBeenCalledWith(expect.objectContaining({
      storedCheckpoint: expect.objectContaining({ commandId: "checkpoint_1", value: { phase: "running" } }),
    }));
  });
});

describe("Linux Worker completion", () => {
  it("uses the Pool session lease when completing a stage", async () => {
    const run = {
      id: "agent_run_linux_1", taskId: null, loopRunId: "loop_run_linux_1", loopNodeRunId: "node_run_linux_1",
      loopNodeAttemptId: "loop_attempt_linux_1", attempt: 1, nodeRunVersion: 4, nodeRunAttemptCount: 1,
      attemptVersion: 3, checkpoint: null, status: "running", workerId: null,
      linuxWorkerPoolSessionId: "b".repeat(32), leaseGeneration: 5,
      leaseExpiresAt: new Date("2026-08-24T08:01:00.000Z"), lastEventSequence: 1,
    };
    const loadRun = vi.fn().mockResolvedValue(run);
    const persistResult = vi.fn().mockResolvedValue({ completed: true, duplicate: false });
    const executeIdempotent = vi.fn(async ({ apply }) => apply());

    await expect(completeLinuxWorkerAssignment({
      agentRunId: "agent_run_linux_1", sessionId: "b".repeat(32), leaseGeneration: 5,
      commandId: "result_1", loopRunId: "loop_run_linux_1", loopNodeRunId: "node_run_linux_1",
      loopNodeAttemptId: "loop_attempt_linux_1", attemptNo: 1,
      result: { outcome: "success", output: { done: true }, artifactRefs: [], effectReceipts: [] },
      now: new Date("2026-08-24T08:00:00.000Z"),
    }, { loadRun, persistResult, executeIdempotent })).resolves.toEqual({ completed: true, duplicate: false });

    expect(persistResult).toHaveBeenCalledWith(expect.objectContaining({
      command: expect.objectContaining({ sessionId: "b".repeat(32), commandId: "result_1" }),
    }));
  });
});
