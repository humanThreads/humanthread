import { describe, expect, it } from "vitest";
import {
  planOrchestrationEventBackfill,
  reconcileOrchestrationAggregateSequences,
  summarizeOrchestrationEventBackfill,
} from "../../../prisma/orchestration-event-backfill-plan.mjs";

describe("orchestration event backfill planning", () => {
  it("maps legacy task events to causal envelopes with stable per-task sequences", () => {
    const plan = planOrchestrationEventBackfill({
      existingEvents: [],
      taskEvents: [
        {
          id: "task_event_2",
          taskId: "task_1",
          workflowInstanceId: "workflow_1",
          type: "task_completed",
          actorType: "human",
          actorUserId: "user_1",
          message: "done",
          payload: null,
          createdAt: new Date("2026-07-21T00:02:00.000Z"),
        },
        {
          id: "task_event_1",
          taskId: "task_1",
          workflowInstanceId: "workflow_1",
          type: "task_started",
          actorType: "system",
          actorUserId: null,
          message: null,
          payload: { source: "legacy" },
          createdAt: new Date("2026-07-21T00:01:00.000Z"),
        },
      ],
    });

    expect(plan.events).toEqual([
      expect.objectContaining({
        id: "legacy:task_event_1",
        eventType: "task.started",
        aggregateType: "task",
        aggregateId: "task_1",
        aggregateVersion: 1,
        sequence: 1,
        correlationId: "workflow:workflow_1",
        causationId: "task_event_1",
        actorType: "system",
        actorId: "workflow-core",
      }),
      expect.objectContaining({
        id: "legacy:task_event_2",
        aggregateVersion: 2,
        sequence: 2,
        actorType: "user",
        actorId: "user_1",
      }),
    ]);
    expect(plan.errors).toEqual([]);
  });

  it("skips existing event IDs and reports unsupported legacy actors", () => {
    const plan = planOrchestrationEventBackfill({
      existingEvents: [{
        id: "legacy:existing",
        aggregateType: "task",
        aggregateId: "task_1",
        sequence: 1,
      }],
      taskEvents: [
        {
          id: "existing",
          taskId: "task_1",
          workflowInstanceId: "workflow_1",
          type: "task_started",
          actorType: "human",
          actorUserId: "user_1",
          message: null,
          payload: null,
          createdAt: new Date("2026-07-21T00:01:00.000Z"),
        },
        {
          id: "invalid",
          taskId: "task_2",
          workflowInstanceId: "workflow_1",
          type: "task_started",
          actorType: "ai",
          actorUserId: null,
          message: null,
          payload: null,
          createdAt: new Date("2026-07-21T00:02:00.000Z"),
        },
      ],
    });

    expect(plan.skippedEventIds).toEqual(["legacy:existing"]);
    expect(summarizeOrchestrationEventBackfill(plan)).toEqual({
      events: 0,
      skipped: 1,
      errors: 1,
    });
  });

  it("allocates missing legacy events after the existing aggregate stream", () => {
    const plan = planOrchestrationEventBackfill({
      existingEvents: [{
        id: "legacy:existing",
        aggregateType: "task",
        aggregateId: "task_1",
        sequence: 5,
      }],
      taskEvents: [
        {
          id: "existing",
          taskId: "task_1",
          workflowInstanceId: "workflow_1",
          type: "task_started",
          actorType: "human",
          actorUserId: "user_1",
          message: null,
          payload: null,
          createdAt: new Date("2026-07-21T00:01:00.000Z"),
        },
        {
          id: "missing",
          taskId: "task_1",
          workflowInstanceId: "workflow_1",
          type: "task_completed",
          actorType: "human",
          actorUserId: "user_1",
          message: null,
          payload: null,
          createdAt: new Date("2026-07-21T00:02:00.000Z"),
        },
      ],
    });

    expect(plan.skippedEventIds).toEqual(["legacy:existing"]);
    expect(plan.events).toEqual([
      expect.objectContaining({
        id: "legacy:missing",
        aggregateId: "task_1",
        aggregateVersion: 6,
        sequence: 6,
      }),
    ]);
  });

  it("reconciles aggregate counters and rejects a remaining sequence gap", async () => {
    const healthyDb = {
      $executeRawUnsafe: async () => 4,
      $queryRawUnsafe: async () => [{ count: 0n }],
    };
    await expect(reconcileOrchestrationAggregateSequences(healthyDb)).resolves.toEqual({
      repaired: 4,
      remaining: 0,
    });

    const inconsistentDb = {
      $executeRawUnsafe: async () => 0,
      $queryRawUnsafe: async () => [{ count: 1n }],
    };
    await expect(reconcileOrchestrationAggregateSequences(inconsistentDb)).rejects.toThrow(
      "Orchestration aggregate sequence reconciliation left 1 gap(s)",
    );
  });
});
