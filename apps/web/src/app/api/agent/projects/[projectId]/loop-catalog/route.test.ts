import { beforeEach, describe, expect, it, vi } from "vitest";
import { authenticateAgentRequest } from "../../../../../../lib/agent/agent-auth";
import { readProjectLoopCatalogV2 } from "../../../../../../lib/orchestration/project-loop-catalog";
import { GET } from "./route";

vi.mock("../../../../../../lib/agent/agent-auth", () => ({ authenticateAgentRequest: vi.fn() }));
vi.mock("../../../../../../lib/orchestration/project-loop-catalog", () => ({
  readProjectLoopCatalogV2: vi.fn(),
}));

const context = { params: Promise.resolve({ projectId: "project_1" }) };

describe("GET /api/agent/projects/:projectId/loop-catalog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(authenticateAgentRequest).mockResolvedValue({ userId: "user_1", teamId: "team_1", deviceId: "device_1" });
    vi.mocked(readProjectLoopCatalogV2).mockResolvedValue({
      contractVersion: 2,
      projectId: "project_1",
      catalogVersion: `sha256:${"b".repeat(64)}`,
      projectBindings: [],
      publishedLoops: [],
    });
  });

  it("authenticates the authorized device and returns the latest catalog", async () => {
    const response = await GET(new Request(
      "http://localhost/api/agent/projects/project_1/loop-catalog?userId=user_1&deviceId=device_1&teamId=team_1",
      { headers: { authorization: "Bearer token", "x-agent-device-token": "device-token" } },
    ), context);

    expect(response.status).toBe(200);
    expect(authenticateAgentRequest).toHaveBeenCalledWith(expect.objectContaining({
      userId: "user_1",
      deviceId: "device_1",
      expectedTeamId: "team_1",
      requireAuthorizedDevice: true,
    }));
    expect(readProjectLoopCatalogV2).toHaveBeenCalledWith({ userId: "user_1", projectId: "project_1" });
    expect(await response.json()).toEqual({
      ok: true,
      result: {
        projectId: "project_1",
        contractVersion: 2,
        catalogVersion: `sha256:${"b".repeat(64)}`,
        projectBindings: [],
        publishedLoops: [],
      },
    });
  });

  it("ignores legacy contract version query parameters", async () => {
    const response = await GET(new Request(
      "http://localhost/api/agent/projects/project_1/loop-catalog?userId=user_1&deviceId=device_1&contractVersion=2",
      { headers: { authorization: "Bearer token", "x-agent-device-token": "device-token" } },
    ), context);

    expect(response.status).toBe(200);
    expect(readProjectLoopCatalogV2).toHaveBeenCalledWith({ userId: "user_1", projectId: "project_1" });
    expect((await response.json()).result.contractVersion).toBe(2);
  });

  it("does not reject unknown contract version query parameters", async () => {
    const response = await GET(new Request(
      "http://localhost/api/agent/projects/project_1/loop-catalog?userId=user_1&deviceId=device_1&contractVersion=3",
      { headers: { authorization: "Bearer token", "x-agent-device-token": "device-token" } },
    ), context);

    expect(response.status).toBe(200);
    expect(readProjectLoopCatalogV2).toHaveBeenCalledWith({ userId: "user_1", projectId: "project_1" });
  });

  it("requires explicit user and device identity", async () => {
    const response = await GET(new Request("http://localhost/api/agent/projects/project_1/loop-catalog"), context);
    expect(response.status).toBe(400);
    expect(authenticateAgentRequest).not.toHaveBeenCalled();
  });

  it("reports a missing project as a client error", async () => {
    vi.mocked(readProjectLoopCatalogV2).mockRejectedValue(new Error("Project not found"));

    const response = await GET(new Request(
      "http://localhost/api/agent/projects/missing_project/loop-catalog?userId=user_1&deviceId=device_1",
      { headers: { authorization: "Bearer token", "x-agent-device-token": "device-token" } },
    ), { params: Promise.resolve({ projectId: "missing_project" }) });

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({
      ok: false,
      error: "Project not found",
    });
  });
});
