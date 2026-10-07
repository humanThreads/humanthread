import { describe, expect, it, vi } from "vitest";

import { restartLoopRunFromNode, type LoopNodeRestartDb } from "./loop-node-restart";

const occurredAt = new Date("2026-09-10T16:30:00.000Z");

const rootGraph = {
  schemaVersion: 1,
  limits: { maxStages: 10, maxRepeatCount: 2 },
  nodes: [
    { key: "start", label: "开始", type: "start" },
    { key: "agent-action-3", label: "开发", type: "agent_action", executionTarget: "local" },
    { key: "agent-action-7", label: "推送", type: "agent_action", executionTarget: "local" },
    { key: "end", label: "结束", type: "end" },
  ],
  edges: [
    { id: "edge-a3-a7", source: "agent-action-3", target: "agent-action-7", kind: "normal", outcome: "success" },
  ],
};

const runGraphSnapshot = {
  snapshotId: "snapshot_test",
  graphDigest: `sha256:${"a".repeat(64)}`,
  rootLoopVersionId: "loop_version_1",
  loopVersions: [{
    loopDefinitionId: "loop_definition_1",
    loopVersionId: "loop_version_1",
    scope: "project",
    graph: rootGraph,
  }],
  reachableNodeIds: ["start", "agent-action-3", "agent-action-7", "end"],
};

function fixture(overrides: Record<string, unknown> = {}) {
  const run: Record<string, unknown> = {
    id: "loop_run_1",
    projectId: "project_1",
    status: "failed",
    statusReason: "subloop_attempt_limit_exceeded",
    stopReason: "subloop_attempt_limit_exceeded",
    version: 7,
    projectionVersion: 9,
    runGraphSnapshot,
    loopVersion: { graph: null },
    ...overrides,
  };
  const previousActivation = { activationNo: 1, inputSnapshot: { taskId: "task_1" } };
  const created: Array<Record<string, unknown>> = [];
  const events: Array<Record<string, unknown>> = [];
  let receipt: { id: string; status: string; result: unknown } | null = null;
  const tx = {
    commandReceipt: {
      findUnique: vi.fn(async () => receipt),
      create: vi.fn(async ({ data }: { data: { id: string } }) => {
        receipt = { id: data.id, status: "processing", result: null };
        return {};
      }),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        receipt = { ...(receipt as { id: string; status: string; result: unknown }), ...data };
        return {};
      }),
    },
    orchestrationAggregateSequence: { upsert: vi.fn(async () => ({ sequence: 1 })) },
    orchestrationEvent: {
      createMany: vi.fn(async ({ data }: { data: Array<Record<string, unknown>> }) => {
        events.push(...data);
        return {};
      }),
    },
    outboxMessage: { createMany: vi.fn(async () => ({})) },
    loopRun: {
      findUnique: vi.fn(async () => run),
      updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        if (where.version !== run.version || where.status !== run.status) return { count: 0 };
        void data;
        return { count: 1 };
      }),
    },
    loopNodeRun: {
      findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => (
        "selectedEdgeId" in where ? { structuredOutput: { from: "agent-action-3" } } : previousActivation
      )),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        created.push(data);
        return data;
      }),
    },
  };
  const db = {
    $transaction: async <T>(callback: (transaction: typeof tx) => Promise<T>) => callback(tx),
  } as unknown as LoopNodeRestartDb;
  return { db, tx, created, events, run, previousActivation, setReceipt(value: { id: string; status: string; result: unknown }) { receipt = value; } };
}

const input = {
  loopRunId: "loop_run_1",
  targetNodeKey: "agent-action-7",
  reason: "网关空响应，从失败节点重试",
  actorUserId: "user_1",
  commandId: "restart-command-1",
  occurredAt,
};

describe("restartLoopRunFromNode", () => {
  it("reopens a failed run with a fresh activation and resets the failure count", async () => {
    const fixtureState = fixture();

    const result = await restartLoopRunFromNode(input, { db: fixtureState.db });

    expect(result).toMatchObject({
      loopRunId: "loop_run_1",
      nodeKey: "agent-action-7",
      activationNo: 2,
      loopRunVersion: 8,
    });
    expect(fixtureState.created).toEqual([expect.objectContaining({
      loopRunId: "loop_run_1",
      nodeKey: "agent-action-7",
      activationNo: 2,
      status: "ready",
      attemptCount: 0,
      version: 1,
      inputSnapshot: { from: "agent-action-3" },
      readyAt: occurredAt,
    })]);
    expect(fixtureState.tx.loopRun.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "loop_run_1", status: "failed", version: 7, projectionVersion: 9 },
      data: expect.objectContaining({
        status: "running",
        statusReason: null,
        stopReason: null,
        finishedAt: null,
        version: { increment: 1 },
        projectionVersion: { increment: 1 },
      }),
    }));
    expect(fixtureState.events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        eventType: "loop.run.node_restarted",
        aggregateType: "run",
        aggregateId: "loop_run_1",
        actorId: "user_1",
      }),
      expect.objectContaining({
        eventType: "loop.node.ready",
        aggregateType: "loop_node",
      }),
    ]));
  });

  it("allows restarting from any previously completed node of a completed run", async () => {
    const fixtureState = fixture({ status: "completed", statusReason: "human_gate", stopReason: null });

    const result = await restartLoopRunFromNode({ ...input, targetNodeKey: "agent-action-3" }, { db: fixtureState.db });

    expect(result).toMatchObject({ nodeKey: "agent-action-3", activationNo: 2 });
    expect(fixtureState.created[0]).toMatchObject({ nodeKey: "agent-action-3", attemptCount: 0 });
  });

  it("rejects a run that is still active", async () => {
    const fixtureState = fixture({ status: "running" });

    await expect(restartLoopRunFromNode(input, { db: fixtureState.db }))
      .rejects.toMatchObject({ code: "validation_failed" });
    expect(fixtureState.created).toHaveLength(0);
  });

  it("reopens a run parked on human intervention from the failed node", async () => {
    // A run that exhausted its attempts on a transient upstream failure waits
    // for a human. Recovery must be possible from the failed node instead of
    // forcing a brand new run that repeats every earlier stage.
    const fixtureState = fixture({
      status: "waiting",
      statusReason: "intervention:worker_execution_failed",
      stopReason: null,
    });

    const result = await restartLoopRunFromNode(input, { db: fixtureState.db });

    expect(result).toMatchObject({ nodeKey: "agent-action-7", activationNo: 2, loopRunVersion: 8 });
    expect(fixtureState.created[0]).toMatchObject({
      nodeKey: "agent-action-7",
      activationNo: 2,
      status: "ready",
      attemptCount: 0,
    });
    expect(fixtureState.tx.loopRun.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "loop_run_1", status: "waiting", version: 7, projectionVersion: 9 },
      data: expect.objectContaining({
        status: "running",
        statusReason: null,
        stopReason: null,
      }),
    }));
  });

  it("still rejects a run that is actively executing", async () => {
    // `running` means a Worker currently holds the node lease; restarting it
    // would race the live executor.
    const fixtureState = fixture({ status: "running", statusReason: null });

    await expect(restartLoopRunFromNode(input, { db: fixtureState.db }))
      .rejects.toMatchObject({ code: "validation_failed" });
    expect(fixtureState.created).toHaveLength(0);
  });

  it("rejects unknown, unactivated, and boundary nodes", async () => {
    const fixtureState = fixture();

    await expect(restartLoopRunFromNode({ ...input, targetNodeKey: "missing" }, { db: fixtureState.db }))
      .rejects.toMatchObject({ code: "validation_failed" });
    await expect(restartLoopRunFromNode({ ...input, targetNodeKey: "end" }, { db: fixtureState.db }))
      .rejects.toMatchObject({ code: "validation_failed" });
    await expect(restartLoopRunFromNode({ ...input, targetNodeKey: "start" }, { db: fixtureState.db }))
      .rejects.toMatchObject({ code: "validation_failed" });

    fixtureState.tx.loopNodeRun.findFirst.mockResolvedValueOnce(null as never);
    await expect(restartLoopRunFromNode(input, { db: fixtureState.db }))
      .rejects.toMatchObject({ code: "validation_failed" });
    expect(fixtureState.created).toHaveLength(0);
  });

  it("returns the original result for a repeated command without creating another activation", async () => {
    const fixtureState = fixture();
    fixtureState.setReceipt({
      id: input.commandId,
      status: "completed",
      result: { loopRunId: "loop_run_1", nodeKey: "agent-action-7", activationNo: 2, loopRunVersion: 8 },
    });

    const result = await restartLoopRunFromNode(input, { db: fixtureState.db });

    expect(result).toMatchObject({ activationNo: 2 });
    expect(fixtureState.created).toHaveLength(0);
    expect(fixtureState.tx.loopRun.updateMany).not.toHaveBeenCalled();
  });
});
