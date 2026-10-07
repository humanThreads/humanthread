import { beforeEach, describe, expect, it, vi } from "vitest";

import { DELETE, PATCH } from "./route";

vi.mock("@/lib/workbench/workbench-api-session", () => ({
  resolveWorkbenchApiActor: vi.fn(),
}));
vi.mock("@humanthread/db", () => ({
  revokeWorkerModelSite: vi.fn(),
  updateWorkerModelSiteModels: vi.fn(),
}));
vi.mock("@/lib/orchestration/worker-resource-scope", () => ({
  resolveWorkerManagementScope: vi.fn(),
}));

describe("DELETE /api/worker-model-sites/:siteId", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const { resolveWorkbenchApiActor } = await import("@/lib/workbench/workbench-api-session");
    const { resolveWorkerManagementScope } = await import("@/lib/orchestration/worker-resource-scope");
    vi.mocked(resolveWorkbenchApiActor).mockResolvedValue({ userId: "user_owner" } as never);
    vi.mocked(resolveWorkerManagementScope).mockResolvedValue({
      scope: { ownerType: "personal", ownerUserId: "user_owner", companyId: null },
    } as never);
  });

  it("revokes a model site in the actor's resolved scope", async () => {
    const { revokeWorkerModelSite } = await import("@humanthread/db");
    const response = await DELETE(new Request("http://localhost/api/worker-model-sites/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"), {
      params: Promise.resolve({ siteId: "b".repeat(32) }),
    });

    expect(response.status).toBe(200);
    expect(revokeWorkerModelSite).toHaveBeenCalledWith(expect.objectContaining({
      siteId: "b".repeat(32), actorUserId: "user_owner",
      scope: { ownerType: "personal", ownerUserId: "user_owner", companyId: null },
    }));
    await expect(response.json()).resolves.toEqual({ ok: true });
  });

  it("replaces the model catalogue without accepting endpoint or key fields", async () => {
    const { updateWorkerModelSiteModels } = await import("@humanthread/db");
    vi.mocked(updateWorkerModelSiteModels).mockResolvedValue({
      id: "b".repeat(32),
      name: "proxy",
      endpoint: "https://codex.example.com/v1",
      models: [{ name: "gpt-5.6-terra", label: "GPT-5.6 Terra" }],
      status: "active",
    } as never);

    const response = await PATCH(new Request("http://localhost/api/worker-model-sites/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ models: [{ name: "gpt-5.6-terra", label: "GPT-5.6 Terra" }] }),
    }), {
      params: Promise.resolve({ siteId: "b".repeat(32) }),
    });

    expect(response.status).toBe(200);
    expect(updateWorkerModelSiteModels).toHaveBeenCalledWith(expect.objectContaining({
      siteId: "b".repeat(32),
      actorUserId: "user_owner",
      scope: { ownerType: "personal", ownerUserId: "user_owner", companyId: null },
      models: [{ name: "gpt-5.6-terra", label: "GPT-5.6 Terra" }],
    }));
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      result: { models: [{ name: "gpt-5.6-terra", label: "GPT-5.6 Terra" }] },
    });
  });

  it("rejects catalogue updates that try to alter credentials", async () => {
    const { updateWorkerModelSiteModels } = await import("@humanthread/db");
    const response = await PATCH(new Request("http://localhost/api/worker-model-sites/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        models: [{ name: "gpt-5.6-terra", label: "GPT-5.6 Terra" }],
        apiKey: "rotated-key",
      }),
    }), {
      params: Promise.resolve({ siteId: "b".repeat(32) }),
    });

    expect(response.status).toBe(400);
    expect(updateWorkerModelSiteModels).not.toHaveBeenCalled();
  });
});
