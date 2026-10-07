import "dotenv/config";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient } from "@prisma/client";
import {
  planUserTaskBackfill,
  summarizeUserTaskBackfill,
} from "./user-task-backfill-plan.mjs";

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL is required to backfill user tasks.");

const prisma = new PrismaClient({ adapter: new PrismaMariaDb(databaseUrl) });

async function main() {
  const tasks = await prisma.task.findMany({
    select: {
      id: true,
      title: true,
      description: true,
      status: true,
      spaceId: true,
      createdById: true,
      statusCategory: true,
      visibility: true,
      contentMarkdown: true,
      acceptanceMode: true,
      executionMode: true,
      acceptancePolicy: true,
      createdAt: true,
      project: {
        select: {
          id: true,
          space: { select: { id: true, type: true } },
        },
      },
      workflowInstance: {
        select: { id: true, title: true, createdById: true },
      },
      stepTemplate: { select: { title: true } },
      events: {
        orderBy: { createdAt: "asc" },
        select: { actorUserId: true, message: true, createdAt: true },
      },
      blockers: { select: { id: true } },
    },
  });

  const plan = planUserTaskBackfill({ tasks });
  const summary = summarizeUserTaskBackfill(plan);
  if (plan.errors.length > 0) {
    console.error(JSON.stringify({ summary, errors: plan.errors }));
    process.exitCode = 1;
    return;
  }

  await prisma.$transaction(async (tx) => {
    for (const task of plan.tasks) {
      const result = await tx.task.updateMany({
        where: { id: task.taskId },
        data: {
          spaceId: task.spaceId,
          createdById: task.createdById,
          statusCategory: task.statusCategory,
          visibility: task.visibility,
          contentMarkdown: task.contentMarkdown,
          acceptanceMode: task.acceptanceMode,
          title: task.title,
        },
      });
      if (result.count !== 1) throw new Error(`User task migration conflict: ${task.taskId}`);
    }

    for (const blocker of plan.blockers) {
      await tx.taskBlocker.create({
        data: {
          id: blocker.id,
          taskId: blocker.taskId,
          reason: blocker.reason,
          status: blocker.status,
          createdById: blocker.createdById,
          createdAt: blocker.createdAt,
        },
      });
    }
  });

  console.log(JSON.stringify({ summary }));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
