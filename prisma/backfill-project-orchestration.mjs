import "dotenv/config";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient } from "@prisma/client";
import {
  planProjectOrchestrationBackfill,
  summarizeProjectOrchestrationBackfill,
} from "./project-orchestration-backfill-plan.mjs";

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL is required to backfill project orchestration.");
const prisma = new PrismaClient({ adapter: new PrismaMariaDb(databaseUrl) });

async function main() {
  const [projects, tasks, stages, milestones] = await Promise.all([
    prisma.project.findMany({ select: { id: true, orchestrationStatus: true, version: true } }),
    prisma.task.findMany({ select: { id: true, projectId: true, milestoneId: true } }),
    prisma.projectStage.findMany({ select: { id: true, projectId: true } }),
    prisma.milestone.findMany({ select: { id: true, projectId: true } }),
  ]);
  const plan = planProjectOrchestrationBackfill({
    projects: projects.map((project) => ({ id: project.id, status: project.orchestrationStatus, version: project.version })),
    tasks,
    stages,
    milestones,
  });
  const summary = summarizeProjectOrchestrationBackfill(plan);
  if (plan.errors.length > 0) {
    console.error(JSON.stringify({ summary, errors: plan.errors }));
    process.exitCode = 1;
    return;
  }

  await prisma.$transaction(async (tx) => {
    for (const project of plan.projects) {
      await tx.project.updateMany({
        where: { id: project.projectId, orchestrationStatus: null },
        data: { orchestrationStatus: project.status, version: project.version },
      });
    }
    for (const stage of plan.stages) {
      await tx.projectStage.create({ data: stage });
    }
    for (const milestone of plan.milestones) {
      await tx.milestone.create({ data: milestone });
    }
    for (const task of plan.tasks) {
      const result = await tx.task.updateMany({
        where: { id: task.taskId, milestoneId: null },
        data: { milestoneId: task.milestoneId },
      });
      if (result.count !== 1) throw new Error(`Task migration conflict: ${task.taskId}`);
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
