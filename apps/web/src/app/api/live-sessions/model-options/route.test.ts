import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  actor: vi.fn(),
  listModelSites: vi.fn(),
  loadWorkerProjectTarget: vi.fn(),
  resolveDirectWorkerRuntime: vi.fn(),
  loadAgentDevice: vi.fn(),
  authorizeProject: vi.fn(),
}));

vi.mock("@/lib/workbench/workbench-api-session", () => ({
  resolveWorkbenchApiActor: mocks.actor,
}));

vi.mock("@/lib/live-session/live-session-store", () => ({
  getLiveSessionControl: () => ({
    listModelSites: mocks.listModelSites,
    loadWorkerProjectTarget: mocks.loadWorkerProjectTarget,
    loadAgentDevice: mocks.loadAgentDevice,
    authorizeProject: mocks.authorizeProject,
    resolveDirectWorkerRuntime: mocks.resolveDirectWorkerRuntime,
  }),
}));

import { GET } from "./route";

describe("live session model options API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.actor.mockResolvedValue({ userId: "user_1", authKind: "web_session", webSessionId: "web_1" });
    mocks.listModelSites.mockResolvedValue([
      { id: "c".repeat(32), name: "mc", models: [{ name: "gpt-5.6-terra", label: "GPT-5.6 Terra" }] },
    ]);
    mocks.authorizeProject.mockResolvedValue({ projectId: "project_1", role: "maintainer" });
    mocks.loadWorkerProjectTarget.mockResolvedValue({
      projectId: "project_1",
      spaceId: "space_1",
      workerPoolId: "a".repeat(32),
      workerPoolName: "ht-agnet",
      workerPoolStatus: "active",
      workerPoolLastSeenAt: new Date(),
      workerPoolCapacity: 1,
    });
    mocks.resolveDirectWorkerRuntime.mockResolvedValue({
      endpoint: "https://model.example.com/v1",
      apiKey: "key",
      model: "gpt-5.6-terra",
      reasoningEffort: "high",
    });
    mocks.loadAgentDevice.mockResolvedValue(null);
  });

  it("returns the project sites with the resolved project-binding default", async () => {
    const response = await GET(new Request(
      "https://0.0.0.0:3000/api/live-sessions/model-options?kind=worker&spaceId=space_1&projectId=project_1",
    ));
    const body = await response.json();

    expect(response.status, JSON.stringify(body)).toBe(200);
    expect(mocks.resolveDirectWorkerRuntime).toHaveBeenCalledWith({ projectId: "project_1" });
    expect(body.result.sites).toEqual([
      { id: "c".repeat(32), name: "mc", models: [{ name: "gpt-5.6-terra", label: "GPT-5.6 Terra" }] },
    ]);
    expect(body.result.default).toMatchObject({ model: "gpt-5.6-terra", reasoningEffort: "high" });
    expect(body.result.defaultSource).toBe("project-binding");
    expect(body.result.unavailableReason).toBeNull();
  });

  it("never returns endpoints or credential material", async () => {
    const response = await GET(new Request(
      "https://0.0.0.0:3000/api/live-sessions/model-options?kind=worker&spaceId=space_1&projectId=project_1",
    ));
    const body = await response.json();

    expect(JSON.stringify(body)).not.toMatch(/apiKey|apiKeyReference|endpoint|credential/iu);
  });

  it("reports a null default with a reason when the project has no Worker model", async () => {
    mocks.resolveDirectWorkerRuntime.mockRejectedValue(
      Object.assign(new Error("项目尚未配置 Worker 模型"), { code: "worker_direct_runtime_missing" }),
    );

    const response = await GET(new Request(
      "https://0.0.0.0:3000/api/live-sessions/model-options?kind=worker&spaceId=space_1&projectId=project_1",
    ));
    const body = await response.json();

    expect(response.status, JSON.stringify(body)).toBe(200);
    expect(body.result.default).toBeNull();
    expect(body.result.defaultSource).toBeNull();
    expect(body.result.unavailableReason).toBe("worker_direct_runtime_missing");
  });

  it("rejects a worker request without a project", async () => {
    const response = await GET(new Request(
      "https://0.0.0.0:3000/api/live-sessions/model-options?kind=worker&spaceId=space_1",
    ));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.code).toBe("model_options_project_required");
  });

  it("rejects an unknown session kind", async () => {
    const response = await GET(new Request(
      "https://0.0.0.0:3000/api/live-sessions/model-options?kind=robot&spaceId=space_1",
    ));

    expect(response.status).toBe(400);
  });

  it("returns an empty site list with a reason for an Agent device that has not reported sites", async () => {
    mocks.loadAgentDevice.mockResolvedValue({
      id: "device_1",
      userId: "user_1",
      name: "Mac Studio",
      status: "authorized",
      lastSeenAt: new Date(),
      runtimeReady: true,
      connectorOnline: true,
      modelSites: [],
    });

    const response = await GET(new Request(
      "https://0.0.0.0:3000/api/live-sessions/model-options?kind=agent&spaceId=space_1&deviceId=device_1",
    ));
    const body = await response.json();

    expect(response.status, JSON.stringify(body)).toBe(200);
    expect(body.result.sites).toEqual([]);
    expect(body.result.defaultSource).toBe("desktop-account");
    expect(body.result.unavailableReason).toBe("agent_model_profile_unavailable");
  });

  it("returns the reported Agent sites when the device has them", async () => {
    mocks.loadAgentDevice.mockResolvedValue({
      id: "device_1",
      userId: "user_1",
      name: "Mac Studio",
      status: "authorized",
      lastSeenAt: new Date(),
      runtimeReady: true,
      connectorOnline: true,
      modelSites: [
        { siteId: "d".repeat(32), name: "本机 Codex", adapter: "codex_environment", models: [{ name: "gpt-5.6-terra", label: "Terra" }] },
      ],
    });

    const response = await GET(new Request(
      "https://0.0.0.0:3000/api/live-sessions/model-options?kind=agent&spaceId=space_1&deviceId=device_1",
    ));
    const body = await response.json();

    expect(response.status, JSON.stringify(body)).toBe(200);
    expect(body.result.sites).toEqual([
      { id: "d".repeat(32), name: "本机 Codex", models: [{ name: "gpt-5.6-terra", label: "Terra" }] },
    ]);
    expect(body.result.unavailableReason).toBeNull();
  });
});
