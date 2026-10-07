import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  assertCanWriteProject,
  readKnowledgeJobAccess,
  submitKnowledgeBatchForIngestion,
} from "@humanthread/db";
import { resolveWorkbenchApiActor } from "@/lib/workbench/workbench-api-session";
import { POST } from "./route";

vi.mock("@humanthread/db", () => ({
  assertCanWriteProject: vi.fn(),
  readKnowledgeJobAccess: vi.fn(),
  submitKnowledgeBatchForIngestion: vi.fn(),
}));

vi.mock("@/lib/workbench/workbench-api-session", () => ({
  resolveWorkbenchApiActor: vi.fn(),
}));

function jsonRequest(body: unknown): Request {
  return new Request(
    "http://localhost/api/projects/project_1/knowledge/jobs/job_1/submissions",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

describe("POST /api/projects/:projectId/knowledge/jobs/:jobId/submissions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveWorkbenchApiActor).mockResolvedValue({
      userId: "user_1",
      authKind: "web_session",
      webSessionId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    });
    vi.mocked(assertCanWriteProject).mockResolvedValue({
      projectId: "project_1",
      role: "maintainer",
    });
    vi.mocked(readKnowledgeJobAccess).mockResolvedValue({
      id: "job_1",
      projectDigest: "b".repeat(32),
      taskId: "task_1",
      mode: "task_completion",
      status: "awaiting_submission",
      templateVersionId: "b".repeat(32),
      policyVersion: 1,
      dedupeKey: "knowledge-job:task_1",
      sourceSnapshot: {},
      failureCode: null,
      failureMessage: null,
      version: 1,
      createdAt: new Date("2026-09-20T00:00:00.000Z"),
      updatedAt: new Date("2026-09-20T00:00:00.000Z"),
    });
  });

  it("returns a platform receipt after accepting a batch", async () => {
    vi.mocked(submitKnowledgeBatchForIngestion).mockResolvedValue({
      id: "batch_1",
      jobId: "job_1",
      status: "received",
      failedStage: null,
      progress: 0,
      processedChunks: 0,
      totalChunks: 0,
      retryCount: 0,
      failureClass: null,
      failureMessage: null,
      receivedAt: new Date("2026-09-20T10:00:00.000Z"),
      updatedAt: new Date("2026-09-20T10:00:00.000Z"),
    });

    const response = await POST(
      jsonRequest({
        submissionId: "submission_1",
        templateDigest: "a".repeat(32),
        sourceSnapshot: {},
        items: [],
      }),
      { params: Promise.resolve({ projectId: "project_1", jobId: "job_1" }) },
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      batch: { id: "batch_1", status: "received", progress: 0 },
    });
    expect(assertCanWriteProject).toHaveBeenCalledWith({
      userId: "user_1",
      projectId: "project_1",
    });
    expect(readKnowledgeJobAccess).toHaveBeenCalledWith({
      userId: "user_1",
      projectId: "project_1",
      jobId: "job_1",
    });
    expect(submitKnowledgeBatchForIngestion).toHaveBeenCalledWith({
      commandId: "submission_1",
      jobId: "job_1",
      actorDigest: "user_1",
      submissionId: "submission_1",
      templateDigest: "a".repeat(32),
      sourceSnapshot: {},
      items: [],
    });
  });

  it("returns 400 for an invalid template digest without dispatching the batch", async () => {
    const response = await POST(
      jsonRequest({
        submissionId: "submission_1",
        templateDigest: "not-a-digest",
        sourceSnapshot: {},
        items: [],
      }),
      { params: Promise.resolve({ projectId: "project_1", jobId: "job_1" }) },
    );

    expect(response.status).toBe(400);
    expect(submitKnowledgeBatchForIngestion).not.toHaveBeenCalled();
  });

  it("does not dispatch a batch when project write authorization fails", async () => {
    vi.mocked(assertCanWriteProject).mockRejectedValue(new Error("Project write access denied"));

    const response = await POST(
      jsonRequest({
        submissionId: "submission_1",
        templateDigest: "a".repeat(32),
        sourceSnapshot: {},
        items: [],
      }),
      { params: Promise.resolve({ projectId: "project_1", jobId: "job_1" }) },
    );

    expect(response.status).toBe(403);
    expect(readKnowledgeJobAccess).not.toHaveBeenCalled();
    expect(submitKnowledgeBatchForIngestion).not.toHaveBeenCalled();
  });

  it("returns 404 for an unknown or cross-project Job digest", async () => {
    vi.mocked(readKnowledgeJobAccess).mockResolvedValue(null);

    const response = await POST(
      jsonRequest({
        submissionId: "submission_1",
        templateDigest: "a".repeat(32),
        sourceSnapshot: {},
        items: [],
      }),
      { params: Promise.resolve({ projectId: "project_1", jobId: "job_other" }) },
    );

    expect(response.status).toBe(404);
    expect(submitKnowledgeBatchForIngestion).not.toHaveBeenCalled();
  });

  it("returns 400 for more than 500 items without dispatching", async () => {
    const item = {
      stableKey: "rule.release.gate",
      changeType: "create",
      sourceType: "task_completion",
      entryType: "rule",
      scope: "project",
      title: "发布门禁",
      summary: "必须全量测试",
      bodyMarkdown: "必须全量测试",
      confidence: 0.96,
      tags: ["release"],
      changeSummary: "新增发布门禁",
      evidence: [{ kind: "task", ref: "task:1" }],
      relations: [],
    };
    const response = await POST(jsonRequest({
      submissionId: "submission_1",
      templateDigest: "a".repeat(32),
      sourceSnapshot: {},
      items: Array.from({ length: 501 }, (_, index) => ({
        ...item,
        stableKey: `rule.release.${index}`,
      })),
    }), { params: Promise.resolve({ projectId: "project_1", jobId: "job_1" }) });

    expect(response.status).toBe(400);
    expect(submitKnowledgeBatchForIngestion).not.toHaveBeenCalled();
  });
});
