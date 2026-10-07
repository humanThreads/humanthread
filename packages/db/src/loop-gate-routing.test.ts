import type { GateDecision, LoopGraph, OrchestrationCommand } from "@humanthread/shared";
import { describe, expect, it, vi } from "vitest";

import { routeGateDecision, type LoopGateRoutingDb } from "./loop-gate-routing";

const now = new Date("2026-07-30T14:00:00.000Z");
const command: OrchestrationCommand<unknown> = {
  commandId: "gate-route:approval_1",
  correlationId: "loop:loop_run_1",
  actor: { type: "user", id: "user_1" },
  payload: {},
  issuedAt: now,
};
const graph: LoopGraph = {
  schemaVersion: 1,
  inputSchema: {},
  outputSchema: {},
  limits: { maxStages: 4, maxRepeatCount: 3 },
  nodes: [
    { key: "start", label: "Start", type: "start" },
    { key: "work", label: "Work", type: "agent_action", executionTarget: "local", promptTemplate: "Work" },
    { key: "review", label: "Review", type: "human_gate", executionTarget: "platform" },
    { key: "end", label: "End", type: "end" },
  ],
  edges: [
    { id: "start-work", source: "start", target: "work", kind: "normal", outcome: "success" },
    { id: "work-review", source: "work", target: "review", kind: "normal", outcome: "success" },
    { id: "review-end", source: "review", target: "end", kind: "normal", outcome: "pass" },
    { id: "review-work", source: "review", target: "work", kind: "feedback", outcome: "rework", maxTraversals: 3 },
  ],
};
const decision: GateDecision = {
  outcome: "rework",
  reasonCode: "changes_requested",
  message: "Revise the draft",
  evidenceRefs: ["artifact_1"],
  selectedEdgeId: "review-work",
};

function input(overrides: Record<string, unknown> = {}) {
  return {
    command,
    loopRunId: "loop_run_1",
    loopNodeRunId: "node_run_review_1",
    decision,
    ...overrides,
  };
}

function createFixture(overrides: {
  transitions?: number;
  repeats?: number;
  edgeTraversals?: Record<string, number>;
  maxRepeatCount?: number;
  maxTransitions?: number;
  latestTargetActivation?: number;
  existingReceipt?: unknown;
  runUpdateCount?: number;
} = {}) {
  const aggregateSequences = new Map<string, number>();
  const transitions = overrides.transitions ?? 3;
  const repeats = overrides.repeats ?? 1;
  const edgeTraversals = overrides.edgeTraversals ?? {
    "start-work": 1,
    "work-review": 1,
    "review-work": 1,
  };
  const persisted = {
    id: "node_run_review_1",
    loopRunId: "loop_run_1",
    nodeKey: "review",
    activationNo: 1,
    status: "waiting_approval",
    version: 4,
    loopRun: {
      id: "loop_run_1",
      engineKind: "graph_v1",
      status: "waiting",
      version: 7,
      projectionVersion: 5,
      transitionCount: transitions,
      repeatCount: repeats,
      usageAggregate: { transitions, repeats, edgeTraversals },
      budgetSnapshot: {
        maxStages: 4,
        maxRepeatCount: overrides.maxRepeatCount ?? 3,
        maxTransitions: overrides.maxTransitions ?? 16,
      },
      loopVersion: {
        graph,
        maxRepeatCount: 3,
        platformMaxTransitions: 16,
      },
    },
  };
  const tx = {
    commandReceipt: {
      findUnique: vi.fn().mockResolvedValue(overrides.existingReceipt ?? null),
      create: vi.fn().mockResolvedValue(undefined),
      update: vi.fn().mockResolvedValue(undefined),
    },
    orchestrationAggregateSequence: {
      upsert: vi.fn(async ({ where, create }: {
        where: { aggregateType_aggregateId: { aggregateType: string; aggregateId: string } };
        create: { sequence: number };
      }) => {
        const aggregate = where.aggregateType_aggregateId;
        const key = `${aggregate.aggregateType}:${aggregate.aggregateId}`;
        const sequence = (aggregateSequences.get(key) ?? create.sequence - 1) + 1;
        aggregateSequences.set(key, sequence);
        return { sequence };
      }),
    },
    orchestrationEvent: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
    outboxMessage: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
    loopNodeRun: {
      findUnique: vi.fn().mockResolvedValue(persisted),
      findFirst: vi.fn().mockResolvedValue({ activationNo: overrides.latestTargetActivation ?? 1 }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      create: vi.fn().mockResolvedValue(undefined),
    },
    loopRun: {
      updateMany: vi.fn().mockResolvedValue({ count: overrides.runUpdateCount ?? 1 }),
    },
  };
  const db: LoopGateRoutingDb = {
    $transaction: vi.fn(async (callback) => callback(tx)),
  };
  return { tx, db };
}

describe("routeGateDecision", () => {
  it("routes rework to one new activation and increments every authoritative counter once", async () => {
    const fixture = createFixture();

    await expect(routeGateDecision(input(), { db: fixture.db })).resolves.toEqual({
      status: "routed",
      selectedEdgeId: "review-work",
      targetNodeRunId: "loop-node:loop_run_1:work:2",
    });

    expect(fixture.tx.loopNodeRun.updateMany).toHaveBeenCalledWith({
      where: {
        id: "node_run_review_1",
        loopRunId: "loop_run_1",
        status: "waiting_approval",
        version: 4,
      },
      data: expect.objectContaining({
        status: "succeeded",
        gateDecision: decision,
        selectedEdgeId: "review-work",
        version: { increment: 1 },
      }),
    });
    expect(fixture.tx.loopRun.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: "loop_run_1",
        status: "waiting",
        version: 7,
        projectionVersion: 5,
        transitionCount: 3,
        repeatCount: 1,
      }),
      data: expect.objectContaining({
        status: "running",
        transitionCount: 4,
        repeatCount: 2,
        usageAggregate: {
          transitions: 4,
          repeats: 2,
          edgeTraversals: {
            "start-work": 1,
            "work-review": 1,
            "review-work": 2,
          },
        },
      }),
    });
    expect(fixture.tx.loopNodeRun.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        id: "loop-node:loop_run_1:work:2",
        loopRunId: "loop_run_1",
        nodeKey: "work",
        activationNo: 2,
        status: "ready",
      }),
    });
    expect(fixture.tx.orchestrationEvent.createMany).toHaveBeenCalledOnce();
    expect(fixture.tx.outboxMessage.createMany).toHaveBeenCalledOnce();
  });

  it.each([
    ["max_repeat_count_exhausted", { repeats: 3 }],
    ["edge_max_traversals_exhausted", { edgeTraversals: { "review-work": 3 } }],
    ["max_transitions_exhausted", { transitions: 15 }],
  ] as const)("stops with %s before creating another activation", async (reason, counters) => {
    const fixture = createFixture(counters);

    await expect(routeGateDecision(input(), { db: fixture.db })).resolves.toEqual({
      status: "exhausted",
      selectedEdgeId: "review-work",
      stopReason: reason,
    });

    expect(fixture.tx.loopRun.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: "exhausted",
        statusReason: reason,
        stopReason: reason,
      }),
    }));
    expect(fixture.tx.loopNodeRun.create).not.toHaveBeenCalled();
  });

  it("rejects a selected edge that disagrees with deterministic routing before mutation", async () => {
    const fixture = createFixture();

    await expect(routeGateDecision(input({
      decision: { ...decision, selectedEdgeId: "review-end" },
    }), { db: fixture.db })).rejects.toMatchObject({ code: "validation_failed" });

    expect(fixture.tx.loopNodeRun.updateMany).not.toHaveBeenCalled();
    expect(fixture.tx.loopRun.updateMany).not.toHaveBeenCalled();
  });

  it("returns a stored duplicate result without loading or mutating the gate", async () => {
    const result = {
      status: "routed",
      selectedEdgeId: "review-work",
      targetNodeRunId: "loop-node:loop_run_1:work:2",
    };
    const fixture = createFixture({
      existingReceipt: { id: command.commandId, status: "completed", result },
    });

    await expect(routeGateDecision(input(), { db: fixture.db })).resolves.toEqual(result);
    expect(fixture.tx.loopNodeRun.findUnique).not.toHaveBeenCalled();
    expect(fixture.tx.loopNodeRun.updateMany).not.toHaveBeenCalled();
  });

  it("does not create an activation or event when the LoopRun CAS loses", async () => {
    const fixture = createFixture({ runUpdateCount: 0 });

    await expect(routeGateDecision(input(), { db: fixture.db })).rejects.toMatchObject({
      code: "version_conflict",
    });

    expect(fixture.tx.loopNodeRun.create).not.toHaveBeenCalled();
    expect(fixture.tx.orchestrationEvent.createMany).not.toHaveBeenCalled();
    expect(fixture.tx.outboxMessage.createMany).not.toHaveBeenCalled();
  });
});
