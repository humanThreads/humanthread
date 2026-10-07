import { describe, expect, it, vi } from "vitest";

vi.mock("../../../../lib/agent/agent-auth", () => ({
  authenticateAgentRequest: vi.fn().mockResolvedValue({
    userId: "user_1",
    teamId: "team_1",
    deviceId: "device_1",
  }),
}));

vi.mock("../../../../lib/orchestration/worker-commands", () => ({
  heartbeatLoopAssignmentWithPrisma: vi.fn().mockResolvedValue({
    leaseExpiresAt: "2026-07-30T09:00:00.000Z",
  }),
  appendLoopAssignmentEventsWithPrisma: vi.fn().mockResolvedValue({
    acceptedThroughSequence: 1,
  }),
  saveLoopAssignmentCheckpointWithPrisma: vi.fn().mockResolvedValue({
    checkpointed: true,
  }),
  uploadLoopAssignmentArtifactWithPrisma: vi.fn().mockResolvedValue({
    artifactId: "a".repeat(32),
  }),
}));

const context = { params: Promise.resolve({ agentRunId: "run_1" }) };
const base = {
  userId: "user_1",
  deviceId: "device_1",
  workerId: "worker_1",
  leaseGeneration: 3,
  commandId: "command_1",
};

function request(path: string, body: unknown): Request {
  return new Request(`http://localhost/api/agent/loop-assignments/run_1/${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: "Bearer user_token",
      "x-agent-device-token": "device_token",
      origin: "tauri://localhost",
    },
    body: JSON.stringify(body),
  });
}

describe("graph assignment mutation routes", () => {
  it("loads and executes heartbeat, event, and checkpoint routes", async () => {
    const { heartbeatLoopAssignmentWithPrisma } = await import("../../../../lib/orchestration/worker-commands");
    const heartbeat = await import("./[agentRunId]/heartbeat/route");
    const events = await import("./[agentRunId]/events/route");
    const checkpoint = await import("./[agentRunId]/checkpoint/route");

    const heartbeatResponse = await heartbeat.POST(request("heartbeat", {
      ...base,
      agentVersion: "Agent v0.1.2 · e16bff4c",
      capabilitySnapshot: {
        providers: [{ name: "codex", version: "0.108.0" }],
        capabilities: ["workspace", "commands"],
        loginStateCategories: ["provider_account"],
        maxConcurrency: 1,
      },
    }), context);
    const eventsResponse = await events.POST(request("events", {
      ...base,
      agentVersion: "Agent v0.1.2 · e16bff4c",
      loopNodeAttemptId: "attempt_1",
      events: [{
        eventId: "event_1",
        loopRunId: "loop_run_1",
        loopNodeRunId: "node_run_1",
        loopNodeAttemptId: "attempt_1",
        attemptNo: 1,
        leaseGeneration: 3,
        sequence: 1,
        eventType: "loop.node.progressed",
        occurredAt: "2026-07-30T08:00:00.000Z",
        payloadSummary: { phase: "working" },
        artifactRefs: [],
      }],
    }), context);
    const checkpointResponse = await checkpoint.POST(request("checkpoint", {
      ...base,
      agentVersion: "Agent v0.1.2 · e16bff4c",
      loopRunId: "loop_run_1",
      loopNodeRunId: "node_run_1",
      loopNodeAttemptId: "attempt_1",
      attemptNo: 1,
      checkpoint: { phase: "working" },
    }), context);

    expect([heartbeatResponse.status, eventsResponse.status, checkpointResponse.status])
      .toEqual([200, 200, 200]);
    expect(heartbeatResponse.headers.get("access-control-allow-origin"))
      .toBe("tauri://localhost");
    expect(heartbeatLoopAssignmentWithPrisma).toHaveBeenCalledWith(expect.objectContaining({
      agentRunId: "run_1",
      workerId: "worker_1",
      agentVersion: "Agent v0.1.2 · e16bff4c",
    }));
  });

  it("uploads an Agent-generated review page through the leased assignment route", async () => {
    const { uploadLoopAssignmentArtifactWithPrisma } = await import("../../../../lib/orchestration/worker-commands");
    const artifacts = await import("./[agentRunId]/artifacts/route");

    const response = await artifacts.POST(request("artifacts", {
      ...base,
      loopRunId: "loop_run_1",
      loopNodeRunId: "node_run_1",
      loopNodeAttemptId: "attempt_1",
      attemptNo: 1,
      relativePath: "generated/reviews/TASK-1001-chapter-plan.html",
      content: "<!doctype html><html><body>review</body></html>",
    }), context);

    expect(response.status).toBe(200);
    expect(uploadLoopAssignmentArtifactWithPrisma).toHaveBeenCalledWith(expect.objectContaining({
      agentRunId: "run_1",
      workerId: "worker_1",
      deviceId: "device_1",
      leaseGeneration: 3,
      loopRunId: "loop_run_1",
      loopNodeRunId: "node_run_1",
      loopNodeAttemptId: "attempt_1",
      attemptNo: 1,
      relativePath: "generated/reviews/TASK-1001-chapter-plan.html",
      content: "<!doctype html><html><body>review</body></html>",
    }));
  });
});
