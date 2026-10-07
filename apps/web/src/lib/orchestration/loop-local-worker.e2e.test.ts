import { describe, expect, it, vi } from "vitest";

import { completeLoopAssignment } from "./worker-commands";

const now = new Date("2026-07-30T12:00:00.000Z");

function command(overrides: Record<string, unknown> = {}) {
  return {
    agentRunId: "agent_run_1",
    workerId: "local-worker:device_1",
    deviceId: "device_1",
    leaseGeneration: 7,
    commandId: "result:attempt_1",
    loopRunId: "loop_run_1",
    loopNodeRunId: "node_run_1",
    loopNodeAttemptId: "attempt_1",
    attemptNo: 1,
    result: {
      outcome: "success" as const,
      output: { summary: "done" },
      artifactRefs: [],
      effectReceipts: [],
    },
    now,
    ...overrides,
  };
}

function runRecord(leaseGeneration = 7) {
  return {
    id: "agent_run_1",
    taskId: null,
    loopRunId: "loop_run_1",
    loopNodeRunId: "node_run_1",
    loopNodeAttemptId: "attempt_1",
    attempt: 1,
    status: "running",
    workerId: "local-worker:device_1",
    leaseGeneration,
    leaseExpiresAt: new Date("2026-07-30T12:05:00.000Z"),
    lastEventSequence: 0,
    nodeRunVersion: 1,
    nodeRunAttemptCount: 1,
    attemptVersion: 1,
    checkpoint: null,
  };
}

describe("local Loop worker platform recovery", () => {
  it("returns the durable terminal result after its first response is disconnected", async () => {
    const run = runRecord();
    const receipts = new Map<string, unknown>();
    let disconnectBeforeAck = true;
    let committedTerminalResults = 0;
    const persistResult = vi.fn(async () => {
      committedTerminalResults += 1;
      run.status = "succeeded";
      return { completed: true, loopRunStatus: "running" };
    });
    const executeIdempotent = vi.fn(async ({
      commandId,
      apply,
    }: {
      commandId: string;
      apply(): Promise<unknown>;
    }) => {
      if (receipts.has(commandId)) return receipts.get(commandId);
      const result = await apply();
      receipts.set(commandId, result);
      if (disconnectBeforeAck) {
        disconnectBeforeAck = false;
        throw new TypeError("connection closed before response");
      }
      return result;
    });
    const dependencies = {
      loadRun: vi.fn(async () => ({ ...run })),
      persistResult,
      executeIdempotent,
    };

    await expect(completeLoopAssignment(command(), dependencies)).rejects.toBeInstanceOf(TypeError);
    await expect(completeLoopAssignment(command(), dependencies)).resolves.toEqual({
      completed: true,
      loopRunStatus: "running",
    });

    expect(committedTerminalResults).toBe(1);
    expect(persistResult).toHaveBeenCalledOnce();
    expect(receipts).toEqual(new Map([[
      "result:attempt_1",
      { completed: true, loopRunStatus: "running" },
    ]]));
  });

  it("rejects the old result after lease takeover before any durable mutation", async () => {
    const run = runRecord(8);
    const persistResult = vi.fn();
    const executeIdempotent = vi.fn();

    await expect(completeLoopAssignment(command({ leaseGeneration: 7 }), {
      loadRun: vi.fn(async () => ({ ...run })),
      persistResult,
      executeIdempotent,
    })).rejects.toMatchObject({ code: "stale_lease" });

    expect(persistResult).not.toHaveBeenCalled();
    expect(executeIdempotent).not.toHaveBeenCalled();
  });
});
