import "dotenv/config";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient } from "@prisma/client";
import {
  planOrchestrationEventBackfill,
  reconcileOrchestrationAggregateSequences,
  summarizeOrchestrationEventBackfill,
} from "./orchestration-event-backfill-plan.mjs";

const databaseUrl = process.env.DATABASE_URL?.trim();

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required to backfill orchestration events.");
}

const prisma = new PrismaClient({ adapter: new PrismaMariaDb(databaseUrl) });

async function main() {
  const [taskEvents, existingEvents] = await Promise.all([
    prisma.taskEvent.findMany({
      orderBy: [{ taskId: "asc" }, { createdAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        taskId: true,
        workflowInstanceId: true,
        type: true,
        actorType: true,
        actorUserId: true,
        message: true,
        payload: true,
        createdAt: true,
      },
    }),
    prisma.orchestrationEvent.findMany({
      select: {
        id: true,
        aggregateType: true,
        aggregateId: true,
        sequence: true,
      },
    }),
  ]);
  const plan = planOrchestrationEventBackfill({
    taskEvents,
    existingEvents,
  });
  const summary = summarizeOrchestrationEventBackfill(plan);

  if (plan.errors.length > 0) {
    console.error(JSON.stringify({ summary, errors: plan.errors }));
    process.exitCode = 1;
    return;
  }

  const sequenceSummary = await prisma.$transaction(async (tx) => {
    if (plan.events.length > 0) {
      await tx.orchestrationEvent.createMany({ data: plan.events });
      await tx.outboxMessage.createMany({
        data: plan.events.map((event) => ({
          id: `outbox:${event.id}`,
          topic: "orchestration.event",
          aggregateType: event.aggregateType,
          aggregateId: event.aggregateId,
          payload: event,
          availableAt: event.occurredAt,
        })),
      });
    }
    return reconcileOrchestrationAggregateSequences(tx);
  });

  console.log(JSON.stringify({ summary: { ...summary, sequenceSummary } }));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
