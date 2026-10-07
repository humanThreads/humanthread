import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@humanthread/db", () => ({
  authenticateWorkerPoolSession: vi.fn(),
}));

vi.mock("@/lib/orchestration/worker-commands", () => ({
  uploadLinuxWorkerAssignmentArtifactWithPrisma: vi.fn(),
}));

import { POST } from "./route";

describe("POST /api/worker-pools/assignments/:agentRunId/artifacts", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const { authenticateWorkerPoolSession } = await import("@humanthread/db");
    const { uploadLinuxWorkerAssignmentArtifactWithPrisma } = await import("@/lib/orchestration/worker-commands");
    vi.mocked(authenticateWorkerPoolSession).mockResolvedValue({
      sessionId: "b".repeat(32), workerPoolId: "a".repeat(32), ownerUserId: "user_owner",
      instanceId: "worker-1", capabilities: {}, requestedConcurrency: 1,
    } as never);
    vi.mocked(uploadLinuxWorkerAssignmentArtifactWithPrisma).mockResolvedValue({
      artifactId: "c".repeat(32),
      storageKey: `loop-review-artifacts/${"d".repeat(32)}/${"c".repeat(32)}.html`,
      relativePath: "generated/reviews/chapter-plan.html",
      mimeType: "text/html",
    } as never);
  });

  it("uploads a review HTML artifact through the authenticated Pool session lease", async () => {
    const { uploadLinuxWorkerAssignmentArtifactWithPrisma } = await import("@/lib/orchestration/worker-commands");
    const response = await POST(new Request("http://localhost/api/worker-pools/assignments/agent_run_1/artifacts", {
      method: "POST",
      headers: { "content-type": "application/json", "x-worker-pool-session": "htwps_session" },
      body: JSON.stringify({
        poolId: "a".repeat(32), leaseGeneration: 5, commandId: "artifact_1",
        loopRunId: "loop_run_linux_1", loopNodeRunId: "node_run_linux_1",
        loopNodeAttemptId: "loop_attempt_linux_1", attemptNo: 1,
        relativePath: "generated/reviews/chapter-plan.html",
        content: "<html>review</html>",
      }),
    }), { params: Promise.resolve({ agentRunId: "agent_run_1" }) });

    expect(response.status).toBe(200);
    expect(uploadLinuxWorkerAssignmentArtifactWithPrisma).toHaveBeenCalledWith(expect.objectContaining({
      agentRunId: "agent_run_1", sessionId: "b".repeat(32), leaseGeneration: 5, commandId: "artifact_1",
      relativePath: "generated/reviews/chapter-plan.html", content: "<html>review</html>",
    }));
  });

  it("rejects a request without a Pool session token", async () => {
    const response = await POST(new Request("http://localhost/api/worker-pools/assignments/agent_run_1/artifacts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        poolId: "a".repeat(32), leaseGeneration: 5, commandId: "artifact_1",
        loopRunId: "loop_run_linux_1", loopNodeRunId: "node_run_linux_1",
        loopNodeAttemptId: "loop_attempt_linux_1", attemptNo: 1,
        relativePath: "generated/reviews/chapter-plan.html", content: "<html>review</html>",
      }),
    }), { params: Promise.resolve({ agentRunId: "agent_run_1" }) });

    expect(response.status).toBe(401);
  });
});
