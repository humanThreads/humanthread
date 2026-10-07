import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";

vi.mock("@humanthread/db", () => ({
  authenticateWorkerPoolBootstrapToken: vi.fn(),
  createWorkerPoolSession: vi.fn(),
  WORKER_POOL_SESSION_DURATION_MS: 15 * 60 * 1_000,
}));

describe("POST /api/worker-pools/register", () => {
  beforeEach(() => vi.clearAllMocks());

  it("exchanges a valid pool bootstrap token for an expiring instance session", async () => {
    const { authenticateWorkerPoolBootstrapToken, createWorkerPoolSession } = await import("@humanthread/db");
    vi.mocked(authenticateWorkerPoolBootstrapToken).mockResolvedValue({
      id: "a".repeat(32),
      ownerType: "personal",
      ownerUserId: "user_owner",
      companyId: null,
      displayName: "disaster-gpu",
      status: "active",
      maxConcurrentRuns: 2,
      health: "offline",
      capacity: 0,
      currentRuns: 0,
      runtime: "docker",
      taskGroupName: null,
      aliveInstanceCount: 0,
      instances: [],
      configuration: { gpu: true },
      tokenVersion: 1,
      lastSeenAt: null,
      revokedAt: null,
      createdAt: "2026-08-23T08:00:00.000Z",
      updatedAt: "2026-08-23T08:00:00.000Z",
    });
    vi.mocked(createWorkerPoolSession).mockResolvedValue({
      sessionId: "b".repeat(32),
      sessionToken: "htwps_session_value",
      expiresAt: new Date("2026-08-23T09:00:00.000Z"),
    });

    const response = await POST(new Request("http://localhost/api/worker-pools/register", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-worker-pool-token": "htwp_bootstrap_value",
      },
      body: JSON.stringify({
        instanceId: "disaster-worker-1",
        poolName: "disaster-gpu",
        runtime: "kubernetes",
        taskGroupName: "ht-agnet",
        capabilities: { gpu: true, unity: true },
        requestedConcurrency: 2,
      }),
    }));

    expect(response.status).toBe(200);
    expect(authenticateWorkerPoolBootstrapToken).toHaveBeenCalledWith(expect.objectContaining({
      token: "htwp_bootstrap_value",
    }));
    expect(createWorkerPoolSession).toHaveBeenCalledWith(expect.objectContaining({
      poolId: "a".repeat(32),
      instanceId: "disaster-worker-1",
      poolName: "disaster-gpu",
      runtime: "kubernetes",
      taskGroupName: "ht-agnet",
      requestedConcurrency: 2,
    }));
    await expect(response.json()).resolves.toEqual({
      poolId: "a".repeat(32),
      sessionId: "b".repeat(32),
      sessionToken: "htwps_session_value",
      expiresAt: "2026-08-23T09:00:00.000Z",
    });
  });

  it("rejects a deployment label that does not match the token-owned pool", async () => {
    const { authenticateWorkerPoolBootstrapToken, createWorkerPoolSession } = await import("@humanthread/db");
    vi.mocked(authenticateWorkerPoolBootstrapToken).mockResolvedValue({
      id: "a".repeat(32), ownerType: "personal", ownerUserId: "user_owner", companyId: null, displayName: "standard-linux", status: "active",
      maxConcurrentRuns: 2, health: "offline", capacity: 0, currentRuns: 0, runtime: "docker", taskGroupName: null, aliveInstanceCount: 0, configuration: {}, tokenVersion: 1,
      instances: [],
      lastSeenAt: null, revokedAt: null, createdAt: "2026-08-23T08:00:00.000Z", updatedAt: "2026-08-23T08:00:00.000Z",
    });

    const response = await POST(new Request("http://localhost/api/worker-pools/register", {
      method: "POST",
      headers: { "content-type": "application/json", "x-worker-pool-token": "htwp_bootstrap_value" },
      body: JSON.stringify({ instanceId: "disaster-worker-1", poolName: "disaster-gpu", capabilities: {}, requestedConcurrency: 1 }),
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ errorCode: "worker_pool_configuration_required" });
    expect(createWorkerPoolSession).not.toHaveBeenCalled();
  });

  it("rejects a registration without a pool token before looking up a pool", async () => {
    const { authenticateWorkerPoolBootstrapToken } = await import("@humanthread/db");
    const response = await POST(new Request("http://localhost/api/worker-pools/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        instanceId: "disaster-worker-1",
        capabilities: { gpu: true },
        requestedConcurrency: 1,
      }),
    }));

    expect(response.status).toBe(401);
    expect(authenticateWorkerPoolBootstrapToken).not.toHaveBeenCalled();
  });
});
