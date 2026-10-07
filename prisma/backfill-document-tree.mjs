import "dotenv/config";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient } from "@prisma/client";
import {
  planDocumentTreeBackfill,
  summarizeDocumentTreeBackfill,
} from "./document-tree-backfill-plan.mjs";

const databaseUrl = process.env.DATABASE_URL?.trim();

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required to backfill the document tree.");
}

const prisma = new PrismaClient({ adapter: new PrismaMariaDb(databaseUrl) });

async function main() {
  const [documents, directories] = await Promise.all([
    prisma.document.findMany({
      select: {
        id: true,
        spaceId: true,
        projectId: true,
        containerKey: true,
        path: true,
        directoryId: true,
        createdById: true,
        updatedById: true,
      },
    }),
    prisma.documentDirectory.findMany({
      select: { id: true, containerKey: true, path: true },
    }),
  ]);
  const plan = planDocumentTreeBackfill({ documents, directories });

  if (plan.errors.length > 0) {
    console.error(JSON.stringify({ summary: summarizeDocumentTreeBackfill(plan), errors: plan.errors }));
    process.exitCode = 1;
    return;
  }

  await prisma.$transaction(async (tx) => {
    for (const directory of plan.directories) {
      await tx.documentDirectory.upsert({
        where: {
          containerKey_path: {
            containerKey: directory.containerKey,
            path: directory.path,
          },
        },
        update: {},
        create: directory,
      });
    }

    for (const assignment of plan.assignments) {
      await tx.document.updateMany({
        where: { id: assignment.documentId, directoryId: null },
        data: {
          directoryId: assignment.directoryId,
          sortOrder: assignment.sortOrder,
        },
      });
    }
  });

  console.log(JSON.stringify({ summary: summarizeDocumentTreeBackfill(plan) }));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
