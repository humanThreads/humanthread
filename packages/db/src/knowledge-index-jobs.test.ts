import { describe, expect, it, vi } from "vitest";

import {
  claimKnowledgeIndexJob,
  completeKnowledgeIndexJob,
  createKnowledgeIndexJob,
  failKnowledgeIndexJob,
  retryKnowledgeIndexJob,
  updateKnowledgeIndexProgress,
} from "./knowledge-index-jobs";
import { knowledgeId } from "./knowledge-reference";

const DIGEST = "a".repeat(32);

type Row = Record<string, unknown> & { id: string };

function fixture() {
  const jobs = new Map<string, Row>();
  const versions = new Map<string, Row>();
  const batches = new Map<string, Row>([
    ["b".repeat(32), { id: "b".repeat(32), jobId: "f".repeat(32), status: "archiving", version: 1 }],
  ]);
  const knowledgeJobs = new Map<string, Row>([
    ["f".repeat(32), { id: "f".repeat(32), status: "ingesting", version: 1 }],
  ]);
  const options: Array<{ maxWait?: number; timeout?: number } | undefined> = [];
  const jobDelegate = {
    findUnique: vi.fn(async ({ where }: { where: { id: string } }) => jobs.get(where.id) ?? null),
    createMany: vi.fn(async ({ data, skipDuplicates }: { data: Row[]; skipDuplicates: boolean }) => {
      let count = 0;
      for (const row of data) {
        if (jobs.has(row.id)) {
          if (skipDuplicates) continue;
          throw new Error("duplicate");
        }
        jobs.set(row.id, row);
        count += 1;
      }
      return { count };
    }),
    updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      const row = jobs.get(String(where.id));
      if (!row || row.status !== where.status || row.version !== where.version) return { count: 0 };
      const next = { ...row };
      for (const [key, value] of Object.entries(data)) {
        next[key] = value && typeof value === "object" && "increment" in value
          ? Number(row[key] ?? 0) + Number((value as { increment: number }).increment)
          : value;
      }
      jobs.set(row.id, next);
      return { count: 1 };
    }),
  };
  const versionDelegate = {
    findUnique: vi.fn(async ({ where }: { where: { id: string } }) => versions.get(where.id) ?? null),
    createMany: vi.fn(async ({ data, skipDuplicates }: { data: Row[]; skipDuplicates: boolean }) => {
      let count = 0;
      for (const row of data) {
        if (versions.has(row.id)) {
          if (skipDuplicates) continue;
          throw new Error("duplicate");
        }
        versions.set(row.id, row);
        count += 1;
      }
      return { count };
    }),
    updateMany: vi.fn(async () => ({ count: 1 })),
  };
  const batchDelegate = {
    findUnique: vi.fn(async ({ where }: { where: { id: string } }) => batches.get(where.id) ?? null),
    updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      const row = batches.get(String(where.id));
      if (!row || ("status" in where && row.status !== where.status)) return { count: 0 };
      batches.set(row.id, applyRowUpdate(row, data));
      return { count: 1 };
    }),
  };
  const knowledgeJobDelegate = {
    updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      const row = knowledgeJobs.get(String(where.id));
      if (!row || row.status !== where.status) return { count: 0 };
      knowledgeJobs.set(row.id, applyRowUpdate(row, data));
      return { count: 1 };
    }),
  };
  const stores = {
    knowledgeIndexJob: jobDelegate,
    knowledgeIndexVersion: versionDelegate,
    knowledgeBatch: batchDelegate,
    knowledgeJob: knowledgeJobDelegate,
  };
  return {
    jobs,
    versions,
    batches,
    knowledgeJobs,
    options,
    db: {
      ...stores,
      $transaction: async <T>(callback: (tx: typeof stores) => Promise<T>, transactionOptions?: { maxWait?: number; timeout?: number }) => {
        options.push(transactionOptions);
        return callback(stores);
      },
    },
  };
}

function applyRowUpdate(row: Row, data: Record<string, unknown>): Row {
  const next = { ...row };
  for (const [key, value] of Object.entries(data)) {
    next[key] = value && typeof value === "object" && "increment" in value
      ? Number(row[key] ?? 0) + Number((value as { increment: number }).increment)
      : value;
  }
  return next;
}

describe("knowledge index job state machine", () => {
  it("creates one deterministic queued job", async () => {
    const dependencies = fixture();
    const input = { projectDigest: DIGEST, batchId: "b".repeat(32), embeddingProfileId: "c".repeat(32), chunkerVersion: "knowledge-chunker/v1" };
    const first = await createKnowledgeIndexJob(input, dependencies.db as never);
    const duplicate = await createKnowledgeIndexJob(input, dependencies.db as never);

    expect(first).toEqual(duplicate);
    expect(first.id).toBe(knowledgeId("knowledge-index-job", input.batchId, input.embeddingProfileId, input.chunkerVersion));
    expect(first).toMatchObject({ status: "queued", stage: "queued", progress: 0, failedStage: null });
    expect(dependencies.options).toEqual([
      { maxWait: 5_000, timeout: 30_000 },
      { maxWait: 5_000, timeout: 30_000 },
    ]);
  });

  it("claims, advances, fails, and retries from the exact failed stage", async () => {
    const dependencies = fixture();
    const created = await createKnowledgeIndexJob({
      projectDigest: DIGEST,
      batchId: "b".repeat(32),
      embeddingProfileId: "c".repeat(32),
      chunkerVersion: "knowledge-chunker/v1",
    }, dependencies.db as never);
    const claimed = await claimKnowledgeIndexJob(created.id, dependencies.db as never);
    expect(claimed).toMatchObject({ status: "running", stage: "chunking" });
    const embedding = await updateKnowledgeIndexProgress({
      id: created.id,
      stage: "embedding",
      processedChunks: 25,
      totalChunks: 100,
      version: claimed!.version,
    }, dependencies.db as never);
    expect(embedding).toMatchObject({ stage: "embedding", progress: 25 });
    const failed = await failKnowledgeIndexJob({
      id: created.id,
      stage: "embedding",
      failureClass: "transient",
      failureMessage: "timeout",
      version: embedding.version,
    }, dependencies.db as never);
    expect(failed).toMatchObject({ status: "failed", stage: "embedding", failedStage: "embedding" });
    const retried = await retryKnowledgeIndexJob({ id: created.id, commandId: "retry_1" }, dependencies.db as never);
    expect(retried).toMatchObject({ status: "running", stage: "embedding", failedStage: null, retryCount: 1 });
  });

  it("activates only from activating and is idempotent", async () => {
    const dependencies = fixture();
    const created = await createKnowledgeIndexJob({
      projectDigest: DIGEST,
      batchId: "b".repeat(32),
      embeddingProfileId: "c".repeat(32),
      chunkerVersion: "knowledge-chunker/v1",
    }, dependencies.db as never);
    const claimed = await claimKnowledgeIndexJob(created.id, dependencies.db as never);
    let current = claimed!;
    current = await updateKnowledgeIndexProgress({ id: created.id, stage: "embedding", processedChunks: 1, totalChunks: 1, version: current.version }, dependencies.db as never);
    current = await updateKnowledgeIndexProgress({ id: created.id, stage: "indexing", processedChunks: 1, totalChunks: 1, version: current.version }, dependencies.db as never);
    current = await updateKnowledgeIndexProgress({ id: created.id, stage: "activating", processedChunks: 1, totalChunks: 1, version: current.version }, dependencies.db as never);

    const active = await completeKnowledgeIndexJob({
      id: created.id,
      indexVersionId: "d".repeat(32),
      embeddingProfileId: "c".repeat(32),
      chunkerVersion: "knowledge-chunker/v1",
      collectionName: `ht-k-${"d".repeat(32)}`,
      aliasName: `ht-k-live-${DIGEST}`,
      pointCount: 1,
      version: current.version,
    }, dependencies.db as never);
    expect(active).toMatchObject({ status: "active", stage: "active", indexVersionId: "d".repeat(32), progress: 100 });
    expect(dependencies.batches.get("b".repeat(32))).toMatchObject({
      status: "searchable",
      progress: 100,
      completedAt: expect.any(Date),
    });
    expect(dependencies.knowledgeJobs.get("f".repeat(32))).toMatchObject({
      status: "searchable",
    });
    await expect(completeKnowledgeIndexJob({
      id: created.id,
      indexVersionId: "d".repeat(32),
      embeddingProfileId: "c".repeat(32),
      chunkerVersion: "knowledge-chunker/v1",
      collectionName: `ht-k-${"d".repeat(32)}`,
      aliasName: `ht-k-live-${DIGEST}`,
      pointCount: 1,
      version: current.version,
    }, dependencies.db as never)).resolves.toEqual(active);
  });
});
