import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@humanthread/db", () => ({
  authenticateWorkerPoolSession: vi.fn(),
}));

vi.mock("@/lib/orchestration/worker-commands", () => ({
  completeLinuxWorkerAssignmentWithPrisma: vi.fn(),
}));

import { POST } from "./route";

describe("POST /api/worker-pools/assignments/:agentRunId/result", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const { authenticateWorkerPoolSession } = await import("@humanthread/db");
    const { completeLinuxWorkerAssignmentWithPrisma } = await import("@/lib/orchestration/worker-commands");
    vi.mocked(authenticateWorkerPoolSession).mockResolvedValue({
      sessionId: "b".repeat(32), workerPoolId: "a".repeat(32), ownerUserId: "user_owner",
      instanceId: "disaster-1", capabilities: { gpu: true }, requestedConcurrency: 2,
    } as never);
    vi.mocked(completeLinuxWorkerAssignmentWithPrisma).mockResolvedValue({ completed: true, duplicate: false } as never);
  });

  it("submits a result through the authenticated Pool session lease", async () => {
    const { completeLinuxWorkerAssignmentWithPrisma } = await import("@/lib/orchestration/worker-commands");
    const response = await POST(new Request("http://localhost/api/worker-pools/assignments/agent_run_1/result", {
      method: "POST",
      headers: { "content-type": "application/json", "x-worker-pool-session": "htwps_session" },
      body: JSON.stringify({
        poolId: "a".repeat(32), leaseGeneration: 5, commandId: "result_1",
        loopRunId: "loop_run_linux_1", loopNodeRunId: "node_run_linux_1",
        loopNodeAttemptId: "loop_attempt_linux_1", attemptNo: 1,
        result: { outcome: "success", output: { done: true }, artifactRefs: [], effectReceipts: [] },
      }),
    }), { params: Promise.resolve({ agentRunId: "agent_run_1" }) });

    expect(response.status).toBe(200);
    expect(completeLinuxWorkerAssignmentWithPrisma).toHaveBeenCalledWith(expect.objectContaining({
      agentRunId: "agent_run_1", sessionId: "b".repeat(32), leaseGeneration: 5, commandId: "result_1",
    }));
  });
});
