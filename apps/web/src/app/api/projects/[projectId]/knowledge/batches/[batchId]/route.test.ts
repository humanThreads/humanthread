import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  assertCanReadKnowledgeBatch,
  getKnowledgeBatchProjection,
} from "@humanthread/db";
import { resolveWorkbenchApiActor } from "@/lib/workbench/workbench-api-session";
import { GET } from "./route";

vi.mock("@humanthread/db", () => ({
  assertCanReadKnowledgeBatch: vi.fn(),
  getKnowledgeBatchProjection: vi.fn(),
}));

vi.mock("@/lib/workbench/workbench-api-session", () => ({
  resolveWorkbenchApiActor: vi.fn(),
}));

function request(): Request {
  return new Request("http://localhost/api/projects/project_1/knowledge/batches/batch_1");
}

describe("GET /api/projects/:projectId/knowledge/batches/:batchId", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveWorkbenchApiActor).mockResolvedValue({
      userId: "user_1",
      authKind: "web_session",
      webSessionId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    });
    vi.mocked(assertCanReadKnowledgeBatch).mockResolvedValue({ id: "batch_1" } as never);
    vi.mocked(getKnowledgeBatchProjection).mockResolvedValue({
      id: "batch_1",
      jobId: "job_1",
      status: "policy_evaluating",
      failedStage: null,
      progress: 10,
      processedChunks: 0,
      totalChunks: 0,
      retryCount: 0,
      failureClass: null,
      failureMessage: null,
      receivedAt: new Date("2026-09-20T10:00:00.000Z"),
      updatedAt: new Date("2026-09-20T10:00:00.000Z"),
    });
  });

  it("returns the authorized batch projection", async () => {
    const response = await GET(request(), {
      params: Promise.resolve({ projectId: "project_1", batchId: "batch_1" }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      batch: { id: "batch_1", status: "policy_evaluating", progress: 10 },
    });
    expect(assertCanReadKnowledgeBatch).toHaveBeenCalledWith({
      userId: "user_1",
      projectId: "project_1",
      batchId: "batch_1",
    });
    expect(getKnowledgeBatchProjection).toHaveBeenCalledWith("batch_1");
  });

  it("forbids reading a batch after project authorization fails", async () => {
    vi.mocked(assertCanReadKnowledgeBatch).mockRejectedValue(new Error("access denied"));

    const response = await GET(request(), {
      params: Promise.resolve({ projectId: "project_1", batchId: "batch_1" }),
    });

    expect(response.status).toBe(403);
    expect(getKnowledgeBatchProjection).not.toHaveBeenCalled();
  });

  it("returns 404 for an unknown batch or cross-project digest", async () => {
    vi.mocked(assertCanReadKnowledgeBatch).mockRejectedValue(
      Object.assign(new Error("Knowledge batch not found"), { code: "not_found" }),
    );

    const response = await GET(request(), {
      params: Promise.resolve({ projectId: "project_1", batchId: "batch_other" }),
    });

    expect(response.status).toBe(404);
    expect(getKnowledgeBatchProjection).not.toHaveBeenCalled();
  });
});
