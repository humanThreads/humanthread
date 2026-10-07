import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET, PUT } from "./route";

vi.mock("@/lib/workbench/workbench-api-session", () => ({
  resolveWorkbenchApiActor: vi.fn(async () => ({ userId: "user_1" })),
}));

vi.mock("@humanthread/db", () => ({
  getProjectRepository: vi.fn(),
  saveProjectRepositoryConfiguration: vi.fn(),
}));

const context = { params: Promise.resolve({ projectId: "project_1" }) };

beforeEach(() => vi.clearAllMocks());

describe("project repository configuration route", () => {
  it("returns repository metadata without credentials", async () => {
    const { getProjectRepository } = await import("@humanthread/db");
    vi.mocked(getProjectRepository).mockResolvedValue({
      projectId: "project_1",
      version: 3,
      repositoryUrl: "https://github.com/acme/repo.git",
      branchPolicy: { allowedBranches: ["main"] },
      configuration: {
        schemaVersion: 1,
        provider: "github",
        creationMode: "existing",
        privateBaseUrl: null,
        privateWebUrl: null,
        privateTokenHelpUrl: null,
        authMode: "project_token",
        verification: { status: "pending_verification", verifiedAt: null, defaultBranch: null, headSha: null, failureCode: null, apiChecked: false },
      },
      credentials: [{ name: "HT_GIT_TOKEN", status: "configured" }],
    } as never);

    const response = await GET(new Request("http://localhost/api/projects/project_1/repository-configuration"), context);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      result: { repositoryUrl: "https://github.com/acme/repo.git", credentials: [{ name: "HT_GIT_TOKEN" }] },
    });
    expect(getProjectRepository).toHaveBeenCalledWith({ projectId: "project_1", actorUserId: "user_1" });
  });

  it("saves provider metadata with the expected Project version", async () => {
    const { saveProjectRepositoryConfiguration } = await import("@humanthread/db");
    vi.mocked(saveProjectRepositoryConfiguration).mockResolvedValue({ projectId: "project_1", version: 4 });
    const body = {
      expectedVersion: 3,
      repositoryUrl: "https://github.com/acme/repo.git",
      allowedBranches: ["main"],
      provider: "github",
      creationMode: "existing",
      authMode: "project_token",
      privateBaseUrl: null,
      privateWebUrl: null,
      privateTokenHelpUrl: null,
    };

    const response = await PUT(new Request("http://localhost/api/projects/project_1/repository-configuration", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }), context);

    expect(response.status).toBe(200);
    expect(saveProjectRepositoryConfiguration).toHaveBeenCalledWith({ actorUserId: "user_1", projectId: "project_1", ...body });
  });

  it("maps private-host rejection to a safe 403 response", async () => {
    const { saveProjectRepositoryConfiguration } = await import("@humanthread/db");
    vi.mocked(saveProjectRepositoryConfiguration).mockRejectedValue(Object.assign(new Error("私仓地址未加入出站白名单"), { code: "private_host_not_allowed" }));

    const response = await PUT(new Request("http://localhost/api/projects/project_1/repository-configuration", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        expectedVersion: 3,
        repositoryUrl: "https://git.internal.example/acme/repo.git",
        allowedBranches: ["main"],
        provider: "private",
        creationMode: "existing",
        authMode: "project_token",
        privateBaseUrl: "https://git.internal.example",
        privateWebUrl: null,
        privateTokenHelpUrl: null,
      }),
    }), context);

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ ok: false, code: "private_host_not_allowed" });
  });
});
