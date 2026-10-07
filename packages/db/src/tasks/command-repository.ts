import { createEventEnvelope } from "@humanthread/orchestration-core";
import type { OrchestrationCommand } from "@humanthread/shared";
import {
  appendOrchestrationEvents,
  OrchestrationPersistenceError,
  type OrchestrationEventsTx,
} from "../orchestration-events";
import { boundedPersistenceId } from "../bounded-id";
import { prisma } from "../prisma";

export interface TaskCommandTx extends OrchestrationEventsTx {
  project: {
    findUnique(args: unknown): Promise<{ id: string; shortCode: string | null; nextTaskNumber: number } | null>;
    update(args: unknown): Promise<{ id: string; shortCode: string | null; nextTaskNumber: number }>;
  };
  task: {
    create(args: unknown): Promise<unknown>;
    updateMany(args: unknown): Promise<{ count: number }>;
  };
  projectTaskFieldDefinition: {
    findMany(args: unknown): Promise<unknown[]>;
  };
  taskFieldValue: {
    deleteMany(args: unknown): Promise<{ count: number }>;
    createMany(args: unknown): Promise<{ count: number }>;
  };
  taskMember: {
    upsert(args: unknown): Promise<unknown>;
    deleteMany(args: unknown): Promise<{ count: number }>;
  };
  taskBlocker: {
    create(args: unknown): Promise<unknown>;
    updateMany(args: unknown): Promise<{ count: number }>;
  };
  taskWorkflowLink: {
    create(args: unknown): Promise<unknown>;
  };
  taskComment: {
    create(args: unknown): Promise<unknown>;
  };
  taskReminder: {
    create(args: unknown): Promise<unknown>;
    deleteMany(args: unknown): Promise<{ count: number }>;
  };
  taskLabel: {
    findUnique(args: unknown): Promise<{ id: string; spaceId: string } | null>;
  };
  taskLabelAssignment: {
    upsert(args: unknown): Promise<unknown>;
    deleteMany(args: unknown): Promise<{ count: number }>;
  };
  checkDefinition: {
    upsert(args: unknown): Promise<unknown>;
  };
  checkResult: {
    create(args: unknown): Promise<unknown>;
  };
  taskActivity: {
    create(args: { data: Record<string, unknown> }): Promise<unknown>;
  };
  orchestrationAggregateSequence: {
    upsert(args: {
      where: { aggregateType_aggregateId: { aggregateType: string; aggregateId: string } };
      create: { aggregateType: string; aggregateId: string; sequence: number };
      update: { sequence: { increment: number } };
      select: { sequence: true };
    }): Promise<{ sequence: number }>;
  };
}

export interface TaskCommandDb {
  $transaction<T>(callback: (tx: TaskCommandTx) => Promise<T>): Promise<T>;
}

export interface TaskCommandActivity {
  id: string;
  type: string;
  actorType: string;
  actorUserId?: string;
  message?: string;
  payload?: unknown;
}

export async function executeTaskCommand<TResult>(input: {
  command: OrchestrationCommand<unknown> & { expectedVersion: number };
  taskId: string;
  eventType: string;
  eventPayload?: unknown;
  activity: TaskCommandActivity;
  db?: TaskCommandDb;
  persist(tx: TaskCommandTx): Promise<{ rows: number; result: TResult }>;
}): Promise<TResult> {
  const db = input.db ?? (prisma as unknown as TaskCommandDb);
  return db.$transaction(async (tx) => {
    const existing = await tx.commandReceipt.findUnique({
      where: { id: input.command.commandId },
    });
    if (existing?.status === "completed") return existing.result as TResult;
    if (existing) {
      throw new OrchestrationPersistenceError(
        "validation_failed",
        `Command is already ${existing.status}: ${input.command.commandId}`,
      );
    }

    await tx.commandReceipt.create({
      data: {
        id: input.command.commandId,
        aggregateType: "task",
        aggregateId: input.taskId,
        status: "processing",
        createdAt: input.command.issuedAt,
      },
    });

    const applied = await input.persist(tx);
    if (applied.rows === 0) {
      throw new OrchestrationPersistenceError(
        "version_conflict",
        `Task changed while processing command: ${input.command.commandId}`,
      );
    }

    const nextVersion = input.command.expectedVersion + 1;
    await tx.taskActivity.create({
      data: {
        id: input.activity.id,
        taskId: input.taskId,
        type: input.activity.type,
        actorType: input.activity.actorType,
        ...(input.activity.actorUserId ? { actorUserId: input.activity.actorUserId } : {}),
        ...(input.activity.message ? { message: input.activity.message } : {}),
        ...(input.activity.payload === undefined ? {} : { payload: input.activity.payload }),
        correlationId: input.command.correlationId,
        createdAt: input.command.issuedAt,
      },
    });
    const aggregateSequence = await tx.orchestrationAggregateSequence.upsert({
      where: {
        aggregateType_aggregateId: {
          aggregateType: "task",
          aggregateId: input.taskId,
        },
      },
      create: { aggregateType: "task", aggregateId: input.taskId, sequence: 1 },
      update: { sequence: { increment: 1 } },
      select: { sequence: true },
    });

    const event = createEventEnvelope({
      id: boundedPersistenceId("event", [input.command.commandId, input.eventType]),
      eventType: input.eventType,
      aggregate: { type: "task", id: input.taskId, version: nextVersion },
      sequence: aggregateSequence.sequence,
      correlationId: input.command.correlationId,
      ...(input.command.causationId ? { causationId: input.command.causationId } : {}),
      commandId: input.command.commandId,
      actor: input.command.actor,
      occurredAt: input.command.issuedAt,
      payload: input.eventPayload ?? {},
    });
    await appendOrchestrationEvents(tx, [event]);
    await tx.commandReceipt.update({
      where: { id: input.command.commandId },
      data: {
        status: "completed",
        result: applied.result,
        completedAt: input.command.issuedAt,
      },
    });
    return applied.result;
  });
}
