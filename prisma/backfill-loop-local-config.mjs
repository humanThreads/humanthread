import "dotenv/config";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient } from "@prisma/client";

import {
  buildLoopLocalGrantBackfillWhere,
  planLoopLocalConfigurationBackfill,
  summarizeLoopLocalConfigurationBackfill,
} from "./loop-local-config-backfill-plan.mjs";

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL is required to backfill Loop local configuration.");

const apply = process.argv.slice(2).includes("--apply");
const migratedAt = process.env.LOOP_LOCAL_CONFIG_MIGRATED_AT?.trim() || new Date().toISOString();
const batchSize = 100;
const prisma = new PrismaClient({ adapter: new PrismaMariaDb(databaseUrl) });

async function main() {
  const [projects, grants] = await Promise.all([
    prisma.project.findMany({ select: { id: true, localPath: true } }),
    prisma.automationGrant.findMany({
      select: { id: true, status: true, version: true, revokedAt: true, scope: true },
    }),
  ]);
  const input = {
    projects,
    grants: grants.map((grant) => ({
      ...grant,
      revokedAt: grant.revokedAt?.toISOString() ?? null,
    })),
    migratedAt,
  };
  const plan = planLoopLocalConfigurationBackfill(input);
  const summary = summarizeLoopLocalConfigurationBackfill(input);
  console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", summary, warnings: plan.warnings, errors: plan.errors }));
  if (plan.errors.length > 0) {
    process.exitCode = 1;
    return;
  }
  if (!apply) return;

  for (let offset = 0; offset < plan.grantUpdates.length; offset += batchSize) {
    const batch = plan.grantUpdates.slice(offset, offset + batchSize);
    await prisma.$transaction(async (tx) => {
      for (const update of batch) {
        const result = await tx.automationGrant.updateMany({
          where: buildLoopLocalGrantBackfillWhere(update),
          data: {
            status: update.status,
            version: update.version,
            revokedAt: new Date(update.revokedAt),
            scope: update.scope,
          },
        });
        if (result.count !== 1) throw new Error(`Loop local configuration migration conflict: ${update.id}`);
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
