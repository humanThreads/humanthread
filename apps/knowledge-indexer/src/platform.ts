import { prisma } from "@humanthread/db";
import type { KnowledgeVersionSnapshot } from "@humanthread/knowledge-indexer";

export interface PlatformKnowledgeIndexJob {
  id: string;
  projectDigest: string;
  batchId: string;
  embeddingProfileId: string;
  chunkerVersion: string;
  indexVersion: number;
  status: string;
  stage: string;
  failedStage: string | null;
  version: number;
}

async function finalizeBatchAndJob(
  tx: {
    knowledgeBatch: {
      findUnique(args: { where: { id: string } }): Promise<{ id: string; jobId: string } | null>;
      updateMany(args: { where: Record<string, unknown>; data: Record<string, unknown> }): Promise<{ count: number }>;
    };
    knowledgeJob: {
      updateMany(args: { where: Record<string, unknown>; data: Record<string, unknown> }): Promise<{ count: number }>;
    };
  },
  batchId: string,
  now: Date,
): Promise<void> {
  const batch = await tx.knowledgeBatch.findUnique({ where: { id: batchId } });
  if (!batch) throw Object.assign(new Error("Knowledge batch not found while activating its index"), { code: "not_found" });
  await tx.knowledgeBatch.updateMany({
    where: { id: batch.id },
    data: { status: "searchable", progress: 100, completedAt: now, version: { increment: 1 }, updatedAt: now },
  });
  await tx.knowledgeJob.updateMany({
    where: { id: batch.jobId, status: "ingesting" },
    data: { status: "searchable", version: { increment: 1 }, updatedAt: now },
  });
}

export function createPlatformKnowledgeIndexStore() {
  return {
    async claim(jobId: string): Promise<PlatformKnowledgeIndexJob | null> {
      const job = await prisma.knowledgeIndexJob.findUnique({ where: { id: jobId } });
      if (!job || job.status !== "queued") return null;
      const updated = await prisma.knowledgeIndexJob.updateMany({
        where: { id: jobId, status: "queued", version: job.version },
        data: {
          status: "running",
          stage: "chunking",
          claimedAt: new Date(),
          heartbeatAt: new Date(),
          version: { increment: 1 },
        },
      });
      if (updated.count !== 1) return null;
      const claimed = await prisma.knowledgeIndexJob.findUniqueOrThrow({ where: { id: jobId } });
      return {
        id: claimed.id,
        projectDigest: claimed.projectDigest,
        batchId: claimed.batchId,
        embeddingProfileId: claimed.embeddingProfileId,
        chunkerVersion: claimed.chunkerVersion,
        indexVersion: claimed.indexVersion,
        status: claimed.status,
        stage: claimed.stage,
        failedStage: claimed.failedStage,
        version: claimed.version,
      };
    },
    async recordProgress(jobId: string, stage: string, processed: number, total: number, version: number): Promise<number> {
      const progress = total === 0 ? 100 : Math.floor((processed / total) * 100);
      const updated = await prisma.knowledgeIndexJob.updateMany({
        where: { id: jobId, status: "running", version },
        data: { stage, progress, processedChunks: processed, totalChunks: total, heartbeatAt: new Date(), version: { increment: 1 } },
      });
      if (updated.count !== 1) throw Object.assign(new Error("Knowledge index job changed while updating progress"), { code: "version_conflict" });
      return version + 1;
    },
    async complete(jobId: string, input: { indexVersionId: string; collectionName: string; aliasName: string; pointCount: number }): Promise<void> {
      const job = await prisma.knowledgeIndexJob.findUniqueOrThrow({ where: { id: jobId } });
      const now = new Date();
      await prisma.$transaction(async (tx) => {
        await tx.knowledgeIndexVersion.upsert({
          where: { id: input.indexVersionId },
          create: {
            id: input.indexVersionId,
            projectDigest: job.projectDigest,
            embeddingProfileId: job.embeddingProfileId,
            chunkerVersion: job.chunkerVersion,
            indexVersion: job.indexVersion,
            collectionName: input.collectionName,
            aliasName: input.aliasName,
            status: "active",
            pointCount: input.pointCount,
            activatedAt: now,
          },
          update: { status: "active", pointCount: input.pointCount, activatedAt: now },
        });
        await tx.knowledgeIndexJob.update({
          where: { id: jobId },
          data: { status: "active", stage: "active", indexVersionId: input.indexVersionId, progress: 100, heartbeatAt: now },
        });
        await tx.knowledgeEntry.updateMany({
          where: { projectDigest: job.projectDigest, status: "published" },
          data: { searchable: true },
        });
        await finalizeBatchAndJob(tx, job.batchId, now);
      });
    },
    async fail(jobId: string, input: { stage: string; failureClass: "transient" | "input" | "permanent"; failureMessage: string }): Promise<void> {
      await prisma.knowledgeIndexJob.updateMany({
        where: { id: jobId, status: "running" },
        data: {
          status: "failed",
          stage: input.stage,
          failedStage: input.stage,
          failureClass: input.failureClass,
          failureMessage: input.failureMessage.slice(0, 2_000),
          heartbeatAt: new Date(),
          version: { increment: 1 },
        },
      });
    },
    async loadVersions(job: PlatformKnowledgeIndexJob): Promise<KnowledgeVersionSnapshot[]> {
      const entries = await prisma.knowledgeEntry.findMany({
        where: { projectDigest: job.projectDigest, status: "published", publishedVersion: { not: null } },
        select: { id: true, stableKey: true, entryType: true, publishedVersion: true },
      });
      if (entries.length === 0) return [];
      const versions = await prisma.knowledgeEntryVersion.findMany({
        where: {
          OR: entries.map((entry) => ({ entryId: entry.id, version: entry.publishedVersion! })),
          status: "published",
        },
      });
      const byEntry = new Map(versions.map((version) => [`${version.entryId}:${version.version}`, version]));
      return entries.flatMap((entry) => {
        const version = byEntry.get(`${entry.id}:${entry.publishedVersion}`);
        if (!version) return [];
        return [{
          entryId: entry.id,
          stableKey: entry.stableKey,
          version: version.version,
          title: version.title,
          entryType: entry.entryType,
          summary: version.summary,
          bodyMarkdown: version.bodyMarkdown,
          tags: Array.isArray(version.tags) ? version.tags.filter((tag): tag is string => typeof tag === "string") : [],
          status: "published" as const,
        }];
      });
    },
  };
}
