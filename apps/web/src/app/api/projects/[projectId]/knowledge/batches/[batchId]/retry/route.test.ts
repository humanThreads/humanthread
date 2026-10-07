import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  assertCanWriteKnowledgeBatch,
  retryKnowledgeBatch,
} from "@humanthread/db";
import { resolveWorkbenchApiActor } from "@/lib/workbench/workbench-api-session";
import { POST } from "./route";

vi.mock("@humanthread/db", () => ({
  assertCanWriteKnowledgeBatch: vi.fn(),
  retryKnowledgeBatch: vi.fn(),
}));

vi.mock("@/lib/workbench/workbench-api-session", () => ({
  resolveWorkbenchApiActor: vi.fn(),
}));

function request(body: unknown): Request {
  return new Request(
    "http://localhost/api/projects/project_1/knowledge/batches/batch_1/retry",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

describe("POST /api/projects/:projectId/knowledge/batches/:batchId/retry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveWorkbenchApiActor).mockResolvedValue({
      userId: "user_1",
      authKind: "web_session",
      webSessionId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    });
    vi.mocked(assertCanWriteKnowledgeBatch).mockResolvedValue({ id: "batch_1" } as never);
    vi.mocked(retryKnowledgeBatch).mockResolvedValue({
      id: "batch_1",
      jobId: "job_1",
      status: "chunking",
      failedStage: null,
      progress: 45,
      processedChunks: 2,
      totalChunks: 4,
      retryCount: 1,
      failureClass: null,
      failureMessage: null,
      receivedAt: new Date("2026-09-20T10:00:00.000Z"),
      updatedAt: new Date("2026-09-20T11:00:00.000Z"),
    });
  });

  it("retries an authorized transient failure", async () => {
    const response = await POST(request({ commandId: "retry_1" }), {
      params: Promise.resolve({ projectId: "project_1", batchId: "batch_1" }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      batch: { id: "batch_1", status: "chunking", progress: 45 },
    });
    expect(assertCanWriteKnowledgeBatch).toHaveBeenCalledWith({
      userId: "user_1",
      projectId: "project_1",
      batchId: "batch_1",
    });
    expect(retryKnowledgeBatch).toHaveBeenCalledWith({
      batchId: "batch_1",
      commandId: "retry_1",
    });
  });

  it("returns 400 for a missing retry command", async () => {
    const response = await POST(request({}), {
      params: Promise.resolve({ projectId: "project_1", batchId: "batch_1" }),
    });

    expect(response.status).toBe(400);
    expect(assertCanWriteKnowledgeBatch).not.toHaveBeenCalled();
    expect(retryKnowledgeBatch).not.toHaveBeenCalled();
  });

  it("returns 403 before retrying when batch write authorization fails", async () => {
    vi.mocked(assertCanWriteKnowledgeBatch).mockRejectedValue(
      new Error("Project write access denied"),
    );

    const response = await POST(request({ commandId: "retry_1" }), {
      params: Promise.resolve({ projectId: "project_1", batchId: "batch_1" }),
    });

    expect(response.status).toBe(403);
    expect(retryKnowledgeBatch).not.toHaveBeenCalled();
  });

  it("returns 409 when retry loses a version race", async () => {
    vi.mocked(retryKnowledgeBatch).mockRejectedValue(
      Object.assign(new Error("Knowledge batch changed while retrying"), {
        code: "version_conflict",
      }),
    );

    const response = await POST(request({ commandId: "retry_1" }), {
      params: Promise.resolve({ projectId: "project_1", batchId: "batch_1" }),
    });

    expect(response.status).toBe(409);
  });
});
