import "dotenv/config";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient } from "@prisma/client";
import { planProjectRoadmapOrderBackfill } from "./project-roadmap-order-backfill-plan.mjs";

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL is required to backfill Project roadmap order.");
const prisma = new PrismaClient({ adapter: new PrismaMariaDb(databaseUrl) });

async function main() {
  const milestones = await prisma.milestone.findMany({ select: { id: true, stageId: true, sortOrder: true, targetAt: true } });
  const plan = planProjectRoadmapOrderBackfill({ milestones });
  await prisma.$transaction(async (tx) => {
    for (const update of plan.updates) {
      const result = await tx.milestone.updateMany({ where: { id: update.milestoneId }, data: { sortOrder: update.sortOrder } });
      if (result.count !== 1) throw new Error(`Milestone roadmap order conflict: ${update.milestoneId}`);
    }
  });
  console.log(JSON.stringify({ milestones: plan.updates.length }));
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => prisma.$disconnect());
