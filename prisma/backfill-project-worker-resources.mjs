import "dotenv/config";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { Prisma, PrismaClient } from "@prisma/client";
import { planProjectWorkerResourceBackfill } from "./project-worker-resource-backfill-plan.mjs";

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL is required to backfill Project Worker resources.");
const apply = process.argv.slice(2).includes("--apply");
const prisma = new PrismaClient({ adapter: new PrismaMariaDb(databaseUrl) });

async function main() {
  const [projects, bindings] = await Promise.all([
    prisma.project.findMany({ select: { id: true, version: true, workerPoolId: true, workerRepositoryUrl: true, workerBranchPolicy: true } }),
    prisma.projectLoopBinding.findMany({ select: { projectId: true, workerPoolId: true, workerRepositoryUrl: true, workerBranchPolicy: true } }),
  ]);
  const plan = planProjectWorkerResourceBackfill({ projects, bindings });
  console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", updates: plan.updates.length, warnings: plan.warnings }));
  if (!apply) return;
  for (const update of plan.updates) {
    const result = await prisma.project.updateMany({
      where: {
        id: update.id,
        version: update.version,
        workerPoolId: null,
        workerRepositoryUrl: null,
        workerBranchPolicy: { equals: Prisma.DbNull },
      },
      data: {
        workerPoolId: update.workerPoolId,
        workerRepositoryUrl: update.workerRepositoryUrl,
        workerBranchPolicy: update.workerBranchPolicy,
        version: update.version + 1,
      },
    });
    if (result.count !== 1) throw new Error(`Project Worker resource backfill conflict: ${update.id}`);
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => prisma.$disconnect());
