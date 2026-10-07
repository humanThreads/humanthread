import type { PublishedSnapshotLoopVersionInput } from "@humanthread/orchestration-core";
import { prisma } from "./prisma";

interface SnapshotCatalogDb {
  project: {
    findUnique(args: {
      where: { id: string };
      select: { spaceId: true };
    }): Promise<{ spaceId: string | null } | null>;
  };
  loopVersion: {
    findMany(args: unknown): Promise<Array<{
      id: string;
      loopDefinitionId: string;
      graph: unknown;
      loopDefinition: { scope: string };
    }>>;
  };
}

export async function readPublishedLoopVersionsForProject(
  projectId: string,
  db: SnapshotCatalogDb = prisma as unknown as SnapshotCatalogDb,
): Promise<PublishedSnapshotLoopVersionInput[]> {
  const project = await db.project.findUnique({
    where: { id: projectId },
    select: { spaceId: true },
  });
  if (!project?.spaceId) return [];

  const rows = await db.loopVersion.findMany({
    where: {
      status: "published",
      loopDefinition: { OR: [{ spaceId: project.spaceId }, { origin: "platform" }] },
    },
    select: {
      id: true,
      loopDefinitionId: true,
      graph: true,
      loopDefinition: { select: { scope: true } },
    },
    orderBy: [{ id: "asc" }],
  });
  return rows.flatMap((row) => (
    row.loopDefinition.scope === "project" || row.loopDefinition.scope === "task"
      ? [{
          loopDefinitionId: row.loopDefinitionId,
          loopVersionId: row.id,
          scope: row.loopDefinition.scope,
          graph: row.graph as PublishedSnapshotLoopVersionInput["graph"],
        } as PublishedSnapshotLoopVersionInput]
      : []
  ));
}
