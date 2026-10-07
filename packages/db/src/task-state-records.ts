import type { Prisma, PrismaClient } from "@prisma/client";
import type { TaskEvent } from "@humanthread/shared";
import type {
  BlockTaskResult,
  CompleteTaskResult,
  FollowUpTaskResult,
  InterruptTaskResult,
    StartTaskResult,
  TransferTaskResult,
} from "@humanthread/workflow-core";
import { appendLegacyTaskEvents } from "./legacy-task-events";

export interface TaskStatePersistenceDb {
  $transaction<T>(
    callback: (tx: TaskStatePersistenceTx) => Promise<T>,
  ): Promise<T>;
}

export interface TaskStatePersistenceTx {
  workflowInstance: {
    update(args: unknown): Promise<unknown>;
  };
  task: {
    update(args: unknown): Promise<unknown>;
    create?(args: unknown): Promise<unknown>;
  };
  taskEvent: {
    createMany(args: unknown): Promise<unknown>;
  };
  orchestrationAggregateSequence?: Parameters<typeof appendLegacyTaskEvents>[0]["tx"]["orchestrationAggregateSequence"];
  orchestrationEvent?: Parameters<typeof appendLegacyTaskEvents>[0]["tx"]["orchestrationEvent"];
  outboxMessage?: Parameters<typeof appendLegacyTaskEvents>[0]["tx"]["outboxMessage"];
}

function mapEvents(events: TaskEvent[]) {
  return events.map((event) => ({
    id: event.id,
    taskId: event.taskId,
    workflowInstanceId: event.workflowInstanceId,
    type: event.type,
    actorType: event.actorType,
    ...(event.actorUserId ? { actorUserId: event.actorUserId } : {}),
    ...(event.message ? { message: event.message } : {}),
    ...(event.payload !== undefined ? { payload: event.payload } : {}),
    createdAt: event.createdAt,
  }));
}

async function appendOrchestrationEventsWhenAvailable(
  tx: TaskStatePersistenceTx,
  events: TaskEvent[],
): Promise<void> {
  if (
    !tx.orchestrationAggregateSequence ||
    !tx.orchestrationEvent ||
    !tx.outboxMessage
  ) {
    return;
  }

  await appendLegacyTaskEvents({
    tx: {
      orchestrationAggregateSequence: tx.orchestrationAggregateSequence,
      orchestrationEvent: tx.orchestrationEvent,
      outboxMessage: tx.outboxMessage,
    },
    events,
  });
}

async function persistSingleTaskStatusResult(input: {
  db: TaskStatePersistenceDb;
  workflow: {
    id: string;
    status?: string;
    currentStepKey?: string;
    updatedAt: Date;
  };
  task: {
    id: string;
    status: string;
    updatedAt: Date;
    startedAt?: Date;
    completedAt?: Date;
  };
  events: TaskEvent[];
}): Promise<void> {
  await input.db.$transaction(async (tx) => {
    const workflowData: Record<string, unknown> = {
      updatedAt: input.workflow.updatedAt,
    };

    if (input.workflow.status) {
      workflowData.status = input.workflow.status;
    }

    if (input.workflow.currentStepKey) {
      workflowData.currentStepKey = input.workflow.currentStepKey;
    }

    await tx.workflowInstance.update({
      where: { id: input.workflow.id },
      data: workflowData,
    });

    const taskData: Record<string, unknown> = {
      status: input.task.status,
      updatedAt: input.task.updatedAt,
    };

    if (input.task.startedAt) {
      taskData.startedAt = input.task.startedAt;
    }

    if (input.task.completedAt) {
      taskData.completedAt = input.task.completedAt;
    }

    await tx.task.update({
      where: { id: input.task.id },
      data: taskData,
    });

    await tx.taskEvent.createMany({
      data: mapEvents(input.events),
    });
    await appendOrchestrationEventsWhenAvailable(tx, input.events);
  });
}

export async function persistStartedTaskResult(input: {
  db: TaskStatePersistenceDb;
  result: StartTaskResult;
}): Promise<void> {
  await persistSingleTaskStatusResult({
    db: input.db,
    workflow: input.result.workflow,
    task: input.result.task,
    events: input.result.events,
  });
}

export async function persistCompletedTaskResult(input: {
  db: TaskStatePersistenceDb;
  teamId: string;
  result: CompleteTaskResult;
}): Promise<void> {
  await input.db.$transaction(async (tx) => {
    await tx.workflowInstance.update({
      where: { id: input.result.workflow.id },
      data: {
        currentStepKey: input.result.workflow.currentStepKey,
        status: input.result.workflow.status,
        updatedAt: input.result.workflow.updatedAt,
      },
    });

    await tx.task.update({
      where: { id: input.result.completedTask.id },
      data: {
        status: input.result.completedTask.status,
        completedAt: input.result.completedTask.completedAt,
        updatedAt: input.result.completedTask.updatedAt,
      },
    });

    if (input.result.nextTask) {
      const nextTask = input.result.nextTask;
      await tx.task.create?.({
        data: {
          id: nextTask.id,
          teamId: input.teamId,
          workflowInstanceId: nextTask.workflowInstanceId,
          projectId: nextTask.projectId,
          stepTemplateId: nextTask.stepTemplateId,
          title: nextTask.title,
          description: nextTask.description,
          status: nextTask.status,
          executorType: nextTask.executorType,
          ...(nextTask.assigneeUserId ? { assigneeUserId: nextTask.assigneeUserId } : {}),
          queuePosition: nextTask.queuePosition,
          ...(nextTask.localPath ? { localPath: nextTask.localPath } : {}),
          ...(nextTask.command ? { command: nextTask.command } : {}),
          ...(nextTask.startedAt ? { startedAt: nextTask.startedAt } : {}),
          ...(nextTask.completedAt ? { completedAt: nextTask.completedAt } : {}),
          createdAt: nextTask.createdAt,
          updatedAt: nextTask.updatedAt,
        },
      });
    }

    await tx.taskEvent.createMany({
      data: mapEvents(input.result.events),
    });
    const eventsByTask = new Map<string, TaskEvent[]>();
    for (const event of input.result.events) {
      const taskEvents = eventsByTask.get(event.taskId) ?? [];
      taskEvents.push(event);
      eventsByTask.set(event.taskId, taskEvents);
    }
    for (const events of eventsByTask.values()) {
      await appendOrchestrationEventsWhenAvailable(tx, events);
    }
  });
}

function createTaskStatePersistenceTx(tx: Prisma.TransactionClient): TaskStatePersistenceTx {
  return {
    workflowInstance: tx.workflowInstance,
    task: tx.task,
    taskEvent: tx.taskEvent,
    orchestrationAggregateSequence: {
      upsert: (args) => tx.orchestrationAggregateSequence.upsert(args),
    },
    orchestrationEvent: {
      createMany: (args) => tx.orchestrationEvent.createMany({
        data: args.data as Prisma.OrchestrationEventCreateManyInput[],
      }),
    },
    outboxMessage: {
      createMany: (args) => tx.outboxMessage.createMany({
        data: args.data as Prisma.OutboxMessageCreateManyInput[],
      }),
    },
  };
}

export async function persistBlockedTaskResult(input: {
  db: TaskStatePersistenceDb;
  result: BlockTaskResult;
}): Promise<void> {
  await persistSingleTaskStatusResult({
    db: input.db,
    workflow: input.result.workflow,
    task: input.result.task,
    events: input.result.events,
  });
}

export async function persistInterruptedTaskResult(input: {
  db: TaskStatePersistenceDb;
  result: InterruptTaskResult;
}): Promise<void> {
  await persistSingleTaskStatusResult({
    db: input.db,
    workflow: input.result.workflow,
    task: input.result.task,
    events: input.result.events,
  });
}

export async function persistFollowUpTaskResult(input: {
  db: TaskStatePersistenceDb;
  result: FollowUpTaskResult;
}): Promise<void> {
  await persistSingleTaskStatusResult({
    db: input.db,
    workflow: input.result.workflow,
    task: input.result.task,
    events: input.result.events,
  });
}

export async function persistTransferTaskResult(input: {
  db: TaskStatePersistenceDb;
  result: TransferTaskResult;
}): Promise<void> {
  await persistSingleTaskStatusResult({
    db: input.db,
    workflow: input.result.workflow,
    task: input.result.task,
    events: input.result.events,
  });
}

export async function persistStartedTaskResultWithPrisma(input: {
  prisma: PrismaClient;
  result: StartTaskResult;
}): Promise<void> {
  const dbAdapter: TaskStatePersistenceDb = {
    $transaction: async <T,>(callback: (tx: TaskStatePersistenceTx) => Promise<T>) =>
      input.prisma.$transaction(async (tx) =>
        callback(createTaskStatePersistenceTx(tx)),
      ),
  };

  await persistStartedTaskResult({
    db: dbAdapter,
    result: input.result,
  });
}

export async function persistBlockedTaskResultWithPrisma(input: {
  prisma: PrismaClient;
  result: BlockTaskResult;
}): Promise<void> {
  const dbAdapter: TaskStatePersistenceDb = {
    $transaction: async <T,>(callback: (tx: TaskStatePersistenceTx) => Promise<T>) =>
      input.prisma.$transaction(async (tx) =>
        callback(createTaskStatePersistenceTx(tx)),
      ),
  };

  await persistBlockedTaskResult({
    db: dbAdapter,
    result: input.result,
  });
}

export async function persistInterruptedTaskResultWithPrisma(input: {
  prisma: PrismaClient;
  result: InterruptTaskResult;
}): Promise<void> {
  const dbAdapter: TaskStatePersistenceDb = {
    $transaction: async <T,>(callback: (tx: TaskStatePersistenceTx) => Promise<T>) =>
      input.prisma.$transaction(async (tx) =>
        callback(createTaskStatePersistenceTx(tx)),
      ),
  };

  await persistInterruptedTaskResult({
    db: dbAdapter,
    result: input.result,
  });
}

export async function persistFollowUpTaskResultWithPrisma(input: {
  prisma: PrismaClient;
  result: FollowUpTaskResult;
}): Promise<void> {
  const dbAdapter: TaskStatePersistenceDb = {
    $transaction: async <T,>(callback: (tx: TaskStatePersistenceTx) => Promise<T>) =>
      input.prisma.$transaction(async (tx) =>
        callback(createTaskStatePersistenceTx(tx)),
      ),
  };

  await persistFollowUpTaskResult({
    db: dbAdapter,
    result: input.result,
  });
}

export async function persistTransferTaskResultWithPrisma(input: {
  prisma: PrismaClient;
  result: TransferTaskResult;
}): Promise<void> {
  const dbAdapter: TaskStatePersistenceDb = {
    $transaction: async <T,>(callback: (tx: TaskStatePersistenceTx) => Promise<T>) =>
      input.prisma.$transaction(async (tx) =>
        callback(createTaskStatePersistenceTx(tx)),
      ),
  };

  await persistTransferTaskResult({
    db: dbAdapter,
    result: input.result,
  });
}

export async function persistCompletedTaskResultWithPrisma(input: {
  prisma: PrismaClient;
  teamId: string;
  result: CompleteTaskResult;
}): Promise<void> {
  const dbAdapter: TaskStatePersistenceDb = {
    $transaction: async <T,>(callback: (tx: TaskStatePersistenceTx) => Promise<T>) =>
      input.prisma.$transaction(async (tx) =>
        callback(createTaskStatePersistenceTx(tx)),
      ),
  };

  await persistCompletedTaskResult({
    db: dbAdapter,
    teamId: input.teamId,
    result: input.result,
  });
}
