import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "./route";

vi.mock("@/lib/workbench/workbench-api-session", () => ({
  resolveWorkbenchApiActor: vi.fn(),
}));

vi.mock("@humanthread/db", () => ({
  createWorkerModelSite: vi.fn(),
  listWorkerModelSites: vi.fn(),
}));

describe("/api/worker-model-sites", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const { resolveWorkbenchApiActor } = await import("@/lib/workbench/workbench-api-session");
    const { createWorkerModelSite, listWorkerModelSites } = await import("@humanthread/db");
    vi.mocked(resolveWorkbenchApiActor).mockResolvedValue({ userId: "user_1" } as never);
    vi.mocked(listWorkerModelSites).mockResolvedValue([] as never);
    vi.mocked(createWorkerModelSite).mockResolvedValue({
      id: "a".repeat(32), ownerUserId: "user_1", name: "proxy", provider: "codex",
      endpoint: "https://codex.example.com/v1", apiKeyReference: "a".repeat(32), status: "active",
      createdAt: "2026-08-23T08:00:00.000Z", updatedAt: "2026-08-23T08:00:00.000Z",
    } as never);
  });

  it("lists only the signed-in user's secret-free model sites", async () => {
    const { listWorkerModelSites } = await import("@humanthread/db");

    const response = await GET(new Request("http://localhost/api/worker-model-sites"));

    expect(response.status).toBe(200);
    expect(listWorkerModelSites).toHaveBeenCalledWith({
      actorUserId: "user_1",
      scope: { ownerType: "personal", ownerUserId: "user_1", companyId: null },
    });
    await expect(response.json()).resolves.toEqual({ ok: true, result: [] });
  });

  it("creates a model site for the session actor and does not return the supplied API key", async () => {
    const { createWorkerModelSite } = await import("@humanthread/db");
    const response = await POST(new Request("http://localhost/api/worker-model-sites", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "proxy",
        endpoint: "https://codex.example.com/v1",
        apiKey: "configured-key",
        models: [{ name: "gpt-5.6-terra", label: "GPT-5.6 Terra" }],
      }),
    }));

    expect(response.status).toBe(200);
    expect(createWorkerModelSite).toHaveBeenCalledWith(expect.objectContaining({
      actorUserId: "user_1", apiKey: "configured-key",
      models: [{ name: "gpt-5.6-terra", label: "GPT-5.6 Terra" }],
    }));
    await expect(response.text()).resolves.not.toContain("configured-key");
  });
});
