import "dotenv/config";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient } from "@prisma/client";
import {
  planDocumentBackfill,
  summarizeDocumentBackfill,
} from "./document-backfill-plan.mjs";

const databaseUrl = process.env.DATABASE_URL?.trim();

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required to backfill documents.");
}

const prisma = new PrismaClient({ adapter: new PrismaMariaDb(databaseUrl) });

async function main() {
  const [projects, documents] = await Promise.all([
    prisma.project.findMany({ select: { id: true, spaceId: true } }),
    prisma.document.findMany({
      select: {
        id: true,
        projectId: true,
        spaceId: true,
        containerKey: true,
      },
    }),
  ]);
  const plan = planDocumentBackfill({ projects, documents });

  if (plan.errors.length > 0) {
    console.error(JSON.stringify({ summary: summarizeDocumentBackfill(plan), errors: plan.errors }));
    process.exitCode = 1;
    return;
  }

  await prisma.$transaction(async (tx) => {
    for (const assignment of plan.assignments) {
      await tx.document.updateMany({
        where: {
          id: assignment.documentId,
          spaceId: null,
          containerKey: null,
        },
        data: {
          spaceId: assignment.spaceId,
          containerKey: assignment.containerKey,
        },
      });
    }
  });

  console.log(JSON.stringify({ summary: summarizeDocumentBackfill(plan) }));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
