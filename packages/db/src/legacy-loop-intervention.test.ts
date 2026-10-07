import { describe, expect, it, vi } from "vitest";

import { recoverLegacyLoopIntervention } from "./loop-runtime";

const occurredAt = new Date("2026-08-16T02:00:00.000Z");

function createFixture() {
  const state = {
    interaction: null as Record<string, unknown> | null,
    messageSequence: 0,
    nodeStatus: "running",
    nodeWaitingReason: "subloop_retry",
    nodeVersion: 4,
    attemptStatus: "running",
    attemptVersion: 2,
    agentStatus: "orphaned",
    runStatus: "paused",
    runStatusReason: null as string | null,
    runVersion: 21,
    runProjectionVersion: 20,
  };
  const node = {
    id: "loop-node:legacy:develop:2",
    loopRunId: "loop_run:legacy",
    nodeKey: "develop",
    activationNo: 2,
    status: state.nodeStatus,
    waitingReason: state.nodeWaitingReason,
    version: state.nodeVersion,
    inputSnapshot: { task: "implement" },
    loopRun: {
      id: "loop_run:legacy",
      projectId: "project_1",
      taskId: "task_1",
      status: state.runStatus,
    },
    attempts: [] as unknown[],
  };
  const currentAttempt = {
    id: "loop_attempt:legacy:2",
    loopNodeRunId: node.id,
    attempt: 2,
    executorType: "local",
    inputFingerprint: "fingerprint:legacy",
    status: state.attemptStatus,
    version: state.attemptVersion,
    agentRunId: "agent_run:legacy:2",
    result: null,
    error: null,
    agentRun: { id: "agent_run:legacy:2", status: state.agentStatus },
  };
  const previousAttempt = {
    id: "loop_attempt:legacy:1",
    loopNodeRunId: node.id,
    attempt: 1,
    status: "failed",
    result: {
      outcome: "failure",
      output: {
        issueType: "MOBILE_SOURCE_UNAVAILABLE",
        summary: "移动端源码不存在",
      },
      artifactRefs: [],
      effectReceipts: [],
    },
    error: { issueType: "MOBILE_SOURCE_UNAVAILABLE" },
  };
  node.attempts = [currentAttempt];
  const tx = {
    loopRun: {
      findUnique: vi.fn().mockImplementation(async () => ({
        id: node.loopRunId,
        projectId: "project_1",
        taskId: "task_1",
        status: state.runStatus,
        statusReason: state.runStatusReason,
        version: state.runVersion,
        projectionVersion: state.runProjectionVersion,
        task: { assigneeUserId: "user_assignee", createdById: "user_creator" },
        loopVersion: { graph: { nodes: [{ key: "develop", retryPolicy: { maxRetries: 2 } }], retryPolicy: { maxRetries: 2 } } },
      })),
      updateMany: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        if (typeof data.status === "string") state.runStatus = data.status;
        if (data.statusReason === null) state.runStatusReason = null;
        else if (data.statusReason) state.runStatusReason = String(data.statusReason);
        state.runVersion += 1;
        state.runProjectionVersion += 1;
        return { count: 1 };
      }),
    },
    loopNodeRun: {
      findFirst: vi.fn().mockResolvedValue(node),
      findUnique: vi.fn().mockResolvedValue(node),
      updateMany: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        if (data.status) state.nodeStatus = String(data.status);
        if (data.waitingReason) state.nodeWaitingReason = String(data.waitingReason);
        state.nodeVersion += 1;
        node.status = state.nodeStatus;
        node.waitingReason = state.nodeWaitingReason;
        node.version = state.nodeVersion;
        return { count: 1 };
      }),
    },
    loopNodeAttempt: {
      findFirst: vi.fn().mockResolvedValue(previousAttempt),
      updateMany: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        if (data.status) state.attemptStatus = String(data.status);
        state.attemptVersion += 1;
        return { count: 1 };
      }),
    },
    agentRun: {
      updateMany: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        if (data.status) state.agentStatus = String(data.status);
        return { count: 1 };
      }),
    },
    workflowInteraction: {
      findUnique: vi.fn(async () => state.interaction),
      updateMany: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        if (data.messageSequence) state.messageSequence += 1;
        if (state.interaction) state.interaction.messageSequence = state.messageSequence;
        if (typeof data.status === "string" && state.interaction) state.interaction.status = data.status;
        if (data.version && state.interaction) state.interaction.version = Number(state.interaction.version) + 1;
        if (data.closedAt instanceof Date && state.interaction) state.interaction.closedAt = data.closedAt;
        return { count: 1 };
      }),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        state.interaction = {
          id: data.id,
          projectId: data.projectId,
          taskId: data.taskId,
          loopRunId: data.loopRunId,
          loopNodeRunId: data.loopNodeRunId,
          activationNo: data.activationNo,
          kind: data.kind,
          status: "open",
          version: 1,
          messageSequence: 0,
          policySnapshot: data.policySnapshot,
          createdAt: occurredAt,
          closedAt: null,
          messages: [],
          decision: null,
        };
        return state.interaction;
      }),
    },
    workflowInteractionDecision: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => data),
    },
    workflowInteractionMessage: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        state.messageSequence += 1;
        if (state.interaction) state.interaction.messageSequence = state.messageSequence;
        return data;
      }),
    },
    workflowInteractionAttachment: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    workflowInteractionMention: { createMany: vi.fn().mockResolvedValue({ count: 0 }) },
    notificationIntent: { findUnique: vi.fn().mockResolvedValue(null), createMany: vi.fn().mockResolvedValue({ count: 1 }) },
    orchestrationAggregateSequence: {
      upsert: vi.fn(async ({ create }: { create: { sequence: number } }) => ({ sequence: create.sequence })),
    },
    orchestrationEvent: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
    outboxMessage: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
  };
  let transactionTail = Promise.resolve();
  const db = {
    $transaction: vi.fn(<T>(callback: (value: typeof tx) => Promise<T>) => {
      const result = transactionTail.then(() => callback(tx));
      transactionTail = result.then(() => undefined, () => undefined);
      return result;
    }),
  };
  return { state, tx, db };
}

describe("legacy loop intervention recovery", () => {
  it("moves a paused orphaned retry into one runtime intervention transaction", async () => {
    const fixture = createFixture();

    await expect(recoverLegacyLoopIntervention({
      loopRunId: "loop_run:legacy",
      occurredAt,
      correlationId: "loop:loop_run:legacy",
      actor: { type: "system", id: "legacy-loop-recovery" },
    }, { db: fixture.db as never })).resolves.toMatchObject({
      recovered: false,
      interactionId: expect.any(String),
      reasonCode: "MOBILE_SOURCE_UNAVAILABLE",
    });

    expect(fixture.state.nodeStatus).toBe("waiting_intervention");
    expect(fixture.state.runStatus).toBe("waiting");
    expect(fixture.state.attemptStatus).toBe("blocked");
    expect(fixture.state.agentStatus).toBe("failed");
    expect(fixture.tx.workflowInteraction.create).toHaveBeenCalledTimes(1);
    expect(fixture.tx.workflowInteractionMessage.create).toHaveBeenCalledTimes(1);
  });

  it("preserves a direct lease-expired error when legacy recovery opens its intervention", async () => {
    const fixture = createFixture();
    fixture.tx.loopNodeAttempt.findFirst.mockImplementation(async () => ({
      id: "loop_attempt:legacy:1",
      loopNodeRunId: "loop-node:legacy:develop:2",
      attempt: 1,
      status: "failed",
      result: null,
      error: { code: "lease_expired", agentRunId: "agent_run:legacy:1" },
    }));

    await expect(recoverLegacyLoopIntervention({
      loopRunId: "loop_run:legacy",
      occurredAt,
      correlationId: "loop:loop_run:legacy",
      actor: { type: "system", id: "legacy-loop-recovery" },
    }, { db: fixture.db as never })).resolves.toMatchObject({ reasonCode: "lease_expired" });

    expect(fixture.state.runStatusReason).toBe("intervention:lease_expired");
    expect(fixture.tx.workflowInteractionMessage.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ body: expect.stringContaining("lease_expired") }),
    }));
  });

  it("returns the existing intervention for concurrent or repeated reads", async () => {
    const fixture = createFixture();
    const input = {
      loopRunId: "loop_run:legacy",
      occurredAt,
      correlationId: "loop:loop_run:legacy",
      actor: { type: "system" as const, id: "legacy-loop-recovery" },
    };

    const [first, second] = await Promise.all([
      recoverLegacyLoopIntervention(input, { db: fixture.db as never }),
      recoverLegacyLoopIntervention(input, { db: fixture.db as never }),
    ]);

    expect(first.interactionId).toBe(second.interactionId);
    expect(second.recovered).toBe(true);
    expect(fixture.tx.workflowInteraction.create).toHaveBeenCalledTimes(1);
    expect(fixture.tx.workflowInteractionMessage.create).toHaveBeenCalledTimes(1);
  });

  it("expires a superseded open intervention and resumes the current ready activation", async () => {
    const fixture = createFixture();
    fixture.state.runStatus = "waiting";
    fixture.state.runStatusReason = "intervention:MOBILE_SOURCE_UNAVAILABLE";
    fixture.state.nodeStatus = "waiting_intervention";
    fixture.state.interaction = {
      id: "workflow-interaction:legacy:write-plan-1",
      projectId: "project_1",
      taskId: "task_1",
      loopRunId: "loop_run:legacy",
      loopNodeRunId: "loop-node:legacy:write_plan:1",
      activationNo: 1,
      kind: "runtime_intervention",
      status: "open",
      version: 1,
      messageSequence: 1,
      policySnapshot: { source: "legacy_state_recovery" },
      createdAt: occurredAt,
      closedAt: null,
      messages: [],
      decision: null,
    };
    fixture.tx.loopNodeRun.findFirst.mockReset();
    fixture.tx.loopNodeRun.findFirst
      .mockResolvedValueOnce({
        id: "loop-node:legacy:write_plan:1",
        loopRunId: "loop_run:legacy",
        nodeKey: "write_plan",
        activationNo: 1,
        status: "waiting_intervention",
        waitingReason: "runtime_intervention:MOBILE_SOURCE_UNAVAILABLE",
        version: 5,
        inputSnapshot: { task: "plan" },
        attempts: [],
      })
      .mockResolvedValueOnce({
        id: "loop-node:legacy:write_plan:2",
        loopRunId: "loop_run:legacy",
        nodeKey: "write_plan",
        activationNo: 2,
        status: "succeeded",
      })
      .mockResolvedValueOnce({
        id: "loop-node:legacy:develop:2",
        loopRunId: "loop_run:legacy",
        nodeKey: "develop",
        activationNo: 2,
        status: "ready",
      });

    const result = await recoverLegacyLoopIntervention({
      loopRunId: "loop_run:legacy",
      occurredAt,
      correlationId: "loop:loop_run:legacy",
      actor: { type: "system", id: "legacy-loop-recovery" },
    }, { db: fixture.db as never });
    expect(result).toMatchObject({
      recovered: true,
      interactionId: null,
      loopNodeRunId: "loop-node:legacy:develop:2",
    });

    expect(fixture.state.interaction?.status).toBe("expired");
    expect(fixture.state.runStatus).toBe("running");
    expect(fixture.tx.workflowInteractionDecision.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        interactionId: "workflow-interaction:legacy:write-plan-1",
        decision: "expired",
      }),
    });
  });
});
