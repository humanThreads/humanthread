import { describe, expect, it, vi } from "vitest";
import { handleTaskEventForLoopBindings } from "./loop-task-trigger";
import { TASK_DEVELOPMENT_GRAPH_V3 } from "../../../prisma/development-mode-seed-data.mjs";

const publishedVersions = [
  {
    loopDefinitionId: "loop_definition_1",
    loopVersionId: "loop_version_1",
    scope: "project" as const,
    graph: {
      schemaVersion: 1 as const,
      inputSchema: { type: "object" },
      outputSchema: { type: "object" },
      limits: { maxStages: 3, maxRepeatCount: 2 },
      nodes: [
        { key: "start", nodeId: "project_start", label: "Start", type: "start" as const },
        {
          key: "develop",
          nodeId: "project_develop",
          label: "Develop",
          type: "subloop_call" as const,
          executionTarget: "platform" as const,
          targetLoopDefinitionId: "task_definition_1",
          targetLoopVersionId: "task_version_1",
          inputMapping: {},
          terminalOutcomeMapping: { success: "success" as const, failure: "failure" as const },
        },
        { key: "end", nodeId: "project_end", label: "End", type: "end" as const },
      ],
      edges: [
        { id: "start-develop", source: "start", target: "develop", kind: "normal" as const, outcome: "success" as const },
        { id: "develop-end", source: "develop", target: "end", kind: "normal" as const, outcome: "success" as const },
      ],
    },
  },
  {
    loopDefinitionId: "task_definition_1",
    loopVersionId: "task_version_1",
    scope: "task" as const,
    graph: {
      schemaVersion: 1 as const,
      inputSchema: { type: "object" },
      outputSchema: { type: "object" },
      limits: { maxStages: 2, maxRepeatCount: 1 },
      nodes: [
        { key: "start", nodeId: "task_start", label: "Start", type: "start" as const },
        { key: "end", nodeId: "task_end", label: "End", type: "end" as const },
      ],
      edges: [{ id: "start-end", source: "start", target: "end", kind: "normal" as const, outcome: "success" as const }],
    },
  },
];

const event = {
  id: "event_task_completed_1",
  eventType: "task.completed",
  aggregateType: "task",
  aggregateId: "task_1",
  correlationId: "task:task_1",
  causationId: "command_complete_1",
  occurredAt: "2026-07-30T04:10:00.000Z",
  payload: { status: "completed" },
};

const binding = {
  id: "binding_1",
  projectId: "project_1",
  loopDefinitionId: "loop_definition_1",
  activeVersionId: "loop_version_1",
  status: "enabled",
  version: 1,
  createdByUserId: "user_owner",
  triggerPolicy: { manual: false, taskEvents: ["task.completed"] },
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
    now: () => new Date("2026-07-30T04:11:00.000Z"),
    loadTask: vi.fn().mockResolvedValue({ id: "task_1", projectId: "project_1" }),
    listEnabledBindings: vi.fn().mockResolvedValue([binding]),
    readPublishedVersions: vi.fn().mockResolvedValue(publishedVersions),
    snapshotBindingGrants: vi.fn().mockResolvedValue([grantSnapshot]),
    createGraphLoopRun: vi.fn().mockResolvedValue({ id: "loop_run_1", engineKind: "graph_v1" }),
  };
}

describe("handleTaskEventForLoopBindings", () => {
  it("creates one version-pinned Run per matching binding", async () => {
    const deps = dependencies();

    await expect(handleTaskEventForLoopBindings(event, deps)).resolves.toEqual({ matched: 1, triggered: 1 });

    expect(deps.createGraphLoopRun).toHaveBeenCalledWith(expect.objectContaining({
      bindingId: "binding_1",
      loopVersionId: "loop_version_1",
      triggerType: "task_event",
      sourceEventId: "event_task_completed_1",
      taskId: "task_1",
      correlationId: "task:task_1",
      causationId: "command_complete_1",
      actor: { type: "system", id: "loop-task-trigger" },
      grantSnapshot: {
        automationGrantIds: ["grant_1"],
        grants: [grantSnapshot],
      },
      bindingSnapshot: expect.objectContaining({
        allowedAgentProfileIds: ["profile_codex"],
        allowedProviders: ["codex"],
        createdByUserId: "user_owner",
      }),
      runGraphSnapshot: expect.objectContaining({
        rootLoopVersionId: "loop_version_1",
        loopVersions: expect.arrayContaining([
          expect.objectContaining({ loopVersionId: "task_version_1", scope: "task" }),
        ]),
      }),
    }));
  });

  it("pins the task SubLoop referenced by the branch-development Develop node", async () => {
    const deps = dependencies();
    const taskLoop = publishedVersions[1]!;
    deps.readPublishedVersions.mockResolvedValue([
      {
        ...publishedVersions[0]!,
        loopDefinitionId: "loop_definition_branch_task_v2",
        loopVersionId: "loop_version_branch_task_v3",
        graph: TASK_DEVELOPMENT_GRAPH_V3,
      },
      {
        ...taskLoop,
        loopDefinitionId: "loop_definition_gelsang_project_v1",
        loopVersionId: "loop_version_gelsang_project_v1",
      },
    ]);
    deps.listEnabledBindings.mockResolvedValue([{
      ...binding,
      loopDefinitionId: "loop_definition_branch_task_v2",
      activeVersionId: "loop_version_branch_task_v3",
      activeVersion: { ...binding.activeVersion, id: "loop_version_branch_task_v3" },
    }]);

    await handleTaskEventForLoopBindings(event, deps);

    expect(deps.createGraphLoopRun).toHaveBeenCalledWith(expect.objectContaining({
      runGraphSnapshot: expect.objectContaining({
        rootLoopVersionId: "loop_version_branch_task_v3",
        loopVersions: expect.arrayContaining([
          expect.objectContaining({ loopVersionId: "loop_version_branch_task_v3", scope: "project" }),
          expect.objectContaining({ loopVersionId: "loop_version_gelsang_project_v1", scope: "task" }),
        ]),
      }),
    }));
  });

  it("asks the milestone readiness projector to emit one release-ready event after Task completion", async () => {
    const deps = dependencies();
    deps.loadTask.mockResolvedValue({ id: "task_1", projectId: "project_1", milestoneId: "milestone_1" });
    const emitMilestoneReleaseReady = vi.fn().mockResolvedValue(true);
    Object.assign(deps, { emitMilestoneReleaseReady });

    await handleTaskEventForLoopBindings(event, deps as never);

    expect(emitMilestoneReleaseReady).toHaveBeenCalledWith({
      projectId: "project_1",
      milestoneId: "milestone_1",
      taskEventId: "event_task_completed_1",
      correlationId: "task:task_1",
      causationId: "command_complete_1",
      occurredAt: new Date("2026-07-30T04:10:00.000Z"),
    });
  });

  it("acknowledges unmatched, disabled-rollout, and non-Task events without creating Runs", async () => {
    const unmatched = dependencies();
    unmatched.listEnabledBindings.mockResolvedValue([{ ...binding, triggerPolicy: { manual: false, taskEvents: ["task.started"] } }]);
    await expect(handleTaskEventForLoopBindings(event, unmatched)).resolves.toEqual({ matched: 0, triggered: 0 });
    expect(unmatched.createGraphLoopRun).not.toHaveBeenCalled();

    const disabled = dependencies();
    disabled.flags.graphV1 = false;
    await expect(handleTaskEventForLoopBindings(event, disabled)).resolves.toEqual({ matched: 0, triggered: 0 });
    expect(disabled.createGraphLoopRun).not.toHaveBeenCalled();

    const bindingEvent = dependencies();
    await expect(handleTaskEventForLoopBindings({
      ...event,
      aggregateType: "loop_binding",
      eventType: "loop.binding.upserted",
    }, bindingEvent)).resolves.toEqual({ matched: 0, triggered: 0 });
    expect(bindingEvent.loadTask).not.toHaveBeenCalled();
  });

  it("creates Runs for Projects outside the legacy rollout allowlist", async () => {
    const deps = dependencies();

    await expect(handleTaskEventForLoopBindings(event, deps)).resolves.toEqual({ matched: 1, triggered: 1 });

    expect(deps.listEnabledBindings).toHaveBeenCalledWith("project_1");
    expect(deps.createGraphLoopRun).toHaveBeenCalledOnce();
  });

  it("rejects a binding returned from another Project", async () => {
    const deps = dependencies();
    deps.listEnabledBindings.mockResolvedValue([{ ...binding, projectId: "project_2" }]);

    await expect(handleTaskEventForLoopBindings(event, deps)).rejects.toMatchObject({
      code: "validation_failed",
    });

    expect(deps.createGraphLoopRun).not.toHaveBeenCalled();
  });

  it("rejects malformed Task event envelopes before loading a Task", async () => {
    const deps = dependencies();

    await expect(handleTaskEventForLoopBindings({
      ...event,
      id: 42,
    } as never, deps)).rejects.toMatchObject({ code: "validation_failed" });

    expect(deps.loadTask).not.toHaveBeenCalled();
  });

  it("triggers only the project task-development binding, never a task-scoped child binding", async () => {
    const deps = dependencies();
    deps.listEnabledBindings.mockResolvedValue([
      { ...binding, id: "task_binding", bindingRole: "task_execution", loopDefinition: { scope: "task" } },
      binding,
    ]);

    await expect(handleTaskEventForLoopBindings(event, deps)).resolves.toEqual({ matched: 1, triggered: 1 });
    expect(deps.createGraphLoopRun).toHaveBeenCalledOnce();
    expect(deps.createGraphLoopRun).toHaveBeenCalledWith(expect.objectContaining({ bindingId: "binding_1" }));
  });
});
