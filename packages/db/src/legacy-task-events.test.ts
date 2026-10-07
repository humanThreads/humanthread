import { describe, expect, it, vi } from "vitest";
import type { TaskEvent } from "@humanthread/shared";
import { appendLegacyTaskEvents } from "./legacy-task-events";

describe("appendLegacyTaskEvents", () => {
  it("allocates one atomic sequence range and appends events with outbox messages", async () => {
    const events: TaskEvent[] = [
      {
        id: "task_1:cli_reported:1",
        taskId: "task_1",
        workflowInstanceId: "workflow_1",
        type: "cli_reported",
        actorType: "human",
        actorUserId: "user_1",
        createdAt: new Date("2026-07-21T00:00:00.000Z"),
      },
      {
        id: "task_1:task_completed",
        taskId: "task_1",
        workflowInstanceId: "workflow_1",
        type: "task_completed",
        actorType: "human",
        actorUserId: "user_1",
        createdAt: new Date("2026-07-21T00:00:01.000Z"),
      },
    ];
    const sequenceUpsert = vi.fn().mockResolvedValue({ sequence: 7 });
    const orchestrationCreateMany = vi.fn().mockResolvedValue({ count: 2 });
    const outboxCreateMany = vi.fn().mockResolvedValue({ count: 2 });

    await appendLegacyTaskEvents({
      tx: {
        orchestrationAggregateSequence: { upsert: sequenceUpsert },
        orchestrationEvent: { createMany: orchestrationCreateMany },
        outboxMessage: { createMany: outboxCreateMany },
      },
      events,
    });

    expect(sequenceUpsert).toHaveBeenCalledWith({
      where: { aggregateType_aggregateId: { aggregateType: "task", aggregateId: "task_1" } },
      create: { aggregateType: "task", aggregateId: "task_1", sequence: 2 },
      update: { sequence: { increment: 2 } },
      select: { sequence: true },
    });
    expect(orchestrationCreateMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          id: "legacy:task_1:cli_reported:1",
          eventType: "cli.reported",
          aggregateVersion: 6,
          sequence: 6,
          correlationId: "workflow:workflow_1",
          causationId: "task_1:cli_reported:1",
          actorType: "user",
          actorId: "user_1",
        }),
        expect.objectContaining({
          id: "legacy:task_1:task_completed",
          aggregateVersion: 7,
          sequence: 7,
        }),
      ],
    });
    expect(outboxCreateMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({ id: "outbox:legacy:task_1:cli_reported:1" }),
        expect.objectContaining({ id: "outbox:legacy:task_1:task_completed" }),
      ],
    });
    expect(outboxCreateMany.mock.calls[0]?.[0].data[0].payload.occurredAt).toBe(
      "2026-07-21T00:00:00.000Z",
    );
  });

  it("does nothing for an empty event list", async () => {
    const sequenceUpsert = vi.fn();
    await appendLegacyTaskEvents({
      tx: {
        orchestrationAggregateSequence: { upsert: sequenceUpsert },
        orchestrationEvent: { createMany: vi.fn() },
        outboxMessage: { createMany: vi.fn() },
      },
      events: [],
    });
    expect(sequenceUpsert).not.toHaveBeenCalled();
  });
});
