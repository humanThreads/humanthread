import { beforeEach, describe, expect, it, vi } from "vitest";

import { readKnowledgeJobAccess } from "@humanthread/db";
import { resolveWorkbenchApiActor } from "@/lib/workbench/workbench-api-session";
import { GET } from "./route";

vi.mock("@humanthread/db", () => ({
  readKnowledgeJobAccess: vi.fn(),
}));

vi.mock("@/lib/workbench/workbench-api-session", () => ({
  resolveWorkbenchApiActor: vi.fn(),
}));

const job = {
  id: "job_1",
  projectDigest: "b".repeat(32),
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

function request(): Request {
  return new Request("http://localhost/api/projects/project_1/knowledge/jobs/job_1");
}

describe("GET /api/projects/:projectId/knowledge/jobs/:jobId", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveWorkbenchApiActor).mockResolvedValue({
      userId: "user_1",
      authKind: "web_session",
      webSessionId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    });
    vi.mocked(readKnowledgeJobAccess).mockResolvedValue(job);
  });

  it("returns the authorized Job", async () => {
    const response = await GET(request(), {
      params: Promise.resolve({ projectId: "project_1", jobId: "job_1" }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      job: { id: "job_1", status: "awaiting_submission" },
    });
    expect(readKnowledgeJobAccess).toHaveBeenCalledWith({
      userId: "user_1",
      projectId: "project_1",
      jobId: "job_1",
    });
  });

  it("returns 403 when project read authorization fails", async () => {
    vi.mocked(readKnowledgeJobAccess).mockRejectedValue(new Error("Project access denied"));

    const response = await GET(request(), {
      params: Promise.resolve({ projectId: "project_1", jobId: "job_1" }),
    });

    expect(response.status).toBe(403);
  });

  it("returns 404 for an unknown Job or cross-project digest", async () => {
    vi.mocked(readKnowledgeJobAccess).mockResolvedValue(null);

    const response = await GET(request(), {
      params: Promise.resolve({ projectId: "project_1", jobId: "job_other" }),
    });

    expect(response.status).toBe(404);
  });
});
