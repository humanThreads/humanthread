import "dotenv/config";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient } from "@prisma/client";
import {
  planDevelopmentModeBackfill,
  summarizeDevelopmentModeBackfill,
} from "./development-mode-backfill-plan.mjs";

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL is required to backfill development modes.");

const apply = process.argv.slice(2).includes("--apply");
const prisma = new PrismaClient({ adapter: new PrismaMariaDb(databaseUrl) });

async function main() {
  const projects = await prisma.project.findMany({
    select: {
      id: true,
      developmentTemplateKey: true,
      developmentTemplateVersion: true,
      developmentTemplateConfig: true,
      productionBranch: true,
      stagingBranch: true,
      releaseAgentProfileId: true,
    },
  });
  const input = { projects };
  const plan = planDevelopmentModeBackfill(input);
  const summary = summarizeDevelopmentModeBackfill(input);

  console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", summary, errors: plan.errors }));
  if (plan.errors.length > 0) {
    process.exitCode = 1;
    return;
  }

  // Existing Projects deliberately remain unconfigured. --apply is an explicit no-op.
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
