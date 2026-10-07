import "dotenv/config";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient } from "@prisma/client";
import {
  buildLoopEngineBackfillWhere,
  planLoopEngineBackfill,
  summarizeLoopEngineBackfill,
} from "./loop-engine-backfill-plan.mjs";

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL is required to backfill Loop Engine runs.");

const apply = process.argv.slice(2).includes("--apply");
const batchSize = 100;
const prisma = new PrismaClient({ adapter: new PrismaMariaDb(databaseUrl) });

async function main() {
  const [runs, agentRuns] = await Promise.all([
    prisma.loopRun.findMany({
      select: { id: true, taskId: true, projectId: true, engineKind: true },
    }),
    prisma.agentRun.findMany({
      select: { id: true, taskId: true, loopNodeRunId: true },
    }),
  ]);
  const taskIds = [...new Set(runs.flatMap((run) => run.taskId ? [run.taskId] : []))];
  const tasks = taskIds.length === 0
    ? []
    : await prisma.task.findMany({
        where: { id: { in: taskIds } },
        select: { id: true, projectId: true },
      });
  const input = { runs, tasks, agentRuns };
  const plan = planLoopEngineBackfill(input);
  const summary = summarizeLoopEngineBackfill(input);

  console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", summary, errors: plan.errors }));
  if (plan.errors.length > 0) {
    process.exitCode = 1;
    return;
  }
  if (!apply) return;

  const runsById = new Map(runs.map((run) => [run.id, run]));
  for (let offset = 0; offset < plan.updates.length; offset += batchSize) {
    const batch = plan.updates.slice(offset, offset + batchSize);
    await prisma.$transaction(async (tx) => {
      for (const update of batch) {
        const source = runsById.get(update.id);
        if (!source) throw new Error(`Loop Engine source row disappeared: ${update.id}`);
        const result = await tx.loopRun.updateMany({
          where: buildLoopEngineBackfillWhere(source),
          data: {
            projectId: update.projectId,
            engineKind: update.engineKind,
          },
        });
        if (result.count !== 1) throw new Error(`Loop Engine migration conflict: ${update.id}`);
      }
    });
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
