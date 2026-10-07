import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@humanthread/db", () => ({
  authenticateWorkerPoolSession: vi.fn(),
}));

vi.mock("@/lib/orchestration/worker-commands", () => ({
  saveLinuxWorkerAssignmentCheckpointWithPrisma: vi.fn(),
}));

import { POST } from "./route";

describe("POST /api/worker-pools/assignments/:agentRunId/checkpoint", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const { authenticateWorkerPoolSession } = await import("@humanthread/db");
    const { saveLinuxWorkerAssignmentCheckpointWithPrisma } = await import("@/lib/orchestration/worker-commands");
    vi.mocked(authenticateWorkerPoolSession).mockResolvedValue({
      sessionId: "b".repeat(32), workerPoolId: "a".repeat(32), ownerUserId: "user_owner",
      instanceId: "disaster-1", capabilities: { gpu: true }, requestedConcurrency: 2,
    } as never);
    vi.mocked(saveLinuxWorkerAssignmentCheckpointWithPrisma).mockResolvedValue({ checkpointed: true, duplicate: false } as never);
  });

  it("passes the authenticated Pool session into the checkpoint fence", async () => {
    const { saveLinuxWorkerAssignmentCheckpointWithPrisma } = await import("@/lib/orchestration/worker-commands");
    const response = await POST(new Request("http://localhost/api/worker-pools/assignments/agent_run_1/checkpoint", {
      method: "POST",
      headers: { "content-type": "application/json", "x-worker-pool-session": "htwps_session" },
      body: JSON.stringify({
        poolId: "a".repeat(32), leaseGeneration: 5, commandId: "checkpoint_1",
        loopRunId: "loop_run_linux_1", loopNodeRunId: "node_run_linux_1",
        loopNodeAttemptId: "loop_attempt_linux_1", attemptNo: 1, checkpoint: { phase: "running" },
      }),
    }), { params: Promise.resolve({ agentRunId: "agent_run_1" }) });

    expect(response.status).toBe(200);
    expect(saveLinuxWorkerAssignmentCheckpointWithPrisma).toHaveBeenCalledWith(expect.objectContaining({
      agentRunId: "agent_run_1", sessionId: "b".repeat(32), leaseGeneration: 5,
    }));
  });
});
