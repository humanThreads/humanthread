import "dotenv/config";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient } from "@prisma/client";
import {
  planSpaceBackfill,
  summarizeSpaceBackfill,
} from "./space-backfill-plan.mjs";

const databaseUrl = process.env.DATABASE_URL?.trim();

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required to backfill spaces.");
}

const prisma = new PrismaClient({
  adapter: new PrismaMariaDb(databaseUrl),
});

async function main() {
  const [users, companies, projects] = await Promise.all([
    prisma.user.findMany({ select: { id: true, name: true } }),
    prisma.company.findMany({ select: { id: true, name: true } }),
    prisma.project.findMany({
      select: {
        id: true,
        name: true,
        ownerType: true,
        ownerUserId: true,
        companyId: true,
        spaceId: true,
      },
    }),
  ]);
  const plan = planSpaceBackfill({ users, companies, projects });

  if (plan.errors.length > 0) {
    console.error(JSON.stringify({ summary: summarizeSpaceBackfill(plan), errors: plan.errors }));
    process.exitCode = 1;
    return;
  }

  await prisma.$transaction(async (tx) => {
    for (const space of plan.personalSpaces) {
      await tx.space.upsert({
        where: { ownerUserId: space.ownerUserId },
        update: { name: space.name, status: "active" },
        create: {
          ...space,
          type: "personal",
          companyId: null,
          status: "active",
        },
      });
    }

    for (const space of plan.companySpaces) {
      await tx.space.upsert({
        where: { companyId: space.companyId },
        update: { name: space.name, status: "active" },
        create: {
          ...space,
          type: "company",
          ownerUserId: null,
          status: "active",
        },
      });
    }

    for (const assignment of plan.projectAssignments) {
      await tx.project.updateMany({
        where: { id: assignment.projectId, spaceId: null },
        data: { spaceId: assignment.spaceId },
      });
    }
  });

  console.log(JSON.stringify({ summary: summarizeSpaceBackfill(plan) }));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
