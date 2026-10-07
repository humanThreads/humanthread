import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@humanthread/db", () => ({
  authenticateWorkerPoolSession: vi.fn(),
}));

vi.mock("@/lib/orchestration/worker-commands", () => ({
  heartbeatLinuxWorkerAssignmentWithPrisma: vi.fn(),
}));

import { POST } from "./route";

describe("POST /api/worker-pools/assignments/:agentRunId/heartbeat", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const { authenticateWorkerPoolSession } = await import("@humanthread/db");
    const { heartbeatLinuxWorkerAssignmentWithPrisma } = await import("@/lib/orchestration/worker-commands");
    vi.mocked(authenticateWorkerPoolSession).mockResolvedValue({
      sessionId: "b".repeat(32),
      workerPoolId: "a".repeat(32),
      ownerUserId: "user_owner",
      instanceId: "disaster-1",
      capabilities: { gpu: true },
      requestedConcurrency: 2,
    } as never);
    vi.mocked(heartbeatLinuxWorkerAssignmentWithPrisma).mockResolvedValue({
      leaseExpiresAt: "2026-08-24T08:01:00.000Z",
      leaseDurationMs: 60_000,
    } as never);
  });

  it("authenticates the pool session and passes only its server-side identity to the lease command", async () => {
    const { authenticateWorkerPoolSession } = await import("@humanthread/db");
    const { heartbeatLinuxWorkerAssignmentWithPrisma } = await import("@/lib/orchestration/worker-commands");
    const response = await POST(new Request("http://localhost/api/worker-pools/assignments/agent_run_1/heartbeat", {
      method: "POST",
      headers: { "content-type": "application/json", "x-worker-pool-session": "htwps_session" },
      body: JSON.stringify({
        poolId: "a".repeat(32),
        leaseGeneration: 5,
        commandId: "heartbeat_1",
      }),
    }), { params: Promise.resolve({ agentRunId: "agent_run_1" }) });

    expect(response.status).toBe(200);
    expect(authenticateWorkerPoolSession).toHaveBeenCalledWith(expect.objectContaining({
      poolId: "a".repeat(32), sessionToken: "htwps_session",
    }));
    expect(heartbeatLinuxWorkerAssignmentWithPrisma).toHaveBeenCalledWith(expect.objectContaining({
      agentRunId: "agent_run_1",
      sessionId: "b".repeat(32),
      poolId: "a".repeat(32),
      leaseGeneration: 5,
    }));
    await expect(response.json()).resolves.toMatchObject({ ok: true });
  });

  it("rejects a heartbeat with no pool session before it reaches the lease command", async () => {
    const { authenticateWorkerPoolSession } = await import("@humanthread/db");
    const { heartbeatLinuxWorkerAssignmentWithPrisma } = await import("@/lib/orchestration/worker-commands");
    const response = await POST(new Request("http://localhost/api/worker-pools/assignments/agent_run_1/heartbeat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ poolId: "a".repeat(32), leaseGeneration: 5, commandId: "heartbeat_1" }),
    }), { params: Promise.resolve({ agentRunId: "agent_run_1" }) });

    expect(response.status).toBe(401);
    expect(authenticateWorkerPoolSession).not.toHaveBeenCalled();
    expect(heartbeatLinuxWorkerAssignmentWithPrisma).not.toHaveBeenCalled();
  });
});
