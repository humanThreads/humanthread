import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@humanthread/db", () => ({
  authenticateWorkerPoolSession: vi.fn(),
}));

vi.mock("@/lib/orchestration/worker-commands", () => ({
  appendLinuxWorkerAssignmentEventsWithPrisma: vi.fn(),
}));

import { POST } from "./route";

describe("POST /api/worker-pools/assignments/:agentRunId/events", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const { authenticateWorkerPoolSession } = await import("@humanthread/db");
    const { appendLinuxWorkerAssignmentEventsWithPrisma } = await import("@/lib/orchestration/worker-commands");
    vi.mocked(authenticateWorkerPoolSession).mockResolvedValue({
      sessionId: "b".repeat(32),
      workerPoolId: "a".repeat(32),
      ownerUserId: "user_owner",
      instanceId: "disaster-1",
      capabilities: { gpu: true },
      requestedConcurrency: 2,
    } as never);
    vi.mocked(appendLinuxWorkerAssignmentEventsWithPrisma).mockResolvedValue({ acceptedThroughSequence: 1 } as never);
  });

  it("uses the authenticated Pool session for Linux event persistence", async () => {
    const { appendLinuxWorkerAssignmentEventsWithPrisma } = await import("@/lib/orchestration/worker-commands");
    const response = await POST(new Request("http://localhost/api/worker-pools/assignments/agent_run_1/events", {
      method: "POST",
      headers: { "content-type": "application/json", "x-worker-pool-session": "htwps_session" },
      body: JSON.stringify({
        poolId: "a".repeat(32),
        leaseGeneration: 5,
        commandId: "events_1",
        loopNodeAttemptId: "loop_attempt_linux_1",
        events: [{
          eventId: "event_linux_1",
          loopRunId: "loop_run_linux_1",
          loopNodeRunId: "node_run_linux_1",
          loopNodeAttemptId: "loop_attempt_linux_1",
          attemptNo: 1,
          leaseGeneration: 5,
          sequence: 1,
          eventType: "loop.node.progressed",
          occurredAt: "2026-08-24T08:00:00.000Z",
          payloadSummary: { phase: "running" },
          artifactRefs: [],
        }],
      }),
    }), { params: Promise.resolve({ agentRunId: "agent_run_1" }) });

    expect(response.status).toBe(200);
    expect(appendLinuxWorkerAssignmentEventsWithPrisma).toHaveBeenCalledWith(expect.objectContaining({
      agentRunId: "agent_run_1",
      sessionId: "b".repeat(32),
      leaseGeneration: 5,
    }));
  });
});
