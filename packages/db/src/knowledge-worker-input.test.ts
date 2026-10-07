import { describe, expect, it, vi } from "vitest";

import { loadKnowledgeWorkerInput } from "./knowledge-worker-input";

describe("loadKnowledgeWorkerInput", () => {
  it("loads immutable template, snapshot, limits, and previous keys", async () => {
    const db = {
      knowledgeJob: { findUnique: vi.fn(async () => ({
        id: "a".repeat(32), taskId: "b".repeat(32), projectDigest: "c".repeat(32), mode: "task_completion",
        templateVersionId: "d".repeat(32), sourceSnapshot: { observedAt: "2026-09-20T00:00:00.000Z" }, sourceSnapshotDigest: "e".repeat(32),
      })) },
      knowledgeTemplateVersion: { findUnique: vi.fn(async () => ({ content: "# 模板" })) },
      knowledgePolicy: { findUnique: vi.fn(async () => ({ allowedEntryTypes: ["rule", "decision", 42] })) },
      knowledgeEntry: { findMany: vi.fn(async () => [{ stableKey: "rule.release" }]) },
    };

    await expect(loadKnowledgeWorkerInput({ jobId: "a".repeat(32) }, db)).resolves.toMatchObject({
      jobId: "a".repeat(32),
      taskId: "b".repeat(32),
      templateContent: "# 模板",
      allowedEntryTypes: ["rule", "decision"],
      maxItems: 500,
      previousStableKeys: ["rule.release"],
    });
    expect(db.knowledgeEntry.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { projectDigest: "c".repeat(32), status: "published" },
    }));
  });

  it("fails when the template version is missing", async () => {
    const db = {
      knowledgeJob: { findUnique: vi.fn(async () => ({
        id: "a".repeat(32), taskId: "b".repeat(32), projectDigest: "c".repeat(32), mode: "task_completion",
        templateVersionId: "d".repeat(32), sourceSnapshot: {}, sourceSnapshotDigest: "e".repeat(32),
      })) },
      knowledgeTemplateVersion: { findUnique: vi.fn(async () => null) },
      knowledgePolicy: { findUnique: vi.fn(async () => null) },
      knowledgeEntry: { findMany: vi.fn(async () => []) },
    };
    await expect(loadKnowledgeWorkerInput({ jobId: "a".repeat(32) }, db)).rejects.toMatchObject({ code: "not_found" });
  });
});
