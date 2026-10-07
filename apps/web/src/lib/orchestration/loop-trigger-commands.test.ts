import { describe, expect, it, vi } from "vitest";
import type { LoopGraph, LoopGraphV2, RunGraphSnapshot, RunGraphSnapshotV2 } from "@humanthread/shared";
import { triggerProjectLoop, triggerTaskLoop } from "./loop-trigger-commands";

const projectGraph = {
  schemaVersion: 1,
  inputSchema: { type: "object" },
  outputSchema: { type: "object" },
  limits: { maxStages: 3, maxRepeatCount: 2 },
  nodes: [
    { key: "start", nodeId: "project_start", label: "Start", type: "start" },
    {
      key: "develop",
      nodeId: "project_develop",
      label: "Develop",
      type: "subloop_call",
      executionTarget: "platform",
      targetLoopDefinitionId: "task_definition_1",
      targetLoopVersionId: "task_version_1",
      inputMapping: {},
      terminalOutcomeMapping: { success: "success", failure: "failure" },
    },
    { key: "end", nodeId: "project_end", label: "End", type: "end" },
  ],
  edges: [
    { id: "start-develop", source: "start", target: "develop", kind: "normal", outcome: "success" },
    { id: "develop-end", source: "develop", target: "end", kind: "normal", outcome: "success" },
  ],
} satisfies LoopGraph;

const taskGraph = {
  schemaVersion: 1,
  inputSchema: { type: "object" },
  outputSchema: { type: "object" },
  limits: { maxStages: 2, maxRepeatCount: 1 },
  nodes: [
    { key: "start", nodeId: "task_start", label: "Start", type: "start" },
    { key: "end", nodeId: "task_end", label: "End", type: "end" },
  ],
  edges: [{ id: "start-end", source: "start", target: "end", kind: "normal", outcome: "success" }],
} satisfies LoopGraph;

const projectGraphV2 = {
  ...projectGraph,
  schemaVersion: 2,
  routingMetadata: {
    project_develop: { responsibility: "Execute the configured task-development Loop." },
  },
} satisfies LoopGraphV2;

const taskGraphV2 = {
  ...taskGraph,
  schemaVersion: 2,
  routingMetadata: {},
} satisfies LoopGraphV2;

const publishedVersions = [
  { loopDefinitionId: "loop_definition_1", loopVersionId: "loop_version_1", scope: "project" as const, graph: projectGraph },
  { loopDefinitionId: "task_definition_1", loopVersionId: "task_version_1", scope: "task" as const, graph: taskGraph },
  { loopDefinitionId: "task_definition_b", loopVersionId: "task_version_b", scope: "task" as const, graph: taskGraph },
];

const binding = {
  id: "binding_1",
  projectId: "project_1",
  loopDefinitionId: "loop_definition_1",
  activeVersionId: "loop_version_1",
  status: "enabled",
  version: 1,
  createdByUserId: "user_owner",
  triggerPolicy: { manual: true, taskEvents: [] },
  parameterOverrides: {},
  notificationPolicy: {},
  automationGrantIds: [],
  allowedAgentProfileIds: ["profile_codex"],
  allowedProviders: ["codex"],
  bindingRole: "task_development",
  loopDefinition: { scope: "project" },
  activeVersion: {
    id: "loop_version_1",
    status: "published",
    maxStages: 3,
    maxRepeatCount: 2,
    platformMaxTransitions: 8,
  },
};

const grantSnapshot = {
  id: "grant_1",
  projectId: "project_1",
  permission: "workspace_full",
};

function dependencies() {
  return {
    flags: { graphV1: true },
    now: () => new Date("2026-07-30T04:00:00.000Z"),
    assertCanWriteProject: vi.fn().mockResolvedValue({ role: "maintainer" }),
    readEnabledBinding: vi.fn().mockResolvedValue(binding),
    readPublishedVersions: vi.fn().mockResolvedValue(publishedVersions),
    snapshotBindingGrants: vi.fn().mockResolvedValue([grantSnapshot]),
    createGraphLoopRun: vi.fn().mockResolvedValue({ id: "loop_run_existing", engineKind: "graph_v1" }),
  };
}

function taskDependencies() {
  return {
    flags: { graphV1: true },
    now: () => new Date("2026-07-30T04:00:00.000Z"),
    assertCanDispatchTask: vi.fn().mockResolvedValue({ role: "maintainer" }),
    readTask: vi.fn().mockResolvedValue({
      id: "task_1",
      projectId: "project_1",
      version: 3,
      createdAt: new Date("2026-07-29T04:00:00.000Z"),
      taskNumber: 100023,
      shortId: "HT100023",
      taskBranch: null,
      developmentTemplateKey: "branch-development",
      developmentTemplateKind: "branch-development",
      productionBranch: "main",
      stagingBranch: "staging",
    }),
    assignTaskBranch: vi.fn().mockResolvedValue({
      taskId: "task_1",
      taskBranch: "2026-HT100023",
      version: 4,
    }),
    readEnabledTaskBinding: vi.fn().mockResolvedValue(binding),
    resolveExecutionTarget: vi.fn().mockResolvedValue({
      type: "local_agent",
      agentProfileId: "profile_codex",
      profileDisplayName: "Gelsang Codex",
      provider: "codex",
    }),
    readPublishedVersions: vi.fn().mockResolvedValue(publishedVersions),
    snapshotBindingGrants: vi.fn().mockResolvedValue([grantSnapshot]),
    createGraphLoopRun: vi.fn().mockResolvedValue({ id: "loop_run_existing", engineKind: "graph_v1" }),
  };
}

describe("triggerProjectLoop", () => {
  it("resolves the latest published root at Run creation time and freezes it", async () => {
    const deps = dependencies();
    const latestGraph = { ...projectGraph, schemaVersion: 1, limits: { maxStages: 4, maxRepeatCount: 2 } } satisfies LoopGraph;
    deps.readEnabledBinding.mockResolvedValue({
      ...binding,
      activeVersion: { ...binding.activeVersion, maxStages: 3 },
      loopDefinition: {
        scope: "project",
        latestPublishedVersion: {
          id: "loop_version_2",
          status: "published",
          maxStages: 4,
          maxRepeatCount: 2,
          platformMaxTransitions: 12,
        },
      },
      parameterOverrides: {},
    });
    deps.readPublishedVersions.mockResolvedValue([
      { loopDefinitionId: "loop_definition_1", loopVersionId: "loop_version_1", scope: "project", graph: projectGraph },
      { loopDefinitionId: "loop_definition_1", loopVersionId: "loop_version_2", scope: "project", graph: latestGraph },
      { loopDefinitionId: "task_definition_1", loopVersionId: "task_version_1", scope: "task", graph: taskGraph },
    ]);

    await triggerProjectLoop({
      actorUserId: "user_1",
      projectId: "project_1",
      bindingId: "binding_1",
      commandId: "manual_latest",
      payload: {},
    }, deps);

    expect(deps.createGraphLoopRun).toHaveBeenCalledWith(expect.objectContaining({
      loopVersionId: "loop_version_2",
      runGraphSnapshot: expect.objectContaining({ rootLoopVersionId: "loop_version_2" }),
      bindingSnapshot: expect.objectContaining({ activeVersionId: "loop_version_2", versionPolicy: "latest" }),
    }));
  });

  it("freezes the enabled project root and only its reachable task SubLoop", async () => {
    const deps = dependencies();

    await triggerProjectLoop({
      actorUserId: "user_1",
      projectId: "project_1",
      bindingId: "binding_1",
      commandId: "manual_snapshot_1",
      payload: { objective: "Run delivery" },
    }, deps);

    const input = deps.createGraphLoopRun.mock.calls[0]?.[0];
    const snapshot = input?.runGraphSnapshot as RunGraphSnapshot | undefined;
    expect(snapshot).toMatchObject({
      rootLoopVersionId: "loop_version_1",
      reachableNodeIds: expect.arrayContaining(["project_develop", "task_end"]),
    });
    expect(snapshot?.loopVersions.map(({ loopVersionId }) => loopVersionId))
      .toEqual(["loop_version_1", "task_version_1"]);
  });

  it("returns the original Run for a repeated manual commandId", async () => {
    const deps = dependencies();
    const input = {
      actorUserId: "user_1",
      projectId: "project_1",
      bindingId: "binding_1",
      commandId: "manual_1",
      payload: { objective: "Run delivery" },
    };

    const first = await triggerProjectLoop(input, deps);
    const repeated = await triggerProjectLoop(input, deps);

    expect(first).toEqual({ id: "loop_run_existing", engineKind: "graph_v1" });
    expect(repeated).toEqual(first);
    expect(deps.createGraphLoopRun).toHaveBeenNthCalledWith(2, expect.objectContaining({
      id: expect.any(String),
      sourceEventId: "manual_1",
      triggerType: "manual",
      actor: { type: "user", id: "user_1" },
      grantSnapshot: {
        automationGrantIds: ["grant_1"],
        grants: [grantSnapshot],
      },
    }));
  });

  it("authorizes the target Project before loading its binding", async () => {
    const deps = dependencies();
    const calls: string[] = [];
    deps.assertCanWriteProject.mockImplementation(async () => { calls.push("authorize"); });
    deps.readEnabledBinding.mockImplementation(async () => { calls.push("binding"); return binding; });

    await triggerProjectLoop({
      actorUserId: "user_1",
      projectId: "project_1",
      bindingId: "binding_1",
      commandId: "manual_2",
      payload: {},
    }, deps);

    expect(calls).toEqual(["authorize", "binding"]);
  });

  it("rejects disabled rollout and non-manual bindings without creating a Run", async () => {
    const disabled = dependencies();
    disabled.flags.graphV1 = false;
    await expect(triggerProjectLoop({
      actorUserId: "user_1",
      projectId: "project_1",
      bindingId: "binding_1",
      commandId: "manual_disabled",
      payload: {},
    }, disabled)).rejects.toMatchObject({ code: "policy_denied" });
    expect(disabled.createGraphLoopRun).not.toHaveBeenCalled();

    const automatedOnly = dependencies();
    automatedOnly.readEnabledBinding.mockResolvedValue({
      ...binding,
      triggerPolicy: { manual: false, taskEvents: ["task.completed"] },
    });
    await expect(triggerProjectLoop({
      actorUserId: "user_1",
      projectId: "project_1",
      bindingId: "binding_1",
      commandId: "manual_not_allowed",
      payload: {},
    }, automatedOnly)).rejects.toMatchObject({ code: "policy_denied" });
    expect(automatedOnly.createGraphLoopRun).not.toHaveBeenCalled();
  });

  it("starts a Project Run when graph-v1 is enabled regardless of the legacy allowlist", async () => {
    const deps = dependencies();

    await expect(triggerProjectLoop({
      actorUserId: "user_1",
      projectId: "project_1",
      bindingId: "binding_1",
      commandId: "manual_not_allowlisted",
      payload: {},
    }, deps)).resolves.toMatchObject({ id: expect.any(String) });

    expect(deps.readEnabledBinding).toHaveBeenCalledWith("binding_1", "project_1");
    expect(deps.createGraphLoopRun).toHaveBeenCalledOnce();
  });

  it("rejects starting a Task-scoped binding as a Project Run", async () => {
    const deps = dependencies();
    deps.readEnabledBinding.mockResolvedValue({
      ...binding,
      bindingRole: null,
      loopDefinition: { scope: "task" },
    });

    await expect(triggerProjectLoop({
      actorUserId: "user_1",
      projectId: "project_1",
      bindingId: "binding_1",
      commandId: "manual_task_scope",
      payload: {},
    }, deps)).rejects.toMatchObject({ code: "policy_denied" });

    expect(deps.createGraphLoopRun).not.toHaveBeenCalled();
  });
});

describe("triggerTaskLoop", () => {
  it("freezes a V2 run graph snapshot when the active task-development root is V2", async () => {
    const deps = {
      ...taskDependencies(),
      readPublishedVersions: vi.fn().mockResolvedValue([
        { loopDefinitionId: "loop_definition_1", loopVersionId: "loop_version_1", scope: "project" as const, graph: projectGraphV2 },
        { loopDefinitionId: "task_definition_1", loopVersionId: "task_version_1", scope: "task" as const, graph: taskGraphV2 },
      ]),
    };

    await triggerTaskLoop({
      actorUserId: "user_1",
      taskId: "task_1",
      commandId: "task_restart_v2",
      payload: {},
    }, deps);

    const input = deps.createGraphLoopRun.mock.calls[0]?.[0];
    const snapshot = input?.runGraphSnapshot as RunGraphSnapshotV2 | undefined;
    expect(snapshot).toMatchObject({
      schemaVersion: 2,
      rootLoopVersionId: "loop_version_1",
      snapshotId: expect.any(String),
    });
    expect(snapshot?.loopVersions.map(({ loopVersionId }) => loopVersionId))
      .toEqual(["loop_version_1", "task_version_1"]);
  });

  it("assigns the deterministic task branch and freezes task identity in the Run input", async () => {
    const deps = taskDependencies();

    await triggerTaskLoop({
      actorUserId: "user_1",
      taskId: "task_1",
      commandId: "task_start_with_identity",
      payload: {},
    }, deps);

    expect(deps.assignTaskBranch).toHaveBeenCalledWith(expect.objectContaining({
      actor: { type: "user", id: "user_1" },
      taskId: "task_1",
      expectedVersion: 3,
    }));
    expect(deps.assignTaskBranch.mock.calls[0]?.[0].commandId).toMatch(/^[a-f0-9]{32}$/u);
    expect(deps.createGraphLoopRun).toHaveBeenCalledWith(expect.objectContaining({
      inputSnapshot: {
        taskId: "task_1",
        projectId: "project_1",
        taskNumber: 100023,
        shortId: "HT100023",
        taskBranch: "2026-HT100023",
        taskCreatedAt: "2026-07-29T04:00:00.000Z",
        productionBranch: "main",
        stagingBranch: "staging",
      },
    }));
  });

  it("reuses the persisted task branch without assigning it again", async () => {
    const deps = taskDependencies();
    deps.readTask.mockResolvedValue({
      id: "task_1",
      projectId: "project_1",
      version: 4,
      createdAt: new Date("2026-07-29T04:00:00.000Z"),
      taskNumber: 100023,
      shortId: "HT100023",
      taskBranch: "2026-HT100023",
      productionBranch: "main",
      stagingBranch: "staging",
    });

    await triggerTaskLoop({
      actorUserId: "user_1",
      taskId: "task_1",
      commandId: "task_start_existing_branch",
      payload: {},
    }, deps);

    expect(deps.assignTaskBranch).not.toHaveBeenCalled();
    expect(deps.createGraphLoopRun).toHaveBeenCalledWith(expect.objectContaining({
      inputSnapshot: expect.objectContaining({ taskBranch: "2026-HT100023" }),
    }));
  });

  it("starts a Task Loop without a branch when the Project is not in branch-development mode", async () => {
    const deps = taskDependencies();
    deps.readTask.mockResolvedValue({
      id: "task_1",
      projectId: "project_1",
      version: 3,
      createdAt: new Date("2026-07-29T04:00:00.000Z"),
      taskNumber: 100023,
      shortId: "HT100023",
      taskBranch: null,
      developmentTemplateKey: null,
      developmentTemplateKind: null,
      productionBranch: "main",
      stagingBranch: "staging",
    });

    await triggerTaskLoop({
      actorUserId: "user_1",
      taskId: "task_1",
      commandId: "task_start_without_branch_mode",
      payload: {},
    }, deps);

    expect(deps.assignTaskBranch).not.toHaveBeenCalled();
    expect(deps.createGraphLoopRun).toHaveBeenCalledWith(expect.objectContaining({
      inputSnapshot: expect.objectContaining({ taskBranch: null }),
    }));
  });

  it("rejects a Task that does not have a platform task number", async () => {
    const deps = taskDependencies();
    deps.readTask.mockResolvedValue({
      id: "task_1",
      projectId: "project_1",
      version: 1,
      createdAt: new Date("2026-07-29T04:00:00.000Z"),
      taskNumber: null,
      shortId: null,
      taskBranch: null,
      productionBranch: "main",
      stagingBranch: "staging",
    });

    await expect(triggerTaskLoop({
      actorUserId: "user_1",
      taskId: "task_1",
      commandId: "task_start_without_number",
      payload: {},
    }, deps)).rejects.toMatchObject({ code: "validation_failed" });

    expect(deps.assignTaskBranch).not.toHaveBeenCalled();
    expect(deps.createGraphLoopRun).not.toHaveBeenCalled();
  });

  it("creates the Project task-development root Run and keeps repeated commandIds idempotent", async () => {
    const deps = taskDependencies();
    const input = {
      actorUserId: "user_1",
      taskId: "task_1",
      commandId: "task_start_1",
      payload: { objective: "Implement task" },
    };

    const first = await triggerTaskLoop(input, deps);
    const repeated = await triggerTaskLoop(input, deps);

    expect(repeated).toEqual(first);
    expect(deps.createGraphLoopRun).toHaveBeenNthCalledWith(2, expect.objectContaining({
      id: expect.any(String),
      triggerType: "task_event",
      sourceEventId: "task_start_1",
      projectId: "project_1",
      taskId: "task_1",
      correlationId: "task:task_1",
      actor: { type: "user", id: "user_1" },
      runGraphSnapshot: expect.objectContaining({ rootLoopVersionId: "loop_version_1" }),
    }));
  });

  it("freezes the explicitly selected Linux Worker Pool before creating the Task Run", async () => {
    const deps = taskDependencies();
    deps.readEnabledTaskBinding.mockResolvedValue({
      ...binding,
      project: {
        workerPoolId: "a".repeat(32),
        workerRepositoryUrl: "https://github.com/humanthread/disaster.git",
        workerBranchPolicy: { allowedBranches: ["*-HT-*"] },
      },
      workerStageConfigurations: {
        develop: { siteId: "b".repeat(32), model: "configured-model", reasoningEffort: "high" },
      },
    });
    deps.resolveExecutionTarget.mockResolvedValue({
      type: "linux_worker_pool",
      workerPoolId: "a".repeat(32),
      poolDisplayName: "ht-agent",
    });

    await triggerTaskLoop({
      actorUserId: "user_1",
      taskId: "task_1",
      commandId: "task_start_linux",
      payload: {},
      executionTarget: { type: "linux_worker_pool", workerPoolId: "a".repeat(32) },
    }, deps);

    expect(deps.resolveExecutionTarget).toHaveBeenCalledWith({
      projectId: "project_1",
      target: { type: "linux_worker_pool", workerPoolId: "a".repeat(32) },
    });
    expect(deps.createGraphLoopRun).toHaveBeenCalledWith(expect.objectContaining({
      executionSnapshot: expect.objectContaining({
        target: { type: "linux_worker_pool", workerPoolId: "a".repeat(32), poolDisplayName: "ht-agent" },
      }),
    }));
  });

  it("starts the explicitly selected configured Project Loop instead of the legacy default binding", async () => {
    const deps = taskDependencies();
    deps.readTask.mockResolvedValue({
      id: "task_1",
      projectId: "project_1",
      version: 3,
      createdAt: new Date("2026-07-29T04:00:00.000Z"),
      taskNumber: 100023,
      shortId: "HT100023",
      taskBranch: null,
      productionBranch: "main",
      stagingBranch: "staging",
      loopGroupConfig: {
        taskLoopVersionIds: [],
        defaultTaskLoopVersionId: "loop_version_2",
        projectLoopVersionIds: ["loop_version_2"],
        defaultProjectLoopVersionId: "loop_version_2",
        selectedPresetKeys: ["研发交付"],
        defaultPresetKey: "研发交付",
      },
    });
    deps.readEnabledTaskBinding.mockResolvedValue({
      ...binding,
      id: "binding_fast",
      activeVersionId: "loop_version_2",
      bindingRole: null,
      activeVersion: { ...binding.activeVersion, id: "loop_version_2" },
    });
    deps.readPublishedVersions.mockResolvedValue([
      { loopDefinitionId: "loop_definition_1", loopVersionId: "loop_version_2", scope: "project" as const, graph: projectGraph },
      ...publishedVersions,
    ]);

    await triggerTaskLoop({
      actorUserId: "user_1",
      taskId: "task_1",
      commandId: "task_start_selected_loop",
      bindingId: "binding_fast",
      payload: {},
    }, deps);

    expect(deps.readEnabledTaskBinding).toHaveBeenCalledWith("project_1", "binding_fast");
    expect(deps.createGraphLoopRun).toHaveBeenCalledWith(expect.objectContaining({
      bindingId: "binding_fast",
      loopVersionId: "loop_version_2",
      runGraphSnapshot: expect.objectContaining({ rootLoopVersionId: "loop_version_2" }),
    }));
  });

  it("rejects a selected Project Loop binding that is outside the saved Loop group", async () => {
    const deps = taskDependencies();
    deps.readTask.mockResolvedValue({
      id: "task_1",
      projectId: "project_1",
      version: 3,
      createdAt: new Date("2026-07-29T04:00:00.000Z"),
      taskNumber: 100023,
      shortId: "HT100023",
      taskBranch: null,
      productionBranch: "main",
      stagingBranch: "staging",
      loopGroupConfig: {
        taskLoopVersionIds: [],
        defaultTaskLoopVersionId: "loop_version_1",
        projectLoopVersionIds: ["loop_version_1"],
        defaultProjectLoopVersionId: "loop_version_1",
        selectedPresetKeys: ["研发交付"],
        defaultPresetKey: "研发交付",
      },
    });
    deps.readEnabledTaskBinding.mockResolvedValue({
      ...binding,
      id: "binding_outside_group",
      activeVersionId: "loop_version_2",
      bindingRole: null,
    });

    await expect(triggerTaskLoop({
      actorUserId: "user_1",
      taskId: "task_1",
      commandId: "task_start_outside_group",
      bindingId: "binding_outside_group",
      payload: {},
    }, deps)).rejects.toMatchObject({ code: "validation_failed" });

    expect(deps.createGraphLoopRun).not.toHaveBeenCalled();
  });

  it("rejects the milestone release binding as a Task execution root", async () => {
    const deps = taskDependencies();
    deps.readEnabledTaskBinding.mockResolvedValue({
      ...binding,
      bindingRole: "milestone_release",
    });

    await expect(triggerTaskLoop({
      actorUserId: "user_1",
      taskId: "task_1",
      commandId: "task_start_milestone_binding",
      bindingId: "binding_1",
      payload: {},
    }, deps)).rejects.toMatchObject({ code: "validation_failed" });

    expect(deps.createGraphLoopRun).not.toHaveBeenCalled();
  });

  it("rejects a direct Task-scoped binding because Task execution must start from the Project root", async () => {
    const deps = taskDependencies();
    deps.readEnabledTaskBinding.mockResolvedValue({
      ...binding,
      bindingRole: null,
      loopDefinition: { scope: "task" },
    });

    await expect(triggerTaskLoop({
      actorUserId: "user_1",
      taskId: "task_1",
      commandId: "task_start_gelsang",
      payload: {},
    }, deps)).rejects.toMatchObject({ code: "validation_failed" });

    expect(deps.createGraphLoopRun).not.toHaveBeenCalled();
  });

  it("authorizes the Task before reading project and binding state", async () => {
    const deps = taskDependencies();
    const denied = Object.assign(new Error("Task dispatch access denied"), { code: "authorization_denied" });
    deps.assertCanDispatchTask.mockRejectedValue(denied);

    await expect(triggerTaskLoop({
      actorUserId: "user_other",
      taskId: "task_1",
      commandId: "task_start_denied",
      payload: {},
    }, deps)).rejects.toBe(denied);

    expect(deps.readTask).not.toHaveBeenCalled();
    expect(deps.readEnabledTaskBinding).not.toHaveBeenCalled();
    expect(deps.createGraphLoopRun).not.toHaveBeenCalled();
  });

  it("rejects Tasks without a Project", async () => {
    const deps = taskDependencies();
    deps.readTask.mockResolvedValue({ id: "task_1", projectId: null });

    await expect(triggerTaskLoop({
      actorUserId: "user_1",
      taskId: "task_1",
      commandId: "task_start_no_project",
      payload: {},
    }, deps)).rejects.toMatchObject({ code: "not_found" });

    expect(deps.readEnabledTaskBinding).not.toHaveBeenCalled();
    expect(deps.createGraphLoopRun).not.toHaveBeenCalled();
  });

  it("rejects Tasks whose Project has no task-development binding", async () => {
    const deps = taskDependencies();
    deps.readEnabledTaskBinding.mockResolvedValue(null);

    await expect(triggerTaskLoop({
      actorUserId: "user_1",
      taskId: "task_1",
      commandId: "task_start_no_binding",
      payload: {},
    }, deps)).rejects.toMatchObject({ code: "not_found" });

    expect(deps.createGraphLoopRun).not.toHaveBeenCalled();
  });
});
