import type { Prisma, PrismaClient } from "@prisma/client";
import type { CreateWorkflowInstanceResult } from "@humanthread/workflow-core";
import { mapCreateWorkflowInstanceResultToPrisma } from "./persistence";
import { appendLegacyTaskEvents } from "./legacy-task-events";

export interface WorkflowPersistenceDb {
  $transaction<T>(
    callback: (tx: WorkflowPersistenceTx) => Promise<T>,
  ): Promise<T>;
}

export interface WorkflowPersistenceTx {
  workflowInstance: {
    create(args: unknown): Promise<unknown>;
  };
  task: {
    createMany(args: unknown): Promise<unknown>;
  };
  taskEvent: {
    createMany(args: unknown): Promise<unknown>;
  };
  orchestrationAggregateSequence?: Parameters<typeof appendLegacyTaskEvents>[0]["tx"]["orchestrationAggregateSequence"];
  orchestrationEvent?: Parameters<typeof appendLegacyTaskEvents>[0]["tx"]["orchestrationEvent"];
  outboxMessage?: Parameters<typeof appendLegacyTaskEvents>[0]["tx"]["outboxMessage"];
}

export interface CreateWorkflowInstanceRecordsInput {
  db: WorkflowPersistenceDb;
  teamId: string;
  result: CreateWorkflowInstanceResult;
}

export async function createWorkflowInstanceRecords(
  input: CreateWorkflowInstanceRecordsInput,
): Promise<void> {
  const mapped = mapCreateWorkflowInstanceResultToPrisma({
    teamId: input.teamId,
    result: input.result,
  });

  await input.db.$transaction(async (tx: WorkflowPersistenceTx) => {
    await tx.workflowInstance.create({
      data: mapped.workflow,
    });

    await tx.task.createMany({
      data: mapped.tasks,
    });

    await tx.taskEvent.createMany({
      data: mapped.events,
    });

    if (
      tx.orchestrationAggregateSequence &&
      tx.orchestrationEvent &&
      tx.outboxMessage
    ) {
      const eventsByTask = new Map<string, typeof input.result.events>();
      for (const event of input.result.events) {
        const taskEvents = eventsByTask.get(event.taskId) ?? [];
        taskEvents.push(event);
        eventsByTask.set(event.taskId, taskEvents);
      }
      for (const events of eventsByTask.values()) {
        await appendLegacyTaskEvents({
          tx: {
            orchestrationAggregateSequence: tx.orchestrationAggregateSequence,
            orchestrationEvent: tx.orchestrationEvent,
            outboxMessage: tx.outboxMessage,
          },
          events,
        });
      }
    }
  });
}

export async function createWorkflowInstanceRecordsWithPrisma(input: {
  prisma: PrismaClient;
  teamId: string;
  result: CreateWorkflowInstanceResult;
}): Promise<void> {
  const dbAdapter: WorkflowPersistenceDb = {
    $transaction: async <T,>(
      callback: (tx: WorkflowPersistenceTx) => Promise<T>,
    ) =>
      input.prisma.$transaction(async (tx) =>
        callback({
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
        }),
      ),
  };

  await createWorkflowInstanceRecords({
    db: dbAdapter,
    teamId: input.teamId,
    result: input.result,
  });
}
