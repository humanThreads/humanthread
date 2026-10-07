import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import {
  PLATFORM_LOOP_DEFINITIONS,
  buildPlatformLoopVersionWriteData,
} from "./development-mode-seed-data.mjs";

const CURRENT_PLATFORM_LOOPS = PLATFORM_LOOP_DEFINITIONS.filter((loop) => loop.latest !== false);

export function planLatestPlatformLoopGraphUpdates(input) {
  const definitionsById = new Map(input.definitions.map((definition) => [definition.id, definition]));
  const versionsById = new Map(input.versions.map((version) => [version.id, version]));
  const errors = [];
  const updates = [];

  for (const loop of CURRENT_PLATFORM_LOOPS) {
    const definition = definitionsById.get(loop.definitionId);
    const version = versionsById.get(loop.versionId);
    if (!definition) {
      errors.push(`Missing platform LoopDefinition ${loop.definitionId}`);
      continue;
    }
    if (definition.latestPublishedVersionId !== loop.versionId) {
      errors.push(`Platform LoopDefinition ${loop.definitionId} latest pointer is ${definition.latestPublishedVersionId ?? "null"}, expected ${loop.versionId}`);
      continue;
    }
    if (!version || version.loopDefinitionId !== loop.definitionId) {
      errors.push(`Missing current LoopVersion ${loop.versionId} for ${loop.definitionId}`);
      continue;
    }

    const versionData = buildPlatformLoopVersionWriteData(loop);
    const versionNeedsUpdate = version.versionNumber !== versionData.versionNumber
      || version.graphSchemaVersion !== versionData.graphSchemaVersion
      || version.checksum !== versionData.checksum
      || version.maxStages !== versionData.maxStages
      || version.maxRepeatCount !== versionData.maxRepeatCount
      || version.platformMaxTransitions !== versionData.platformMaxTransitions
      || version.publishedByUserId !== versionData.publishedByUserId
      || version.status !== versionData.status;
    const definitionNeedsUpdate = definition.status !== "published"
      || !isDeepStrictEqual(definition.draftGraph, loop.graph);

    if (versionNeedsUpdate || definitionNeedsUpdate) {
      updates.push({
        loopDefinitionId: loop.definitionId,
        loopVersionId: loop.versionId,
        graph: loop.graph,
        versionData,
        versionNeedsUpdate,
        definitionNeedsUpdate,
      });
    }
  }

  return { errors, updates };
}

export async function applyLatestPlatformLoopGraphUpdates(tx, plan) {
  if (plan.errors.length > 0) {
    throw new Error(`Cannot update current platform Loops: ${plan.errors.join("; ")}`);
  }
  for (const update of plan.updates) {
    if (update.versionNeedsUpdate) {
      const version = await tx.loopVersion.updateMany({
        where: {
          id: update.loopVersionId,
          loopDefinitionId: update.loopDefinitionId,
        },
        data: update.versionData,
      });
      if (version.count !== 1) throw new Error(`Current LoopVersion changed during update: ${update.loopVersionId}`);
    }
    if (update.definitionNeedsUpdate) {
      const definition = await tx.loopDefinition.updateMany({
        where: {
          id: update.loopDefinitionId,
          latestPublishedVersionId: update.loopVersionId,
        },
        data: { draftGraph: update.graph, status: "published" },
      });
      if (definition.count !== 1) throw new Error(`Current LoopDefinition changed during update: ${update.loopDefinitionId}`);
    }
  }
}

async function readLatestPlatformLoopRows(prisma) {
  const definitionIds = CURRENT_PLATFORM_LOOPS.map((loop) => loop.definitionId);
  const versionIds = CURRENT_PLATFORM_LOOPS.map((loop) => loop.versionId);
  const [definitions, versions] = await Promise.all([
    prisma.loopDefinition.findMany({
      where: { id: { in: definitionIds } },
      select: { id: true, latestPublishedVersionId: true, draftGraph: true, status: true },
    }),
    prisma.loopVersion.findMany({
      where: { id: { in: versionIds } },
      select: {
        id: true,
        loopDefinitionId: true,
        versionNumber: true,
        graphSchemaVersion: true,
        checksum: true,
        maxStages: true,
        maxRepeatCount: true,
        platformMaxTransitions: true,
        publishedByUserId: true,
        status: true,
      },
    }),
  ]);
  return { definitions, versions };
}

async function main() {
  await import("dotenv/config");
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) throw new Error("DATABASE_URL is required.");

  const [{ PrismaMariaDb }, { PrismaClient }] = await Promise.all([
    import("@prisma/adapter-mariadb"),
    import("@prisma/client"),
  ]);
  const prisma = new PrismaClient({ adapter: new PrismaMariaDb(databaseUrl) });
  const apply = process.argv.slice(2).includes("--apply");
  try {
    const plan = planLatestPlatformLoopGraphUpdates(await readLatestPlatformLoopRows(prisma));
    console.log(JSON.stringify({
      mode: apply ? "apply" : "dry-run",
      candidates: CURRENT_PLATFORM_LOOPS.length,
      updates: plan.updates.map((update) => ({
        loopDefinitionId: update.loopDefinitionId,
        loopVersionId: update.loopVersionId,
        graphSchemaVersion: update.versionData.graphSchemaVersion,
      })),
      errors: plan.errors,
    }, null, 2));
    if (plan.errors.length > 0) {
      process.exitCode = 1;
      return;
    }
    if (apply && plan.updates.length > 0) {
      await prisma.$transaction((tx) => applyLatestPlatformLoopGraphUpdates(tx, plan));
    }
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  await main();
}
