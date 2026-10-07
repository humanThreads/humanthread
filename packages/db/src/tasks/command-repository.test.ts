import { describe, expect, it, vi } from "vitest";
import { executeTaskCommand } from "./command-repository";

function transactionDb(input: { receipt?: unknown } = {}) {
  const tx = {
    commandReceipt: {
      findUnique: vi.fn().mockResolvedValue(input.receipt ?? null),
      create: vi.fn().mockResolvedValue(undefined),
      update: vi.fn().mockResolvedValue(undefined),
    },
    task: {
      create: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    taskMember: {
      upsert: vi.fn().mockResolvedValue({}),
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    taskBlocker: {
      create: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    taskWorkflowLink: { create: vi.fn().mockResolvedValue({}) },
    taskComment: { create: vi.fn().mockResolvedValue({}) },
    taskReminder: {
      create: vi.fn().mockResolvedValue({}),
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    taskLabel: { findUnique: vi.fn().mockResolvedValue({ id: "label_1", spaceId: "space_1" }) },
    taskLabelAssignment: {
      upsert: vi.fn().mockResolvedValue({}),
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    taskActivity: { create: vi.fn().mockResolvedValue(undefined) },
    orchestrationAggregateSequence: { upsert: vi.fn().mockResolvedValue({ sequence: 4 }) },
    orchestrationEvent: { createMany: vi.fn().mockResolvedValue(undefined) },
    outboxMessage: { createMany: vi.fn().mockResolvedValue(undefined) },
  };
  return { tx, db: { $transaction: vi.fn(async (callback: (value: typeof tx) => Promise<unknown>) => callback(tx)) } };
}

const command = {
  commandId: "command_1",
  correlationId: "correlation_1",
  actor: { type: "user" as const, id: "user_1" },
  expectedVersion: 3,
  payload: { statusCategory: "in_progress" },
  issuedAt: new Date("2026-07-22T01:00:00.000Z"),
};

describe("task command repository", () => {
  it("persists the task update, activity, event and outbox in one idempotent command", async () => {
    const { tx, db } = transactionDb();
    const result = await executeTaskCommand({
      command,
      taskId: "task_1",
      eventType: "task.started",
      activity: {
        id: "activity_1",
        type: "status_changed",
        actorType: "user",
        actorUserId: "user_1",
        message: "任务开始",
      },
      db,
      persist: async (transaction) => {
        const updated = await transaction.task.updateMany({
          where: { id: "task_1", version: 3 },
          data: { statusCategory: "in_progress", version: { increment: 1 } },
        });
        return { rows: updated.count, result: { taskId: "task_1", version: 4 } };
      },
    });

    expect(result).toEqual({ taskId: "task_1", version: 4 });
    expect(tx.taskActivity.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        id: "activity_1",
        taskId: "task_1",
        type: "status_changed",
        actorUserId: "user_1",
      }),
    });
    expect(tx.orchestrationEvent.createMany).toHaveBeenCalledOnce();
    expect(tx.outboxMessage.createMany).toHaveBeenCalledOnce();
    expect(tx.orchestrationAggregateSequence.upsert).toHaveBeenCalledWith({
      where: { aggregateType_aggregateId: { aggregateType: "task", aggregateId: "task_1" } },
      create: { aggregateType: "task", aggregateId: "task_1", sequence: 1 },
      update: { sequence: { increment: 1 } },
      select: { sequence: true },
    });
    expect(tx.commandReceipt.update).toHaveBeenCalledWith({
      where: { id: "command_1" },
      data: expect.objectContaining({ status: "completed", result }),
    });
  });

  it("allocates the event stream sequence independently from the task version", async () => {
    const { tx, db } = transactionDb();
    tx.orchestrationAggregateSequence.upsert.mockResolvedValue({ sequence: 9 });

    await executeTaskCommand({
      command,
      taskId: "task_1",
      eventType: "task.archived",
      activity: { id: "activity_1", type: "archived", actorType: "user" },
      db,
      persist: async () => ({ rows: 1, result: { taskId: "task_1", version: 4 } }),
    });

    expect(tx.orchestrationAggregateSequence.upsert).toHaveBeenCalledWith({
      where: { aggregateType_aggregateId: { aggregateType: "task", aggregateId: "task_1" } },
      create: { aggregateType: "task", aggregateId: "task_1", sequence: 1 },
      update: { sequence: { increment: 1 } },
      select: { sequence: true },
    });
    expect(tx.orchestrationEvent.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({
        aggregateType: "task",
        aggregateId: "task_1",
        aggregateVersion: 4,
        sequence: 9,
      })],
    });
  });

  it("bounds derived event and outbox IDs for a maximum-length command ID", async () => {
    const { tx, db } = transactionDb();

    await executeTaskCommand({
      command: { ...command, commandId: "c".repeat(128) },
      taskId: "task_1",
      eventType: "task.assigned",
      activity: { id: "activity_1", type: "assigned", actorType: "user" },
      db,
      persist: async () => ({ rows: 1, result: { taskId: "task_1", version: 4 } }),
    });

    const eventRows = tx.orchestrationEvent.createMany.mock.calls[0]?.[0].data as Array<{ id: string }>;
    const outboxRows = tx.outboxMessage.createMany.mock.calls[0]?.[0].data as Array<{ id: string }>;
    expect(eventRows[0]?.id).toBe("event:f171ea087a5d7ace3b79e09b8b92fd11475f352f770740fd60edb491469e1778");
    expect(outboxRows[0]?.id).toBe("outbox:event:f171ea087a5d7ace3b79e09b8b92fd11475f352f770740fd60edb491469e1778");
  });

  it("returns a completed command result without running persistence twice", async () => {
    const { tx, db } = transactionDb({
      receipt: { id: "command_1", status: "completed", result: { taskId: "task_1", version: 4 } },
    });
    const persist = vi.fn();

    await expect(executeTaskCommand({
      command,
      taskId: "task_1",
      eventType: "task.started",
      activity: { id: "activity_1", type: "status_changed", actorType: "user" },
      db,
      persist,
    })).resolves.toEqual({ taskId: "task_1", version: 4 });
    expect(persist).not.toHaveBeenCalled();
    expect(tx.taskActivity.create).not.toHaveBeenCalled();
  });

  it("turns a zero-row optimistic update into version_conflict without activity", async () => {
    const { tx, db } = transactionDb();
    tx.task.updateMany.mockResolvedValue({ count: 0 });

    await expect(executeTaskCommand({
      command,
      taskId: "task_1",
      eventType: "task.started",
      activity: { id: "activity_1", type: "status_changed", actorType: "user" },
      db,
      persist: async (transaction) => {
        const updated = await transaction.task.updateMany({ where: { id: "task_1", version: 3 }, data: {} });
        return { rows: updated.count, result: { taskId: "task_1", version: 4 } };
      },
    })).rejects.toMatchObject({ code: "version_conflict" });
    expect(tx.taskActivity.create).not.toHaveBeenCalled();
  });
});
