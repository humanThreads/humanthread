import { describe, expect, it, vi } from "vitest";
import {
  readLoopEventsAfterCursor,
  readLoopRunProjection,
} from "./loop-read-model";

const graph = {
  schemaVersion: 1 as const,
  inputSchema: {},
  outputSchema: {},
  limits: { maxStages: 3, maxRepeatCount: 2 },
  nodes: [
    { key: "start", label: "Start", type: "start" as const },
    { key: "write", label: "Write", type: "platform_action" as const, executionTarget: "platform" as const, action: "project_document.write" },
    { key: "end", label: "End", type: "end" as const },
  ],
  edges: [
    { id: "edge_start_write", source: "start", target: "write", kind: "normal" as const, outcome: "success" as const },
    { id: "edge_write_end", source: "write", target: "end", kind: "normal" as const, outcome: "success" as const },
  ],
};

const run = {
  id: "loop_run_1",
  projectId: "project_1",
  taskId: "task_1",
  status: "running",
  statusReason: null,
  repeatCount: 0,
  transitionCount: 1,
  stopReason: null,
  projectionVersion: 4,
  usageAggregate: { transitions: 1, repeats: 0, edgeTraversals: { edge_start_write: 1 } },
  loopVersion: { versionNumber: 2, graph },
  nodeRuns: [
    {
      id: "node_start_1",
      nodeKey: "start",
      activationNo: 1,
      status: "succeeded",
      waitingReason: null,
      attemptCount: 1,
      attempts: [{
        id: "loop_attempt_start_1",
        attempt: 1,
        status: "succeeded",
        executorType: "platform",
        startedAt: new Date("2026-07-30T06:00:00.000Z"),
        finishedAt: new Date("2026-07-30T06:00:30.000Z"),
        result: { ok: true },
        error: null,
      }],
    },
    {
      id: "node_write_1",
      nodeKey: "write",
      activationNo: 1,
      status: "running",
      waitingReason: null,
      attemptCount: 1,
      attempts: [{
        id: "loop_attempt_write_1",
        attempt: 1,
        status: "running",
        executorType: "platform",
        startedAt: new Date("2026-07-30T06:01:00.000Z"),
        finishedAt: null,
        result: null,
        error: null,
      }],
    },
  ],
  effects: [],
};

const events = [
  {
    id: "event_1",
    eventType: "loop.run.created",
    aggregateType: "run",
    aggregateId: "loop_run_1",
    sequence: 1,
    occurredAt: new Date("2026-07-30T06:00:00.000Z"),
    payload: {},
  },
  {
    id: "event_2",
    eventType: "loop.node.completed",
    aggregateType: "loop_node",
    aggregateId: "node_start_1",
    sequence: 3,
    occurredAt: new Date("2026-07-30T06:01:00.000Z"),
    payload: { transition: { status: "routed", edge: { id: "edge_start_write" } } },
  },
];

function dependencies() {
  return {
    assertCanReadProject: vi.fn().mockResolvedValue({ projectId: "project_1", role: "viewer" }),
    loadRun: vi.fn().mockResolvedValue(run),
    loadEventCount: vi.fn().mockImplementation(() => Promise.resolve(events.length)),
    loadEvents: vi.fn().mockResolvedValue(events),
    loadVisibleEvents: vi.fn().mockResolvedValue(events),
  };
}

describe("Loop run read model", () => {
  it("normalizes an encoded route id before loading the persisted LoopRun", async () => {
    const deps = dependencies();

    await readLoopRunProjection({
      userId: "user_1",
      loopRunId: "loop_run%3A8bea8fbd",
    }, deps);

    expect(deps.loadRun).toHaveBeenCalledWith("loop_run:8bea8fbd");
  });

  it("projects the immutable graph and current persisted node state", async () => {
    const deps = dependencies();

    await expect(readLoopRunProjection({
      userId: "user_1",
      loopRunId: "loop_run_1",
    }, deps)).resolves.toEqual({
      definitionVersion: 2,
      projectionVersion: 4,
      eventCursor: 2,
      run: {
        id: "loop_run_1",
        taskId: "task_1",
        status: "running",
        statusReason: null,
        repeatCount: 0,
        transitionCount: 1,
        stopReason: null,
      },
      pendingApprovals: [],
      nodes: [
        { nodeKey: "start", label: "Start", type: "start", status: "succeeded", currentNodeRunId: "node_start_1", attemptNo: 1, waitingReason: null, attempts: [{ attemptId: "loop_attempt_start_1", attempt: 1, status: "succeeded", executorType: "platform", startedAt: "2026-07-30T06:00:00.000Z", finishedAt: "2026-07-30T06:00:30.000Z", result: { ok: true }, error: null, executionPhase: null }] },
        { nodeKey: "write", label: "Write", type: "platform_action", status: "running", currentNodeRunId: "node_write_1", attemptNo: 1, waitingReason: null, attempts: [{ attemptId: "loop_attempt_write_1", attempt: 1, status: "running", executorType: "platform", startedAt: "2026-07-30T06:01:00.000Z", finishedAt: null, result: null, error: null, executionPhase: null }] },
        { nodeKey: "end", label: "End", type: "end", status: "pending", currentNodeRunId: null, attemptNo: 0, waitingReason: null, attempts: [] },
      ],
      edges: [
        { edgeId: "edge_start_write", source: "start", target: "write", kind: "normal", outcome: "success", traversalCount: 1, limit: null, lastTraversalAt: "2026-07-30T06:01:00.000Z" },
        { edgeId: "edge_write_end", source: "write", target: "end", kind: "normal", outcome: "success", traversalCount: 0, limit: null, lastTraversalAt: null },
      ],
      activities: [
        { id: "event_1", cursor: 1, eventType: "loop.run.created", occurredAt: "2026-07-30T06:00:00.000Z", nodeKey: null, edgeId: null, summary: "Loop 运行已创建" },
        { id: "event_2", cursor: 2, eventType: "loop.node.completed", occurredAt: "2026-07-30T06:01:00.000Z", nodeKey: "start", edgeId: "edge_start_write", summary: "Start 已完成，流转至 Write" },
      ],
    });

    expect(deps.assertCanReadProject).toHaveBeenCalledWith({ userId: "user_1", projectId: "project_1" });
  });

  it("keeps a terminal status reason in the authorized workspace projection", async () => {
    const deps = dependencies();
    deps.loadRun.mockResolvedValue({
      ...run,
      status: "failed",
      statusReason: "runtime_safety_expired",
    });

    await expect(readLoopRunProjection({ userId: "user_1", loopRunId: "loop_run_1" }, deps))
      .resolves.toMatchObject({
        run: {
          taskId: "task_1",
          status: "failed",
          statusReason: "runtime_safety_expired",
        },
      });
  });

  it("projects the Linux Worker instance instead of calling the attempt local", async () => {
    const deps = dependencies();
    deps.loadRun.mockResolvedValue({
      ...run,
      nodeRuns: [{
        ...run.nodeRuns[1],
        selectedExecutionTarget: "linux_worker_pool",
        attempts: [{
          ...run.nodeRuns[1]!.attempts[0]!,
          executorType: "local",
          agentRun: { linuxWorkerPoolSession: { instanceId: "ht-agnet-02" } },
        }],
      }],
    });

    const projection = await readLoopRunProjection({ userId: "user_1", loopRunId: "loop_run_1" }, deps);
    expect(projection.nodes.find((node) => node.nodeKey === "write")?.attempts).toEqual([
      expect.objectContaining({
        executorType: "local",
        executionTarget: "linux_worker_pool",
        workerInstance: "ht-agnet-02",
      }),
    ]);
  });

  it("uses the immutable Run target before a Linux Worker claims an attempt", async () => {
    const deps = dependencies();
    deps.loadRun.mockResolvedValue({
      ...run,
      executionSnapshot: {
        target: {
          type: "linux_worker_pool",
          workerPoolId: "a".repeat(32),
          poolDisplayName: "default-pool",
        },
      },
      nodeRuns: [{
        ...run.nodeRuns[1],
        selectedExecutionTarget: "local",
        attempts: [{
          ...run.nodeRuns[1]!.attempts[0]!,
          executorType: "local",
        }],
      }],
    });

    const projection = await readLoopRunProjection({ userId: "user_1", loopRunId: "loop_run_1" }, deps);
    expect(projection.nodes.find((node) => node.nodeKey === "write")?.attempts).toEqual([
      expect.objectContaining({
        executionTarget: "linux_worker_pool",
        workerPoolDisplayName: "default-pool",
      }),
    ]);
  });

  it("projects the latest persisted execution phase for an attempt", async () => {
    const deps = dependencies();
    deps.loadRun.mockResolvedValue({
      ...run,
      nodeRuns: [{
        ...run.nodeRuns[1],
        attempts: [{
          ...run.nodeRuns[1]!.attempts[0]!,
          executionPhase: "git.fetch",
          executionPhaseStatus: "succeeded",
          executionPhaseStartedAt: new Date("2026-07-30T06:01:00.000Z"),
          executionPhaseFinishedAt: new Date("2026-07-30T06:01:20.000Z"),
          executionPhaseCode: null,
          executionPhaseSummary: "远端引用已同步",
          executionPhaseUpdatedAt: new Date("2026-07-30T06:01:20.000Z"),
        }],
      }],
    });

    const projection = await readLoopRunProjection({ userId: "user_1", loopRunId: "loop_run_1" }, deps);
    expect(projection.nodes.find((node) => node.nodeKey === "write")?.attempts).toEqual([
      expect.objectContaining({
        executionPhase: {
          phase: "git.fetch",
          status: "succeeded",
          startedAt: "2026-07-30T06:01:00.000Z",
          finishedAt: "2026-07-30T06:01:20.000Z",
          code: null,
          summary: "远端引用已同步",
          updatedAt: "2026-07-30T06:01:20.000Z",
        },
      }),
    ]);
  });

  it("exposes a null execution phase for historical attempts without phase records", async () => {
    const deps = dependencies();

    const projection = await readLoopRunProjection({ userId: "user_1", loopRunId: "loop_run_1" }, deps);

    expect(projection.nodes.flatMap((node) => node.attempts).map((attempt) => attempt.executionPhase))
      .toEqual([null, null]);
  });

  it("projects only active pending approvals from the loaded Run", async () => {
    const deps = dependencies();
    deps.loadRun.mockResolvedValue({
      ...run,
      approvals: [{
        id: "approval_1",
        type: "loop_human_gate",
        status: "pending",
        projectId: "project_1",
        createdAt: new Date("2026-07-30T06:01:30.000Z"),
        project: { name: "humanthread" },
        taskId: null,
        task: null,
        loopRunId: "loop_run_1",
        loopRun: {
          id: "loop_run_1",
          taskId: "task_1",
          task: { id: "task_1", shortId: "HUMANTHR1100003", title: "优化任务详情交互" },
          loopVersion: {
            loopDefinition: { name: "Gelsang Project Loop" },
            graph: { nodes: [{ key: "confirm_requirement", label: "确认需求" }] },
          },
        },
        loopNodeRunId: "node_gate_1",
        loopNodeRun: { id: "node_gate_1", nodeKey: "confirm_requirement" },
        requestPayload: {
          prompt: "确认需求",
          routes: { pass: ["confirm_write_prd"], rework: [], reject: [] },
        },
        policySnapshot: { reason: "需要确认" },
        expiresAt: null,
      }, {
        id: "approval_decided",
        type: "loop_human_gate",
        status: "approved",
        projectId: "project_1",
        createdAt: new Date("2026-07-30T06:01:15.000Z"),
        project: { name: "humanthread" },
        taskId: null,
        task: null,
        loopRunId: "loop_run_1",
        loopRun: null,
        loopNodeRunId: null,
        loopNodeRun: null,
        requestPayload: {},
        policySnapshot: {},
        expiresAt: null,
      }, {
        id: "approval_expired",
        type: "loop_runtime_safety",
        status: "pending",
        projectId: "project_1",
        createdAt: new Date("2026-07-30T06:01:00.000Z"),
        project: { name: "humanthread" },
        taskId: null,
        task: null,
        loopRunId: "loop_run_1",
        loopRun: null,
        loopNodeRunId: null,
        loopNodeRun: null,
        requestPayload: {},
        policySnapshot: {},
        expiresAt: new Date("2026-07-30T06:00:00.000Z"),
      }],
    });

    const result = await readLoopRunProjection({ userId: "user_1", loopRunId: "loop_run_1" }, deps);

    expect(result.pendingApprovals).toEqual([expect.objectContaining({
      id: "approval_1",
      taskShortId: "HUMANTHR1100003",
      nodeLabel: "确认需求",
      routes: { pass: ["confirm_write_prd"], rework: [], reject: [] },
    })]);
  });

  it("projects parent and child navigation metadata from the authorized Project only", async () => {
    const deps = dependencies();
    deps.loadRun.mockResolvedValue({
      ...run,
      parentLoopRun: { id: "parent:run/1", projectId: "project_1", status: "waiting" },
      childLoopRuns: [{
        id: "child:run/1",
        projectId: "project_1",
        parentNodeRunId: "node_write_1",
        status: "running",
        loopVersion: { graph },
        nodeRuns: run.nodeRuns,
        bindingSnapshot: { shouldNotLeak: true },
      }],
    });

    const result = await readLoopRunProjection({ userId: "user_1", loopRunId: "loop_run_1" }, deps);

    expect(result.parentRun).toEqual({ id: "parent:run/1", status: "waiting" });
    expect(result.childRuns).toEqual([{
      id: "child:run/1",
      parentNodeRunId: "node_write_1",
      status: "running",
      progress: { completed: 1, total: 3 },
      nodes: [
        { nodeKey: "start", label: "Start", status: "succeeded" },
        { nodeKey: "write", label: "Write", status: "running" },
        { nodeKey: "end", label: "End", status: "pending" },
      ],
    }]);
    expect(result).not.toHaveProperty("bindingSnapshot");
    expect(deps.assertCanReadProject).toHaveBeenCalledOnce();
  });

  it("rejects a related Run from another Project", async () => {
    const deps = dependencies();
    deps.loadRun.mockResolvedValue({
      ...run,
      parentLoopRun: { id: "parent_run_other", projectId: "project_other", status: "waiting" },
      childLoopRuns: [],
    });

    await expect(readLoopRunProjection({ userId: "user_1", loopRunId: "loop_run_1" }, deps))
      .rejects.toThrow("LoopRun relation belongs to another Project");
    expect(deps.loadEvents).not.toHaveBeenCalled();
  });

  it("uses accepted stream position rather than aggregate-local sequence as the cursor", async () => {
    const deps = dependencies();

    await expect(readLoopEventsAfterCursor({
      userId: "user_1",
      loopRunId: "loop_run_1",
      cursor: 1,
    }, deps)).resolves.toEqual({
      cursor: 2,
      events: [{
        id: "event_2",
        eventType: "loop.node.completed",
        aggregateType: "loop_node",
        aggregateId: "node_start_1",
        sequence: 3,
        occurredAt: "2026-07-30T06:01:00.000Z",
        payload: { transition: { status: "routed", edge: { id: "edge_start_write" } } },
      }],
    });
  });

  it("keeps worker app-server notifications out of the activity timeline while retaining their stream cursor", async () => {
    const deps = dependencies();
    deps.loadEventCount.mockResolvedValue(3);
    deps.loadVisibleEvents.mockResolvedValue([
      ...events,
      {
        id: "event_notification_1",
        eventType: "worker.app_server.notification",
        aggregateType: "loop_node",
        aggregateId: "node_write_1",
        sequence: 4,
        occurredAt: new Date("2026-07-30T06:01:10.000Z"),
        payload: { payloadSummary: { method: "item/agentMessage/delta" } },
      },
    ]);

    const result = await readLoopRunProjection({ userId: "user_1", loopRunId: "loop_run_1" }, deps);

    expect(result.eventCursor).toBe(3);
    expect(result.activities.map((activity) => activity.id)).toEqual(["event_1", "event_2"]);
    expect(deps.loadEvents).not.toHaveBeenCalled();
  });

  it("replays only a valid current node checklist from persisted lifecycle events", async () => {
    const deps = dependencies();
    deps.loadVisibleEvents.mockResolvedValue([
      {
        id: "checklist_created_1",
        eventType: "loop.checklist.created",
        aggregateType: "loop_node",
        aggregateId: "node_write_1",
        sequence: 4,
        occurredAt: new Date("2026-07-30T06:01:10.000Z"),
        payload: {
          payloadSummary: {
            loopRunId: "loop_run_1",
            loopNodeRunId: "node_write_1",
            loopNodeAttemptId: "attempt_write_1",
            attemptNo: 1,
            leaseGeneration: 2,
            checklist: [{ id: "inspect", title: "检查仓库状态", status: "not_started", evidenceRefs: [] }],
          },
        },
      },
      {
        id: "checklist_updated_1",
        eventType: "loop.checklist.updated",
        aggregateType: "loop_node",
        aggregateId: "node_write_1",
        sequence: 5,
        occurredAt: new Date("2026-07-30T06:01:11.000Z"),
        payload: {
          payloadSummary: {
            loopRunId: "loop_run_1",
            loopNodeRunId: "node_write_1",
            loopNodeAttemptId: "attempt_write_1",
            attemptNo: 1,
            leaseGeneration: 2,
            itemId: "inspect",
            status: "in_progress",
            evidenceRefs: [],
          },
        },
      },
      {
        id: "checklist_completed_1",
        eventType: "loop.checklist.updated",
        aggregateType: "loop_node",
        aggregateId: "node_write_1",
        sequence: 6,
        occurredAt: new Date("2026-07-30T06:01:12.000Z"),
        payload: {
          payloadSummary: {
            loopRunId: "loop_run_1",
            loopNodeRunId: "node_write_1",
            loopNodeAttemptId: "attempt_write_1",
            attemptNo: 1,
            leaseGeneration: 2,
            itemId: "inspect",
            status: "succeeded",
            evidenceRefs: ["artifacts/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],
          },
        },
      },
    ]);

    const result = await readLoopRunProjection({ userId: "user_1", loopRunId: "loop_run_1" }, deps);

    expect(result.nodes.find((node) => node.nodeKey === "write")?.checklist).toEqual([
      { id: "inspect", title: "检查仓库状态", status: "succeeded", evidenceRefs: ["artifacts/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"] },
    ]);
  });

  it("projects a worker failure as a readable lifecycle activity", async () => {
    const deps = dependencies();
    deps.loadVisibleEvents.mockResolvedValue([{
      id: "event_worker_failed",
      eventType: "worker.stage.failed",
      aggregateType: "loop_node",
      aggregateId: "node_write_1",
      sequence: 4,
      occurredAt: new Date("2026-07-30T06:01:10.000Z"),
      payload: { payloadSummary: { code: "delivery_not_pushed" } },
    }]);

    const result = await readLoopRunProjection({ userId: "user_1", loopRunId: "loop_run_1" }, deps);

    expect(result.activities[0]).toMatchObject({
      eventType: "worker.stage.failed",
      summary: "Write 执行失败：delivery_not_pushed",
    });
  });

  it("authorizes the persisted Project before exposing graph state", async () => {
    const deps = dependencies();
    deps.assertCanReadProject.mockRejectedValue(new Error("Project access denied"));

    await expect(readLoopRunProjection({
      userId: "user_other",
      loopRunId: "loop_run_1",
    }, deps)).rejects.toThrow("Project access denied");

    expect(deps.loadEvents).not.toHaveBeenCalled();
  });

  it("projects a persisted Router decision with bounded audit fields", async () => {
    const deps = dependencies();
    deps.loadVisibleEvents.mockResolvedValue([{
      id: "route_event_1",
      eventType: "loop.agent.route_decided",
      aggregateType: "loop_node",
      aggregateId: "node_start_1",
      sequence: 4,
      occurredAt: new Date("2026-07-30T06:02:00.000Z"),
      payload: {
        sourceNodeId: "start",
        targetNodeId: "write",
        decisionId: "decision_1",
        reasonCode: "NEEDS_IMPLEMENTATION",
        summary: "继续执行实现节点",
        evidence: ["artifacts/plan.md", "secrets/token.txt"],
        confidence: 0.91,
        routerContractVersion: 1,
        routerContractDigest: "digest_1",
        selectedEdgeId: "edge_start_write",
        prompt: "must not be exposed",
      },
    }]);

    const result = await readLoopRunProjection({ userId: "user_1", loopRunId: "loop_run_1" }, deps);

    expect(result.activities[0]).toMatchObject({
      eventType: "loop.agent.route_decided",
      nodeKey: "start",
      edgeId: "edge_start_write",
      routeDecision: {
        decisionId: "decision_1",
        sourceNodeId: "start",
        targetNodeId: "write",
        reasonCode: "NEEDS_IMPLEMENTATION",
        summary: "继续执行实现节点",
        confidence: 0.91,
        evidence: ["artifacts/plan.md", "secrets/token.txt"],
        routerContractVersion: 1,
        routerContractDigest: "digest_1",
        selectedEdgeId: "edge_start_write",
        errorSummary: null,
      },
    });
    expect(JSON.stringify(result.activities[0])).not.toContain("must not be exposed");
  });

  it("does not project a forged Router edge outside the persisted graph", async () => {
    const deps = dependencies();
    deps.loadVisibleEvents.mockResolvedValue([{
      id: "route_event_forged",
      eventType: "loop.agent.route_decided",
      aggregateType: "loop_node",
      aggregateId: "node_start_1",
      sequence: 4,
      occurredAt: new Date("2026-07-30T06:02:00.000Z"),
      payload: {
        sourceNodeId: "start",
        targetNodeId: "end",
        decisionId: "decision_forged",
        reasonCode: "FORGED",
        summary: "invalid route",
        evidence: [],
        confidence: 0.1,
        routerContractVersion: 1,
        routerContractDigest: "digest_1",
        selectedEdgeId: "edge_write_end",
      },
    }]);

    const result = await readLoopRunProjection({ userId: "user_1", loopRunId: "loop_run_1" }, deps);

    expect(result.activities[0]).toMatchObject({ edgeId: null });
    expect(result.activities[0]).not.toHaveProperty("routeDecision");
  });

  it("allowlists Router audit fields in the incremental event response", async () => {
    const deps = dependencies();
    deps.loadEvents.mockResolvedValue([{
      id: "route_event_safe",
      eventType: "loop.agent.route_decided",
      aggregateType: "loop_node",
      aggregateId: "node_start_1",
      sequence: 4,
      occurredAt: new Date("2026-07-30T06:02:00.000Z"),
      payload: {
        sourceNodeId: "start", targetNodeId: "write", decisionId: "decision_safe",
        reasonCode: "NEEDS_IMPLEMENTATION", summary: "继续执行实现节点",
        evidence: ["artifacts/plan.md"], confidence: 0.91,
        routerContractVersion: 1, routerContractDigest: "digest_1",
        selectedEdgeId: "edge_start_write", prompt: "must not be exposed",
        environment: { OPEN_AI_KEY: "must not be exposed" },
      },
    }]);

    const result = await readLoopEventsAfterCursor({ userId: "user_1", loopRunId: "loop_run_1", cursor: 0 }, deps);

    expect(result.events[0]?.payload).toMatchObject({
      decisionId: "decision_safe", selectedEdgeId: "edge_start_write", reasonCode: "NEEDS_IMPLEMENTATION",
    });
    expect(JSON.stringify(result.events[0]?.payload)).not.toMatch(/prompt|OPEN_AI_KEY|must not be exposed/u);
  });
});
