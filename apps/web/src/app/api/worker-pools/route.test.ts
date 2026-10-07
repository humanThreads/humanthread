import { beforeEach, describe, expect, it, vi } from "vitest";

import { GET, POST } from "./route";

vi.mock("@/lib/workbench/workbench-api-session", () => ({
  resolveWorkbenchApiActor: vi.fn(),
}));
vi.mock("@humanthread/db", () => ({
  createWorkerPool: vi.fn(),
  listWorkerPools: vi.fn(),
}));

describe("/api/worker-pools", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const { resolveWorkbenchApiActor } = await import("@/lib/workbench/workbench-api-session");
    vi.mocked(resolveWorkbenchApiActor).mockResolvedValue({
      userId: "user_owner",
      authKind: "web_session",
      webSessionId: "a".repeat(32),
    });
  });

  it("lists only Worker pools belonging to the signed-in user", async () => {
    const { listWorkerPools } = await import("@humanthread/db");
    vi.mocked(listWorkerPools).mockResolvedValue([]);

    const response = await GET(new Request("http://localhost/api/worker-pools"));

    expect(response.status).toBe(200);
    expect(listWorkerPools).toHaveBeenCalledWith({
      actorUserId: "user_owner",
      scope: { ownerType: "personal", ownerUserId: "user_owner", companyId: null },
    });
    await expect(response.json()).resolves.toEqual({ pools: [] });
  });

  it("creates a pool for the signed-in user and returns the bootstrap token only at issuance", async () => {
    const { createWorkerPool } = await import("@humanthread/db");
    vi.mocked(createWorkerPool).mockResolvedValue({
      pool: {
        id: "a".repeat(32), ownerType: "personal", ownerUserId: "user_owner", companyId: null, displayName: "disaster-gpu", status: "active",
        maxConcurrentRuns: 2, health: "offline", capacity: 0, currentRuns: 0, instances: [], configuration: { gpuConcurrency: 1 }, tokenVersion: 1,
        runtime: "docker", taskGroupName: null, aliveInstanceCount: 0,
        lastSeenAt: null, revokedAt: null, createdAt: "2026-08-23T08:00:00.000Z", updatedAt: "2026-08-23T08:00:00.000Z",
      },
      bootstrapToken: "htwp_bootstrap_value",
    });

    const response = await POST(new Request("http://localhost/api/worker-pools", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        displayName: "disaster-gpu",
        maxConcurrentRuns: 2,
        configuration: { gpuConcurrency: 1 },
      }),
    }));

    expect(response.status).toBe(201);
    expect(createWorkerPool).toHaveBeenCalledWith(expect.objectContaining({
      actorUserId: "user_owner", displayName: "disaster-gpu", maxConcurrentRuns: 2,
    }));
    await expect(response.json()).resolves.toMatchObject({ bootstrapToken: "htwp_bootstrap_value" });
  });
});
