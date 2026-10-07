import { describe, expect, it, vi } from "vitest";

import { processKnowledgeIndexJob } from "./service";

function fixture() {
  const job = {
    id: "a".repeat(32),
    projectDigest: "b".repeat(32),
    batchId: "c".repeat(32),
    embeddingProfileId: "d".repeat(32),
    chunkerVersion: "knowledge-chunker/v1",
    indexVersion: 1,
    collectionName: `ht-k-${"e".repeat(32)}`,
    aliasName: `ht-k-live-${"b".repeat(32)}`,
    status: "running",
    stage: "chunking",
    failedStage: null,
    version: 2,
  };
  let version = 2;
  const writer = {
    claim: vi.fn(async () => job),
    recordProgress: vi.fn(async (_id, _stage, _processed, _total, current) => {
      version = current + 1;
      return version;
    }),
    complete: vi.fn(async () => {}),
    fail: vi.fn(async () => {}),
  };
  const runner = {
    run: vi.fn(async () => ({
      points: 2,
      progress: [
        { stage: "chunking" as const, processed: 2, total: 2, progress: 100 },
        { stage: "active" as const, processed: 2, total: 2, progress: 100 },
      ],
    })),
  };
  return { job, writer, runner };
}

describe("knowledge index job service", () => {
  it("claims, records real progress, and completes", async () => {
    const dependencies = fixture();
    await expect(processKnowledgeIndexJob({
      jobId: dependencies.job.id,
      writer: dependencies.writer,
      runner: dependencies.runner,
      loadVersions: vi.fn(async () => []),
    })).resolves.toMatchObject({ id: dependencies.job.id, status: "active" });
    expect(dependencies.writer.recordProgress).toHaveBeenCalledTimes(2);
    expect(dependencies.writer.complete).toHaveBeenCalledWith(dependencies.job.id, expect.objectContaining({
      indexVersionId: expect.stringMatching(/^[a-f0-9]{32}$/u),
      collectionName: expect.stringMatching(/^ht-k-[a-f0-9]{32}$/u),
      aliasName: expect.stringMatching(/^ht-k-live-[a-f0-9]{32}$/u),
      pointCount: 2,
    }));
  });

  it("records the failed stage and rethrows", async () => {
    const dependencies = fixture();
    dependencies.runner.run.mockRejectedValue(Object.assign(new Error("qdrant down"), { stage: "indexing", failureClass: "transient" }));
    await expect(processKnowledgeIndexJob({
      jobId: dependencies.job.id,
      writer: dependencies.writer,
      runner: dependencies.runner,
      loadVersions: vi.fn(async () => []),
    })).rejects.toThrow("qdrant down");
    expect(dependencies.writer.fail).toHaveBeenCalledWith(dependencies.job.id, {
      stage: "indexing",
      failureClass: "transient",
      failureMessage: "qdrant down",
    });
  });
});
