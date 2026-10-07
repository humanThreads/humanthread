import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";

vi.mock("@/lib/workbench/workbench-api-session", () => ({
  resolveWorkbenchApiActor: vi.fn(async () => ({ userId: "user_1" })),
}));

vi.mock("@humanthread/db", () => ({
  assertCanWriteProject: vi.fn(),
  enqueueProjectRepositoryVerification: vi.fn(),
}));

const context = { params: Promise.resolve({ projectId: "project_1" }) };

beforeEach(() => vi.clearAllMocks());

describe("project repository verification route", () => {
  it("requires write access and enqueues asynchronous verification", async () => {
    const { assertCanWriteProject } = await import("@humanthread/db");
    const { enqueueProjectRepositoryVerification } = await import("@humanthread/db");
    vi.mocked(enqueueProjectRepositoryVerification).mockResolvedValue({
      projectId: "project_1",
      version: 5,
      status: "pending_verification",
    });

    const response = await POST(new Request("http://localhost/api/projects/project_1/repository-verification", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ expectedDefaultBranch: "main" }),
    }), context);

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({ ok: true, accepted: true, result: { status: "pending_verification", version: 5 } });
    expect(assertCanWriteProject).toHaveBeenCalledWith({ userId: "user_1", projectId: "project_1" });
    expect(enqueueProjectRepositoryVerification).toHaveBeenCalledWith({ actorUserId: "user_1", projectId: "project_1", expectedDefaultBranch: "main" });
  });

  it("does not execute Git or claim a verification result in the Web process", async () => {
    const { enqueueProjectRepositoryVerification } = await import("@humanthread/db");
    vi.mocked(enqueueProjectRepositoryVerification).mockResolvedValue({
      projectId: "project_1",
      version: 5,
      status: "pending_verification",
    });

    const response = await POST(new Request("http://localhost/api/projects/project_1/repository-verification", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    }), context);

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({ ok: true, accepted: true, result: { projectId: "project_1", version: 5, status: "pending_verification" } });
  });
});
