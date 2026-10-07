import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

vi.mock("../../../../../../lib/agent/agent-auth", () => ({
  authenticateAgentRequest: vi.fn().mockResolvedValue({
    userId: "user_1",
    teamId: "team_1",
    deviceId: "device_1",
  }),
}));

vi.mock("../../../../../../lib/orchestration/worker-commands", () => ({
  completeLoopAssignmentWithPrisma: vi.fn().mockResolvedValue({
    completed: true,
    duplicate: false,
  }),
}));

const requestBody = () => ({
  userId: "user_1",
  deviceId: "device_1",
  workerId: "worker_1",
  agentVersion: "Agent v0.1.2 · f0c5160a",
  leaseGeneration: 3,
  commandId: "result_1",
  loopRunId: "loop_run_1",
  loopNodeRunId: "node_run_1",
  loopNodeAttemptId: "attempt_1",
  attemptNo: 1,
  result: {
    outcome: "success",
    output: { done: true },
    artifactRefs: [],
    effectReceipts: [],
  },
});

describe("POST /api/agent/loop-assignments/:agentRunId/result", () => {
  beforeEach(() => vi.clearAllMocks());

  it("uses the path AgentRun identity for an authenticated result", async () => {
    const { completeLoopAssignmentWithPrisma } = await import("../../../../../../lib/orchestration/worker-commands");
    const response = await POST(new Request("http://localhost/api/agent/loop-assignments/run_1/result", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer user_token",
        "x-agent-device-token": "device_token",
      },
      body: JSON.stringify(requestBody()),
    }), { params: Promise.resolve({ agentRunId: "run_1" }) });

    expect(response.status).toBe(200);
    expect(completeLoopAssignmentWithPrisma).toHaveBeenCalledWith(expect.objectContaining({
      agentRunId: "run_1",
      commandId: "result_1",
      leaseGeneration: 3,
    }));
  });

  it("maps a stale lease to 409", async () => {
    const { completeLoopAssignmentWithPrisma } = await import("../../../../../../lib/orchestration/worker-commands");
    vi.mocked(completeLoopAssignmentWithPrisma).mockRejectedValueOnce(
      Object.assign(new Error("Stale lease"), { code: "stale_lease" }),
    );
    const response = await POST(new Request("http://localhost/api/agent/loop-assignments/run_1/result", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(requestBody()),
    }), { params: Promise.resolve({ agentRunId: "run_1" }) });

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ ok: false, code: "stale_lease" });
  });

  it("maps a missing leased AgentRun to stale_lease so old clients discard it", async () => {
    const { completeLoopAssignmentWithPrisma } = await import("../../../../../../lib/orchestration/worker-commands");
    vi.mocked(completeLoopAssignmentWithPrisma).mockRejectedValueOnce(
      Object.assign(new Error("AgentRun not found"), { code: "not_found" }),
    );
    const response = await POST(new Request("http://localhost/api/agent/loop-assignments/run_1/result", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(requestBody()),
    }), { params: Promise.resolve({ agentRunId: "run_1" }) });

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ ok: false, code: "stale_lease" });
  });

  it("rejects unknown result fields before authentication", async () => {
    const { authenticateAgentRequest } = await import("../../../../../../lib/agent/agent-auth");
    const response = await POST(new Request("http://localhost/api/agent/loop-assignments/run_1/result", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...requestBody(), callbackSecret: "raw" }),
    }), { params: Promise.resolve({ agentRunId: "run_1" }) });

    expect(response.status).toBe(400);
    expect(authenticateAgentRequest).not.toHaveBeenCalled();
  });
});
