import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";

vi.mock("@/lib/workbench/workbench-api-session", () => ({
  resolveWorkbenchApiActor: vi.fn(async () => ({ userId: "user_1" })),
}));

vi.mock("@humanthread/db", () => ({ saveProjectRepositoryCredentials: vi.fn() }));

const context = { params: Promise.resolve({ projectId: "project_1" }) };

beforeEach(() => vi.clearAllMocks());

describe("project repository credentials route", () => {
  it("stores a project token without returning the secret", async () => {
    const { saveProjectRepositoryCredentials } = await import("@humanthread/db");
    vi.mocked(saveProjectRepositoryCredentials).mockResolvedValue({ credentialNames: ["HT_GIT_TOKEN", "HT_GIT_USERNAME"] });

    const response = await POST(new Request("http://localhost/api/projects/project_1/repository-credentials", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ authMode: "project_token", username: "", secret: "secret-token" }),
    }), context);

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body).toMatchObject({ ok: true, result: { credentialNames: ["HT_GIT_TOKEN", "HT_GIT_USERNAME"] } });
    expect(JSON.stringify(body)).not.toContain("secret-token");
    expect(saveProjectRepositoryCredentials).toHaveBeenCalledWith({ actorUserId: "user_1", projectId: "project_1", authMode: "project_token", username: "", secret: "secret-token" });
  });

  it("rejects unsupported credential fields", async () => {
    const response = await POST(new Request("http://localhost/api/projects/project_1/repository-credentials", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ authMode: "project_token", secret: "secret-token", token: "duplicate" }),
    }), context);

    expect(response.status).toBe(400);
  });
});
