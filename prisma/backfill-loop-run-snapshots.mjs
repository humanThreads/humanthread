import "dotenv/config";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { Prisma, PrismaClient } from "@prisma/client";

const terminalStatuses = new Set(["completed", "succeeded", "failed", "cancelled"]);

/**
 * Identify old graph runs that are structurally safe to inspect for a snapshot.
 * Only terminal, root-only graph runs are eligible. SubLoop-capable runs are
 * left null because their historical publication closure is not reconstructable
 * from a single LoopVersion row.
 */
export function planLoopRunSnapshotBackfill(runs) {
  return runs
    .filter((run) => (
      run.engineKind === "graph_v1"
      && terminalStatuses.has(run.status)
      && typeof run.id === "string"
      && typeof run.loopVersionId === "string"
      && run.loopVersion?.graph
      && Array.isArray(run.loopVersion.graph.nodes)
      && (run.loopVersion.loopDefinition?.scope === undefined
        || run.loopVersion.loopDefinition.scope === "project")
      && !run.loopVersion.graph.nodes.some((node) => node?.type === "subloop_call")
    ))
    .map((run) => ({ id: run.id, rootLoopVersionId: run.loopVersionId }));
}

const databaseUrl = process.env.DATABASE_URL?.trim();
async function main() {
  if (!databaseUrl) throw new Error("DATABASE_URL is required to backfill LoopRun snapshots.");
  const prisma = new PrismaClient({ adapter: new PrismaMariaDb(databaseUrl) });
  const apply = process.argv.slice(2).includes("--apply");

  try {
    const runs = await prisma.loopRun.findMany({
      where: {
        engineKind: "graph_v1",
        runGraphSnapshot: { equals: Prisma.DbNull },
      },
      select: {
        id: true,
        engineKind: true,
        status: true,
        loopVersionId: true,
        loopVersion: {
          select: {
            id: true,
            graph: true,
            loopDefinition: { select: { id: true, scope: true } },
          },
        },
      },
    });
    const candidates = planLoopRunSnapshotBackfill(runs);
    console.log(JSON.stringify({
      mode: apply ? "apply" : "dry-run",
      candidates: candidates.length,
      skipped: runs.length - candidates.length,
      updates: [],
    }));
    if (!apply) return;

    const { resolveRunGraphSnapshot } = await import("../packages/orchestration-core/dist/index.js");
    const runsById = new Map(runs.map((run) => [run.id, run]));
    for (const candidate of candidates) {
      const source = runsById.get(candidate.id);
      if (!source?.loopVersion || !source.loopVersionId) {
        throw new Error(`LoopRun source row is missing its LoopVersion: ${candidate.id}`);
      }
      const snapshot = resolveRunGraphSnapshot({
        rootLoopVersionId: source.loopVersionId,
        versions: [{
          loopDefinitionId: source.loopVersion.loopDefinition.id,
          loopVersionId: source.loopVersion.id,
          scope: source.loopVersion.loopDefinition.scope,
          graph: source.loopVersion.graph,
        }],
      });
      const result = await prisma.loopRun.updateMany({
        where: {
          id: source.id,
          runGraphSnapshot: { equals: Prisma.DbNull },
          graphDigest: null,
          snapshotVersion: null,
        },
        data: {
          runGraphSnapshot: snapshot,
          graphDigest: snapshot.graphDigest,
          snapshotVersion: 1,
        },
      });
      if (result.count !== 1) throw new Error(`LoopRun snapshot backfill conflict: ${source.id}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1]?.endsWith("backfill-loop-run-snapshots.mjs")) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
