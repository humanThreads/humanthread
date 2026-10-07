import { describe, expect, it, vi } from "vitest";
import {
  resolveRunGraphSnapshot,
  resolveRunGraphSnapshotV2,
  resolveScheduledPublishedRunGraphSnapshot,
} from "@humanthread/orchestration-core";
import { executePlatformNode } from "./platform-node-executors";
import { handleChildLoopTerminalEvent, invokeTaskScopedChildLoop } from "./task-loop-invocation";

const taskBinding = {
  id: "task_binding_1",
  projectId: "project_1",
  loopDefinitionId: "task_definition_1",
  bindingRole: "task_execution",
  activeVersionId: "task_version_1",
  status: "enabled",
  version: 4,
  createdByUserId: "user_owner",
  triggerPolicy: { manual: true, taskEvents: [], milestoneEvents: [] },
  parameterOverrides: {},
  notificationPolicy: {},
  automationGrantIds: [],
  allowedAgentProfileIds: ["profile_codex"],
  allowedProviders: ["codex"],
  activeVersion: {
    id: "task_version_1",
    status: "published",
    maxStages: 8,
    maxRepeatCount: 2,
    platformMaxTransitions: 16,
  },
  loopDefinition: { scope: "task" },
};

const parentSnapshot = resolveRunGraphSnapshot({
  rootLoopVersionId: "project_version_1",
  versions: [
    {
      loopDefinitionId: "project_definition_1",
      loopVersionId: "project_version_1",
      scope: "project",
      graph: {
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
      },
    },
    {
      loopDefinitionId: "task_definition_1",
      loopVersionId: "task_version_1",
      scope: "task",
      graph: {
        schemaVersion: 1,
        inputSchema: { type: "object" },
        outputSchema: { type: "object" },
        limits: { maxStages: 2, maxRepeatCount: 1 },
        nodes: [
          { key: "start", nodeId: "task_start", label: "Start", type: "start" },
          { key: "end", nodeId: "task_end", label: "End", type: "end" },
        ],
        edges: [{ id: "start-end", source: "start", target: "end", kind: "normal", outcome: "success" }],
      },
    },
  ],
});

function dependencies() {
  return {
    now: () => new Date("2026-08-01T01:00:00.000Z"),
    loadTask: vi.fn().mockResolvedValue({ id: "task_1", projectId: "project_1" }),
    loadParentRun: vi.fn().mockResolvedValue({
      id: "parent_run_1",
      projectId: "project_1",
      taskId: "task_1",
      runGraphSnapshot: null,
    }),
    loadPinnedLoopVersion: vi.fn().mockResolvedValue({
      id: "task_version_1",
      loopDefinitionId: "task_definition_1",
      status: "published",
      maxStages: 2,
      maxRepeatCount: 1,
      platformMaxTransitions: 4,
    }),
    listEnabledTaskBindings: vi.fn().mockResolvedValue([taskBinding]),
    snapshotBindingGrants: vi.fn().mockResolvedValue([]),
    createGraphLoopRun: vi.fn().mockResolvedValue({ id: "child_run_1", engineKind: "graph_v1" }),
  };
}

describe("invokeTaskScopedChildLoop", () => {
  it("invokes a scheduled-task root SubLoop without a Task and preserves the run reference", async () => {
    const deps = dependencies();
    const scheduledRootSnapshot = resolveScheduledPublishedRunGraphSnapshot({
      rootLoopVersionId: "task_root_v1",
      versions: [
        {
          loopDefinitionId: "task_root_definition",
          loopVersionId: "task_root_v1",
          scope: "task",
          graph: {
            schemaVersion: 1,
            inputSchema: { type: "object" },
            outputSchema: { type: "object" },
            limits: { maxStages: 3, maxRepeatCount: 2 },
            nodes: [
              { key: "start", label: "Start", type: "start" },
              {
                key: "develop",
                label: "Develop",
                type: "subloop_call",
                executionTarget: "platform",
                targetLoopDefinitionId: "task_definition_1",
                targetLoopVersionId: "task_version_1",
                inputMapping: {},
                terminalOutcomeMapping: { success: "success", failure: "failure" },
              },
              { key: "end", label: "End", type: "end" },
            ],
            edges: [
              { id: "start-develop", source: "start", target: "develop", kind: "normal", outcome: "success" },
              { id: "develop-end", source: "develop", target: "end", kind: "normal", outcome: "success" },
            ],
          },
        },
        {
          loopDefinitionId: "task_definition_1",
          loopVersionId: "task_version_1",
          scope: "task",
          graph: {
            schemaVersion: 1,
            inputSchema: { type: "object" },
            outputSchema: { type: "object" },
            limits: { maxStages: 2, maxRepeatCount: 1 },
            nodes: [
              { key: "start", label: "Start", type: "start" },
              { key: "end", label: "End", type: "end" },
            ],
            edges: [{ id: "start-end", source: "start", target: "end", kind: "normal", outcome: "success" }],
          },
        },
      ],
    });
    deps.loadParentRun.mockResolvedValue({
      id: "parent_run_1",
      projectId: "project_1",
      taskId: null,
      scheduledTaskRunId: "a".repeat(32),
      runGraphSnapshot: scheduledRootSnapshot,
    });

    await invokeTaskScopedChildLoop({
      projectId: "project_1",
      parent: { loopRunId: "parent_run_1", nodeRunId: "parent_node_1", attemptId: "parent_attempt_1" },
      targetLoopDefinitionId: "task_definition_1",
      targetLoopVersionId: "task_version_1",
      inputSnapshot: { request: "run" },
      correlationId: "loop:parent_run_1",
      actorUserId: "user_owner",
    }, deps);

    expect(deps.createGraphLoopRun).toHaveBeenCalledWith(expect.objectContaining({
      parent: { loopRunId: "parent_run_1", nodeRunId: "parent_node_1", attemptId: "parent_attempt_1" },
      inputSnapshot: { request: "run", scheduledTaskRunId: "a".repeat(32) },
      loopVersionId: "task_version_1",
    }));
    const call = deps.createGraphLoopRun.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(call).not.toHaveProperty("taskId");
    expect(call).not.toHaveProperty("scheduledTaskRunId");
  });

  it("accepts a v2 parent snapshot when invoking a task child Loop", async () => {
    const deps = dependencies();
    const v2ParentSnapshot = resolveRunGraphSnapshotV2({
      rootLoopVersionId: "project_version_v2",
      versions: [
        {
          loopDefinitionId: "project_definition_v2",
          loopVersionId: "project_version_v2",
          scope: "project",
          graph: {
            schemaVersion: 2,
            inputSchema: { type: "object" },
            outputSchema: { type: "object" },
            limits: { maxStages: 3, maxRepeatCount: 2 },
            routingMetadata: {
              project_develop: { responsibility: "Run the task Loop." },
            },
            nodes: [
              { key: "start", nodeId: "project_start_v2", label: "Start", type: "start" },
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
              { key: "end", nodeId: "project_end_v2", label: "End", type: "end" },
            ],
            edges: [
              { id: "start-develop-v2", source: "start", target: "develop", kind: "normal", outcome: "success" },
              { id: "develop-end-v2", source: "develop", target: "end", kind: "normal", outcome: "success" },
            ],
          },
        },
        {
          loopDefinitionId: "task_definition_1",
          loopVersionId: "task_version_1",
          scope: "task",
          graph: {
            schemaVersion: 2,
            inputSchema: { type: "object" },
            outputSchema: { type: "object" },
            limits: { maxStages: 3, maxRepeatCount: 1 },
            routingMetadata: {
              task_agent_v2: { responsibility: "Complete the task." },
            },
            nodes: [
              { key: "start", nodeId: "task_start_v2", label: "Start", type: "start" },
              { key: "task_agent", nodeId: "task_agent_v2", label: "Agent", type: "agent_action", executionTarget: "either", promptTemplate: "Complete the task.", reasoningEffort: "high" },
              { key: "end", nodeId: "task_end_v2", label: "End", type: "end" },
            ],
            edges: [
              { id: "task-start-agent-v2", source: "start", target: "task_agent", kind: "normal", outcome: "success" },
              { id: "task-agent-end-v2", source: "task_agent", target: "end", kind: "normal", outcome: "success" },
            ],
          },
        },
      ],
    });
    deps.loadParentRun.mockResolvedValue({
      id: "parent_run_1",
      projectId: "project_1",
      taskId: "task_1",
      runGraphSnapshot: v2ParentSnapshot,
    });

    await expect(invokeTaskScopedChildLoop({
      projectId: "project_1",
      taskId: "task_1",
      parent: { loopRunId: "parent_run_1", nodeRunId: "parent_node_1", attemptId: "parent_attempt_1" },
      targetLoopDefinitionId: "task_definition_1",
      targetLoopVersionId: "task_version_1",
      inputSnapshot: {},
      correlationId: "loop:parent_run_1",
      actorUserId: "user_owner",
    }, deps)).resolves.toEqual({ childLoopRunId: "child_run_1" });
    expect(deps.createGraphLoopRun).toHaveBeenCalledWith(expect.objectContaining({
      runGraphSnapshot: v2ParentSnapshot,
    }));
  });

  it("composes Develop invocation, child waiting, and terminal parent resumption", async () => {
    const childDependencies = dependencies();
    childDependencies.loadParentRun.mockResolvedValue({
      id: "parent_run_1",
      projectId: "project_1",
      taskId: "task_1",
      runGraphSnapshot: parentSnapshot,
    });
    const resumeParentAfterChildLoop = vi.fn().mockResolvedValue({ resumed: true, duplicate: false });
    const platformDependencies = {
      assertCanWriteProject: vi.fn(),
      loadDocumentTarget: vi.fn(),
      updateDocumentIdempotently: vi.fn(),
      invokeTaskScopedChildLoop: (input: Parameters<typeof invokeTaskScopedChildLoop>[0]) =>
        invokeTaskScopedChildLoop(input, childDependencies),
    };

    const waiting = await executePlatformNode({
      node: {
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
      input: {
        branch: "2026-HT100012",
        documents: ["需求文档/HT100012.md"],
        testReports: ["测试报告/HT100012.md"],
      },
      projectId: "project_1",
      taskId: "task_1",
      loopRunId: "parent_run_1",
      nodeRunId: "parent_node_1",
      attemptId: "parent_attempt_1",
      actorUserId: "user_owner",
      correlationId: "loop:parent_run_1",
      now: new Date("2026-08-01T01:00:00.000Z"),
    }, platformDependencies);

    expect(waiting).toEqual({
      status: "waiting",
      waitingReason: "child_loop",
      childLoopRunId: "child_run_1",
    });
    expect(childDependencies.createGraphLoopRun).toHaveBeenCalledWith(expect.objectContaining({
      taskId: "task_1",
      parent: {
        loopRunId: "parent_run_1",
        nodeRunId: "parent_node_1",
        attemptId: "parent_attempt_1",
      },
      inputSnapshot: expect.objectContaining({
        branch: "2026-HT100012",
        documents: ["需求文档/HT100012.md"],
        testReports: ["测试报告/HT100012.md"],
      }),
      loopVersionId: "task_version_1",
      runGraphSnapshot: parentSnapshot,
    }));

    await expect(handleChildLoopTerminalEvent({
      eventType: "loop.node.completed",
      occurredAt: "2026-08-01T02:00:00.000Z",
      correlationId: "loop:child_run_1",
      payload: { loopRunId: "child_run_1" },
    }, { resumeParentAfterChildLoop })).resolves.toEqual({ resumed: true, duplicate: false });
    expect(resumeParentAfterChildLoop).toHaveBeenCalledWith(expect.objectContaining({
      childLoopRunId: "child_run_1",
      correlationId: "loop:child_run_1",
    }));
  });

  it("creates one task-scoped child Run with the complete parent identity", async () => {
    const deps = dependencies();

    await expect(invokeTaskScopedChildLoop({
      projectId: "project_1",
      taskId: "task_1",
      parent: {
        loopRunId: "parent_run_1",
        nodeRunId: "parent_node_1",
        attemptId: "parent_attempt_1",
      },
      inputSnapshot: { branch: "2026-HT100012" },
      correlationId: "loop:parent_run_1",
      actorUserId: "user_owner",
    }, deps)).resolves.toEqual({ childLoopRunId: "child_run_1" });

    expect(deps.createGraphLoopRun).toHaveBeenCalledWith(expect.objectContaining({
      bindingId: "task_binding_1",
      triggerType: "child_loop",
      sourceEventId: "parent_node_1",
      projectId: "project_1",
      taskId: "task_1",
      parent: {
        loopRunId: "parent_run_1",
        nodeRunId: "parent_node_1",
        attemptId: "parent_attempt_1",
      },
    }));
  });

  it("creates a child from the version pinned in the parent snapshot after the binding is upgraded", async () => {
    const deps = dependencies();
    deps.loadParentRun.mockResolvedValue({
      id: "parent_run_1",
      projectId: "project_1",
      taskId: "task_1",
      runGraphSnapshot: parentSnapshot,
    });
    deps.listEnabledTaskBindings.mockResolvedValue([{
      ...taskBinding,
      activeVersionId: "task_version_2",
      activeVersion: { ...taskBinding.activeVersion, id: "task_version_2" },
    }]);

    await invokeTaskScopedChildLoop({
      projectId: "project_1",
      taskId: "task_1",
      parent: { loopRunId: "parent_run_1", nodeRunId: "parent_node_1", attemptId: "parent_attempt_1" },
      targetLoopDefinitionId: "task_definition_1",
      targetLoopVersionId: "task_version_1",
      inputSnapshot: { branch: "2026-HT100012" },
      correlationId: "loop:parent_run_1",
      actorUserId: "user_owner",
    } as never, deps);

    expect(deps.createGraphLoopRun).toHaveBeenCalledWith(expect.objectContaining({
      loopVersionId: "task_version_1",
      runGraphSnapshot: parentSnapshot,
      bindingSnapshot: expect.objectContaining({ activeVersionId: "task_version_1" }),
    }));
  });

  it("rejects a child target that is not in the parent snapshot", async () => {
    const deps = dependencies();
    deps.loadParentRun.mockResolvedValue({
      id: "parent_run_1",
      projectId: "project_1",
      taskId: "task_1",
      runGraphSnapshot: parentSnapshot,
    });

    await expect(invokeTaskScopedChildLoop({
      projectId: "project_1",
      taskId: "task_1",
      parent: { loopRunId: "parent_run_1", nodeRunId: "parent_node_1", attemptId: "parent_attempt_1" },
      targetLoopDefinitionId: "task_definition_b",
      targetLoopVersionId: "task_version_b",
      inputSnapshot: {},
      correlationId: "loop:parent_run_1",
      actorUserId: "user_owner",
    } as never, deps)).rejects.toMatchObject({ code: "validation_failed" });

    expect(deps.createGraphLoopRun).not.toHaveBeenCalled();
  });

  it("ignores project/task-development bindings and requires a task binding", async () => {
    const deps = dependencies();
    deps.loadParentRun.mockResolvedValue({
      id: "run_1",
      projectId: "project_1",
      taskId: "task_1",
      runGraphSnapshot: null,
    });
    deps.listEnabledTaskBindings.mockResolvedValue([{
      ...taskBinding,
      bindingRole: "task_development",
      loopDefinition: { scope: "project" },
    }]);

    await expect(invokeTaskScopedChildLoop({
      projectId: "project_1",
      taskId: "task_1",
      parent: { loopRunId: "run_1", nodeRunId: "node_1", attemptId: "attempt_1" },
      inputSnapshot: {},
      correlationId: "loop:run_1",
      actorUserId: "user_owner",
    }, deps)).rejects.toMatchObject({
      code: "configuration_required",
      message: "Task-scoped Loop binding is not configured",
    });
    expect(deps.createGraphLoopRun).not.toHaveBeenCalled();
  });

  it("routes only child Loop node completion events to parent resumption", async () => {
    const resumeParentAfterChildLoop = vi.fn().mockResolvedValue({ resumed: true, duplicate: false });
    const deps = { resumeParentAfterChildLoop };
    await expect(handleChildLoopTerminalEvent({
      eventType: "loop.node.completed",
      occurredAt: "2026-08-01T01:00:00.000Z",
      correlationId: "loop:child_run_1",
      payload: { loopRunId: "child_run_1" },
    }, deps)).resolves.toEqual({ resumed: true, duplicate: false });
    expect(resumeParentAfterChildLoop).toHaveBeenCalledWith(expect.objectContaining({
      childLoopRunId: "child_run_1",
    }));

    await expect(handleChildLoopTerminalEvent({
      eventType: "task.completed",
      occurredAt: "2026-08-01T01:00:00.000Z",
      correlationId: "task:task_1",
      payload: { loopRunId: "child_run_1" },
    }, deps)).resolves.toEqual({ resumed: false, duplicate: false });
    expect(resumeParentAfterChildLoop).toHaveBeenCalledOnce();
  });
});
