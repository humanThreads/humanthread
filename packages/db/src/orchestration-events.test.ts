import { describe, expect, it, vi } from "vitest";
import type {
  OrchestrationCommand,
  OrchestrationEventEnvelope,
} from "@humanthread/shared";
import { executeIdempotentCommand } from "./orchestration-events";

const command: OrchestrationCommand<{ taskId: string }> = {
  commandId: "command_1",
  correlationId: "project_1:delivery",
  actor: { type: "user", id: "user_1" },
  payload: { taskId: "task_1" },
  issuedAt: new Date("2026-07-21T00:00:00.000Z"),
};

const taskReadyEvent: OrchestrationEventEnvelope<{ projectId: string }> = {
  id: "event_1",
  eventType: "task.ready",
  aggregateType: "task",
  aggregateId: "task_1",
  aggregateVersion: 2,
  sequence: 2,
  correlationId: command.correlationId,
  commandId: command.commandId,
  actorType: "user",
  actorId: "user_1",
  occurredAt: command.issuedAt,
  payload: { projectId: "project_1" },
};

function createTransaction(overrides: {
  existingReceipt?: unknown;
  updatedRows?: number;
} = {}) {
  const aggregateSequences = new Map<string, number>();
  const commandFindUnique = vi.fn().mockResolvedValue(overrides.existingReceipt ?? null);
  const commandCreate = vi.fn().mockResolvedValue(undefined);
  const commandUpdate = vi.fn().mockResolvedValue(undefined);
  const eventCreateMany = vi.fn().mockResolvedValue({ count: 1 });
  const outboxCreateMany = vi.fn().mockResolvedValue({ count: 1 });
  const taskUpdateMany = vi.fn().mockResolvedValue({ count: overrides.updatedRows ?? 1 });
  const tx = {
    commandReceipt: {
      findUnique: commandFindUnique,
      create: commandCreate,
      update: commandUpdate,
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
    orchestrationEvent: { createMany: eventCreateMany },
    outboxMessage: { createMany: outboxCreateMany },
    task: { updateMany: taskUpdateMany },
  };

  return {
    tx,
    db: { $transaction: vi.fn(async (callback) => callback(tx)) },
    commandFindUnique,
    commandCreate,
    commandUpdate,
    eventCreateMany,
    outboxCreateMany,
    taskUpdateMany,
  };
}

describe("executeIdempotentCommand", () => {
  it("stores projection, event, outbox and command result in one transaction", async () => {
    const fixture = createTransaction();

    const result = await executeIdempotentCommand({
      command,
      aggregate: { type: "task", id: "task_1" },
      db: fixture.db,
      apply: async (tx) => ({
        result: { taskId: "task_1", status: "ready" },
        events: [taskReadyEvent],
        persist: async () => {
          const updated = await fixture.tx.task.updateMany({
            where: { id: "task_1", version: 1 },
            data: { status: "ready", version: 2 },
          });
          return updated.count;
        },
      }),
    });

    expect(result).toEqual({ taskId: "task_1", status: "ready" });
    expect(fixture.eventCreateMany).toHaveBeenCalledTimes(1);
    expect(fixture.eventCreateMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({
        aggregateType: "task",
        aggregateId: "task_1",
        sequence: 1,
        aggregateVersion: 2,
      })],
    });
    expect(fixture.outboxCreateMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({
        id: "outbox:event_1",
        topic: "orchestration.event",
        aggregateType: "task",
        aggregateId: "task_1",
        payload: expect.objectContaining({
          sequence: 1,
          aggregateVersion: 2,
        }),
      })],
    });
    expect(fixture.commandUpdate).toHaveBeenCalledWith({
      where: { id: "command_1" },
      data: expect.objectContaining({
        status: "completed",
        result: { taskId: "task_1", status: "ready" },
      }),
    });
  });

  it("orders aggregate writes before durable events and receipt completion", async () => {
    const fixture = createTransaction();
    const writes: string[] = [];
    fixture.commandCreate.mockImplementation(async () => { writes.push("receipt_started"); });
    fixture.taskUpdateMany.mockImplementation(async () => {
      writes.push("aggregate_persisted");
      return { count: 1 };
    });
    fixture.eventCreateMany.mockImplementation(async () => {
      writes.push("events_appended");
      return { count: 1 };
    });
    fixture.outboxCreateMany.mockImplementation(async () => {
      writes.push("outbox_appended");
      return { count: 1 };
    });
    fixture.commandUpdate.mockImplementation(async () => { writes.push("receipt_completed"); });

    await executeIdempotentCommand({
      command,
      aggregate: { type: "task", id: "task_1" },
      db: fixture.db,
      apply: async () => ({
        result: { taskId: "task_1", status: "ready" },
        events: [taskReadyEvent],
        persist: async () => (await fixture.tx.task.updateMany({})).count,
      }),
    });

    expect(writes).toEqual([
      "receipt_started",
      "aggregate_persisted",
      "events_appended",
      "outbox_appended",
      "receipt_completed",
    ]);
  });

  it("bounds derived outbox IDs when an event ID reaches the schema limit", async () => {
    const fixture = createTransaction();

    await executeIdempotentCommand({
      command,
      aggregate: { type: "task", id: "task_1" },
      db: fixture.db,
      apply: async () => ({
        result: { taskId: "task_1", status: "ready" },
        events: [{ ...taskReadyEvent, id: `event:${"e".repeat(122)}` }],
        persist: async () => 1,
      }),
    });

    const outboxRows = fixture.outboxCreateMany.mock.calls[0]?.[0].data as Array<{ id: string }>;
    expect(outboxRows[0]?.id).toBe("outbox:6066e3768982912195b1b4fc4f92e9afb29f574532f26c6dce1bfa4d54396be3");
  });

  it("returns a stored result without invoking apply for a repeated command", async () => {
    const fixture = createTransaction({
      existingReceipt: {
        id: "command_1",
        status: "completed",
        result: { taskId: "task_1", status: "ready" },
      },
    });
    const apply = vi.fn();

    await expect(executeIdempotentCommand({
      command,
      aggregate: { type: "task", id: "task_1" },
      db: fixture.db,
      apply,
    })).resolves.toEqual({ taskId: "task_1", status: "ready" });

    expect(apply).not.toHaveBeenCalled();
    expect(fixture.commandCreate).not.toHaveBeenCalled();
  });

  it("rejects an optimistic projection update that changed no rows", async () => {
    const fixture = createTransaction({ updatedRows: 0 });

    await expect(executeIdempotentCommand({
      command,
      aggregate: { type: "task", id: "task_1" },
      db: fixture.db,
      apply: async (tx) => ({
        result: { taskId: "task_1" },
        events: [taskReadyEvent],
        persist: async () => (await fixture.tx.task.updateMany({})).count,
      }),
    })).rejects.toMatchObject({ code: "version_conflict" });

    expect(fixture.eventCreateMany).not.toHaveBeenCalled();
  });
});
