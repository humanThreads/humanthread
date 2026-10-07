import { describe, expect, it, vi } from "vitest";

import {
  assertCanReadKnowledgeBatch,
  assertCanWriteKnowledgeBatch,
  listKnowledgeReviewQueue,
  readKnowledgeBatchAccess,
  readKnowledgeJobAccess,
} from "./knowledge-access";
import { knowledgeProjectDigest } from "./knowledge-reference";

const batch = {
  id: "batch_1",
  jobId: "job_1",
  projectDigest: knowledgeProjectDigest("project_1"),
  status: "policy_evaluating",
  failedStage: null,
  progress: 10,
  processedChunks: 0,
  totalChunks: 0,
  retryCount: 0,
  failureClass: null,
  failureMessage: null,
  receivedAt: new Date("2026-09-20T10:00:00.000Z"),
  completedAt: null,
  version: 1,
  createdAt: new Date("2026-09-20T10:00:00.000Z"),
  updatedAt: new Date("2026-09-20T10:00:00.000Z"),
};

const job = {
  id: "job_1",
  projectDigest: knowledgeProjectDigest("project_1"),
  taskId: "task_1",
  mode: "task_completion",
  status: "awaiting_submission",
  templateVersionId: "b".repeat(32),
  policyVersion: 1,
  dedupeKey: "knowledge-job:task_1",
  sourceSnapshot: { observedAt: "2026-09-20T00:00:00.000Z" },
  failureCode: null,
  failureMessage: null,
  version: 1,
  createdAt: new Date("2026-09-20T00:00:00.000Z"),
  updatedAt: new Date("2026-09-20T00:00:00.000Z"),
};

describe("knowledge access", () => {
  it("denies batch access when the actor cannot read the owning project", async () => {
    await expect(assertCanReadKnowledgeBatch({
      userId: "user_1",
      projectId: "project_1",
      batchId: "batch_1",
      dependencies: {
        loadBatch: async () => ({ id: "batch_1", projectDigest: "b".repeat(32) }),
        assertCanReadProject: async () => {
          throw Object.assign(new Error("denied"), { code: "project_access_denied" });
        },
      },
    })).rejects.toMatchObject({ code: "project_access_denied" });
  });

  it("authorizes the project before loading batch content or status", async () => {
    const loadBatch = vi.fn().mockResolvedValue(batch);
    const assertCanReadProject = vi.fn().mockRejectedValue(new Error("Project access denied"));

    await expect(assertCanReadKnowledgeBatch({
      userId: "user_1",
      projectId: "project_1",
      batchId: "batch_1",
      dependencies: { loadBatch, assertCanReadProject },
    })).rejects.toThrow("Project access denied");

    expect(assertCanReadProject).toHaveBeenCalledWith({
      userId: "user_1",
      projectId: "project_1",
    });
    expect(loadBatch).not.toHaveBeenCalled();
  });

  it("looks up a batch by the computed project digest", async () => {
    const loadBatch = vi.fn().mockResolvedValue(batch);
    const assertCanReadProject = vi.fn().mockResolvedValue({ projectId: "project_1", role: "viewer" });

    await expect(readKnowledgeBatchAccess({
      userId: "user_1",
      projectId: "project_1",
      batchId: "batch_1",
      dependencies: { loadBatch, assertCanReadProject },
    })).resolves.toEqual(batch);

    expect(loadBatch).toHaveBeenCalledWith({
      batchId: "batch_1",
      projectDigest: knowledgeProjectDigest("project_1"),
    });
  });

  it("returns not_found for a batch digest mismatch after authorization", async () => {
    const loadBatch = vi.fn().mockResolvedValue(null);
    const assertCanReadProject = vi.fn().mockResolvedValue({ projectId: "project_1", role: "viewer" });

    await expect(assertCanReadKnowledgeBatch({
      userId: "user_1",
      projectId: "project_1",
      batchId: "batch_1",
      dependencies: { loadBatch, assertCanReadProject },
    })).rejects.toMatchObject({ code: "not_found" });
  });

  it("requires project write access before returning a matching batch", async () => {
    const loadBatch = vi.fn().mockResolvedValue(batch);
    const assertCanWriteProject = vi.fn().mockResolvedValue({ projectId: "project_1", role: "maintainer" });

    await expect(assertCanWriteKnowledgeBatch({
      userId: "user_1",
      projectId: "project_1",
      batchId: "batch_1",
      dependencies: { loadBatch, assertCanWriteProject },
    })).resolves.toEqual(batch);

    expect(assertCanWriteProject).toHaveBeenCalledWith({
      userId: "user_1",
      projectId: "project_1",
    });
    expect(loadBatch).toHaveBeenCalledWith({
      batchId: "batch_1",
      projectDigest: knowledgeProjectDigest("project_1"),
    });
  });

  it("authorizes the project before loading Job content or status", async () => {
    const loadJob = vi.fn().mockResolvedValue(job);
    const assertCanReadProject = vi.fn().mockRejectedValue(new Error("Project access denied"));

    await expect(readKnowledgeJobAccess({
      userId: "user_1",
      projectId: "project_1",
      jobId: "job_1",
      dependencies: { loadJob, assertCanReadProject },
    })).rejects.toThrow("Project access denied");

    expect(loadJob).not.toHaveBeenCalled();
  });

  it("returns null for a Job digest mismatch after read authorization", async () => {
    const loadJob = vi.fn().mockResolvedValue(null);
    const assertCanReadProject = vi.fn().mockResolvedValue({ projectId: "project_1", role: "viewer" });

    await expect(readKnowledgeJobAccess({
      userId: "user_1",
      projectId: "project_1",
      jobId: "job_1",
      dependencies: { loadJob, assertCanReadProject },
    })).resolves.toBeNull();

    expect(loadJob).toHaveBeenCalledWith({
      jobId: "job_1",
      projectDigest: knowledgeProjectDigest("project_1"),
    });
  });
});

describe("knowledge review queue", () => {
  it("returns review_required batches with their items and enforces project read access", async () => {
    const assertCanReadProject = vi.fn().mockResolvedValue({ projectId: "project_1", role: "viewer" });
    const listBatches = vi.fn().mockResolvedValue([{
      id: "batch_1",
      jobId: "job_1",
      submissionId: "a".repeat(32),
      status: "review_required",
      progress: 30,
      receivedAt: new Date("2026-09-20T10:00:00.000Z"),
      updatedAt: new Date("2026-09-20T10:00:00.000Z"),
    }]);
    const listItems = vi.fn().mockResolvedValue([{
      id: "item_1",
      batchId: "batch_1",
      ordinal: 0,
      stableKey: "rule.release.gate",
      changeType: "create",
      sourceType: "knowledge_architecture",
      entryType: "rule",
      title: "发布门禁",
      summary: "必须全量测试",
      confidence: 0.96,
      tags: ["release", 42],
      decision: "review_required",
      decisionReason: "automation_disabled",
      publishedVersion: null,
    }]);

    const result = await listKnowledgeReviewQueue({
      userId: "user_1",
      projectId: "project_1",
    }, { assertCanReadProject, listBatches, listItems });

    expect(assertCanReadProject).toHaveBeenCalledWith({ userId: "user_1", projectId: "project_1" });
    expect(listBatches).toHaveBeenCalledWith({
      projectDigest: knowledgeProjectDigest("project_1"),
      limit: 20,
    });
    expect(listItems).toHaveBeenCalledWith({ batchIds: ["batch_1"] });
    expect(result).toEqual([expect.objectContaining({
      batchId: "batch_1",
      jobId: "job_1",
      status: "review_required",
      items: [expect.objectContaining({
        batchId: "batch_1",
        stableKey: "rule.release.gate",
        tags: ["release"],
      })],
    })]);
  });

  it("does not read batches when the caller cannot read the Project", async () => {
    const assertCanReadProject = vi.fn().mockRejectedValue(new Error("Project read access denied"));
    const listBatches = vi.fn();
    const listItems = vi.fn();

    await expect(listKnowledgeReviewQueue({
      userId: "user_1",
      projectId: "project_1",
    }, { assertCanReadProject, listBatches, listItems })).rejects.toThrow("Project read access denied");
    expect(listBatches).not.toHaveBeenCalled();
    expect(listItems).not.toHaveBeenCalled();
  });
});
