import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

vi.mock("../../../../../lib/agent/agent-auth", () => ({
  authenticateAgentRequest: vi.fn().mockResolvedValue({
    userId: "user_1",
    teamId: "team_1",
    deviceId: "device_1",
  }),
}));

vi.mock("../../../../../lib/orchestration/worker-commands", () => ({
  claimLoopAssignmentWithPrisma: vi.fn().mockResolvedValue({
    assignment: null,
    leaseGeneration: null,
    leaseExpiresAt: null,
  }),
}));

vi.mock("../../../../../lib/agent/agent-device-registration", () => ({
  heartbeatLocalAgentWorker: vi.fn().mockResolvedValue({
    workerId: "local-worker:device_1",
  }),
}));

vi.mock("@humanthread/db", () => ({
  prisma: {
    liveSession: {
      findFirst: vi.fn(),
      updateMany: vi.fn(),
    },
  },
}));

vi.mock("../../../../../lib/workbench/workbench-site-settings", () => ({
  getWorkbenchSiteSettings: vi.fn().mockResolvedValue({
    siteBaseUrl: "http://localhost:3000",
    mcpUrl: "http://localhost:3000/api/mcp",
    userTasks: {},
  }),
}));

vi.mock("../../../../../lib/live-session/live-session-store", () => ({
  ensureLoopAttemptLiveSessionWithPrisma: vi.fn(),
  derivedLoopLiveSessionId: vi.fn(),
}));

const capabilitySnapshot = {
  providers: [{ name: "codex", version: "0.108.0" }],
  capabilities: ["workspace", "commands"],
  loginStateCategories: ["provider_account"],
  maxConcurrency: 1,
};

describe("POST /api/agent/loop-assignments/claim", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const { prisma } = await import("@humanthread/db");
    vi.mocked(prisma.liveSession.findFirst).mockResolvedValue(null as never);
    vi.mocked(prisma.liveSession.updateMany).mockResolvedValue({ count: 1 } as never);
    const { ensureLoopAttemptLiveSessionWithPrisma } = await import("../../../../../lib/live-session/live-session-store");
    vi.mocked(ensureLoopAttemptLiveSessionWithPrisma).mockResolvedValue({
      unavailableCode: "live_stream_owner_unavailable",
    } as never);
  });

  it("creates an attempt-bound observation session for the claimed Agent assignment", async () => {
    process.env.HUMANTHREAD_DESKTOP_SESSION_SECRET = "agent-claim-route-ticket-secret";
    const { claimLoopAssignmentWithPrisma } = await import("../../../../../lib/orchestration/worker-commands");
    const { ensureLoopAttemptLiveSessionWithPrisma } = await import("../../../../../lib/live-session/live-session-store");
    vi.mocked(claimLoopAssignmentWithPrisma).mockResolvedValueOnce({
      assignment: {
        agentRunId: "agent_run_1",
        loopRunId: "loop_run_1",
        loopNodeRunId: "node_run_1",
        loopNodeAttemptId: "attempt_1",
        attemptNo: 1,
        leaseGeneration: 4,
      },
      leaseGeneration: 4,
      leaseExpiresAt: "2026-09-24T10:01:00.000Z",
    } as never);
    const sessionId = "e".repeat(32);
    vi.mocked(ensureLoopAttemptLiveSessionWithPrisma).mockResolvedValueOnce({
      session: {
        id: sessionId,
        kind: "agent",
        surface: "web",
        spaceId: "space_1",
        projectId: "project_1",
        taskId: "task_1",
        executionPolicy: "loop",
        target: { type: "agent_device", deviceId: "device_1", displayName: "Mac Studio" },
        targetDisplayName: "Mac Studio",
        businessRun: { type: "loop_run", id: "loop_run_1" },
        loopAttempt: {
          loopRunId: "loop_run_1",
          loopNodeRunId: "node_run_1",
          loopNodeAttemptId: "attempt_1",
          attemptNo: 1,
          leaseGeneration: 4,
        },
        status: "starting",
        controlState: "detached",
        journal: { status: "ready", retentionDays: 30, firstSequence: 0, lastSequence: 0 },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      executionTicket: { token: "lst1.attempt.agent.ticket" },
    } as never);

    const response = await POST(new Request("http://localhost/api/agent/loop-assignments/claim", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer user_token",
        "x-agent-device-token": "device_token",
        origin: "tauri://localhost",
      },
      body: JSON.stringify({
        userId: "user_1",
        deviceId: "device_1",
        workerId: "local-worker:device_1",
        capabilitySnapshot,
      }),
    }));
    const body = await response.json();

    expect(ensureLoopAttemptLiveSessionWithPrisma).toHaveBeenCalledWith({
      loopRunId: "loop_run_1",
      loopNodeRunId: "node_run_1",
      loopNodeAttemptId: "attempt_1",
      attemptNo: 1,
      leaseGeneration: 4,
      target: { type: "agent_device", deviceId: "device_1" },
      now: expect.any(Date),
    });
    expect(body.result.assignment.liveSession).toMatchObject({
      sessionId,
      authorization: "lst1.attempt.agent.ticket",
    });
  });

  it("marks the attempt-bound Agent session running before dispatching it", async () => {
    process.env.HUMANTHREAD_DESKTOP_SESSION_SECRET = "agent-claim-route-ticket-secret";
    const { claimLoopAssignmentWithPrisma } = await import("../../../../../lib/orchestration/worker-commands");
    const { ensureLoopAttemptLiveSessionWithPrisma } = await import("../../../../../lib/live-session/live-session-store");
    const { prisma } = await import("@humanthread/db");
    vi.mocked(claimLoopAssignmentWithPrisma).mockResolvedValueOnce({
      assignment: {
        agentRunId: "agent_run_1",
        loopRunId: "loop_run_1",
        loopNodeRunId: "node_run_1",
        loopNodeAttemptId: "attempt_1",
        attemptNo: 1,
        leaseGeneration: 4,
      },
      leaseGeneration: 4,
      leaseExpiresAt: "2026-09-24T10:01:00.000Z",
    } as never);
    const sessionId = "e".repeat(32);
    vi.mocked(ensureLoopAttemptLiveSessionWithPrisma).mockResolvedValueOnce({
      session: {
        id: sessionId,
        kind: "agent",
        surface: "web",
        spaceId: "space_1",
        projectId: "project_1",
        taskId: "task_1",
        executionPolicy: "loop",
        target: { type: "agent_device", deviceId: "device_1", displayName: "Mac Studio" },
        targetDisplayName: "Mac Studio",
        businessRun: { type: "loop_run", id: "loop_run_1" },
        loopAttempt: {
          loopRunId: "loop_run_1",
          loopNodeRunId: "node_run_1",
          loopNodeAttemptId: "attempt_1",
          attemptNo: 1,
          leaseGeneration: 4,
        },
        status: "starting",
        controlState: "detached",
        journal: { status: "ready", retentionDays: 30, firstSequence: 0, lastSequence: 0 },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      executionTicket: { token: "lst1.attempt.agent.ticket" },
    } as never);

    await POST(new Request("http://localhost/api/agent/loop-assignments/claim", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer user_token",
        "x-agent-device-token": "device_token",
        origin: "tauri://localhost",
      },
      body: JSON.stringify({
        userId: "user_1",
        deviceId: "device_1",
        workerId: "local-worker:device_1",
        capabilitySnapshot,
      }),
    }));

    expect(prisma.liveSession.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: sessionId,
        autoCreated: true,
        loopNodeAttemptId: "attempt_1",
        leaseGeneration: 4,
        status: "starting",
      }),
      data: expect.objectContaining({ status: "running" }),
    }));
  });

  it("keeps the Agent assignment successful when automatic session creation fails", async () => {
    process.env.HUMANTHREAD_DESKTOP_SESSION_SECRET = "agent-claim-route-ticket-secret";
    const { claimLoopAssignmentWithPrisma } = await import("../../../../../lib/orchestration/worker-commands");
    const { ensureLoopAttemptLiveSessionWithPrisma } = await import("../../../../../lib/live-session/live-session-store");
    vi.mocked(claimLoopAssignmentWithPrisma).mockResolvedValueOnce({
      assignment: {
        agentRunId: "agent_run_1",
        loopRunId: "loop_run_1",
        loopNodeRunId: "node_run_1",
        loopNodeAttemptId: "attempt_1",
        attemptNo: 1,
        leaseGeneration: 4,
      },
      leaseGeneration: 4,
      leaseExpiresAt: "2026-09-24T10:01:00.000Z",
    } as never);
    vi.mocked(ensureLoopAttemptLiveSessionWithPrisma).mockRejectedValueOnce(new Error("database unavailable"));

    const response = await POST(new Request("http://localhost/api/agent/loop-assignments/claim", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer user_token",
        "x-agent-device-token": "device_token",
        origin: "tauri://localhost",
      },
      body: JSON.stringify({
        userId: "user_1",
        deviceId: "device_1",
        workerId: "local-worker:device_1",
        capabilitySnapshot,
      }),
    }));
    const body = await response.json();

    expect(response.status, JSON.stringify(body)).toBe(200);
    expect(body.result.assignment).toMatchObject({ agentRunId: "agent_run_1" });
    expect(body.result.assignment.liveSession).toBeUndefined();
  });

  it("attaches a dispatchable LiveSession to the claimed Agent assignment", async () => {
    process.env.HUMANTHREAD_DESKTOP_SESSION_SECRET = "agent-claim-route-ticket-secret";
    const { claimLoopAssignmentWithPrisma } = await import("../../../../../lib/orchestration/worker-commands");
    const { prisma } = await import("@humanthread/db");
    vi.mocked(claimLoopAssignmentWithPrisma).mockResolvedValueOnce({
      assignment: { agentRunId: "agent_run_1", loopRunId: "loop_run_1" },
      leaseGeneration: 2,
      leaseExpiresAt: "2026-09-24T10:01:00.000Z",
    } as never);
    const sessionId = "f".repeat(32);
    vi.mocked(prisma.liveSession.findFirst).mockResolvedValueOnce({
      id: sessionId,
      kind: "agent",
      targetType: "agent_device",
      targetDeviceId: "device_1",
      targetWorkerPoolId: null,
      projectId: "project_1",
      taskId: "task_1",
      businessRunType: "loop_run",
      businessRunId: "loop_run_1",
      status: "starting",
      expiresAt: new Date(Date.now() + 600_000),
    } as never);

    const response = await POST(new Request("http://localhost/api/agent/loop-assignments/claim", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer user_token",
        "x-agent-device-token": "device_token",
        origin: "tauri://localhost",
      },
      body: JSON.stringify({
        userId: "user_1",
        deviceId: "device_1",
        workerId: "local-worker:device_1",
        capabilitySnapshot,
        activeLiveSessionIds: ["a".repeat(32)],
      }),
    }));
    const body = await response.json();

    expect(body.result.assignment.liveSession).toMatchObject({
      sessionId,
      relayUrl: expect.stringContaining("ws://localhost:3000/live-session/execution"),
      authorization: expect.stringMatching(/^lst1\./u),
    });
  });

  it("authenticates an authorized device and claims with normalized capabilities", async () => {
    const { authenticateAgentRequest } = await import("../../../../../lib/agent/agent-auth");
    const { heartbeatLocalAgentWorker } = await import("../../../../../lib/agent/agent-device-registration");
    const { claimLoopAssignmentWithPrisma } = await import("../../../../../lib/orchestration/worker-commands");
    const response = await POST(new Request("http://localhost/api/agent/loop-assignments/claim", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer user_token",
        "x-agent-device-token": "device_token",
        origin: "tauri://localhost",
      },
      body: JSON.stringify({
        userId: "user_1",
        deviceId: "device_1",
        workerId: "local-worker:device_1",
        agentVersion: "Agent v0.1.2 · e16bff4c",
        capabilitySnapshot,
        activeAgentRunIds: ["agent_run_active_1"],
      }),
    }));

    expect(response.status).toBe(200);
    expect(authenticateAgentRequest).toHaveBeenCalledWith(expect.objectContaining({
      userId: "user_1",
      deviceId: "device_1",
      requireAuthorizedDevice: true,
    }));
    expect(heartbeatLocalAgentWorker).toHaveBeenCalledWith(expect.objectContaining({
      userId: "user_1",
      workerId: "local-worker:device_1",
      deviceId: "device_1",
      agentVersion: "Agent v0.1.2 · e16bff4c",
      capabilitySnapshot,
    }));
    expect(claimLoopAssignmentWithPrisma).toHaveBeenCalledWith(expect.objectContaining({
      userId: "user_1",
      workerId: "local-worker:device_1",
      deviceId: "device_1",
      capabilities: ["workspace", "commands", "codex"],
      leaseDurationMs: 60_000,
      activeAgentRunIds: ["agent_run_active_1"],
      acceptAssignments: true,
    }));
  });

  it("returns a direct Agent live session when no Loop assignment is available", async () => {
    process.env.HUMANTHREAD_DESKTOP_SESSION_SECRET = "agent-claim-route-ticket-secret";
    const { prisma } = await import("@humanthread/db");
    const sessionId = "e".repeat(32);
    vi.mocked(prisma.liveSession.findFirst).mockResolvedValueOnce({
      id: sessionId,
      kind: "agent",
      targetType: "agent_device",
      targetDeviceId: "device_1",
      targetWorkerPoolId: null,
      projectId: null,
      taskId: null,
      businessRunType: null,
      businessRunId: null,
      status: "starting",
      expiresAt: new Date(Date.now() + 600_000),
    } as never);

    const response = await POST(new Request("http://localhost/api/agent/loop-assignments/claim", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer user_token",
        "x-agent-device-token": "device_token",
        origin: "tauri://localhost",
      },
      body: JSON.stringify({
        userId: "user_1",
        deviceId: "device_1",
        workerId: "local-worker:device_1",
        capabilitySnapshot,
      }),
    }));
    const body = await response.json();

    expect(body.result.assignment).toBeNull();
    expect(body.result.liveSession).toMatchObject({
      sessionId,
      relayUrl: expect.stringContaining("ws://localhost:3000/live-session/execution"),
      authorization: expect.stringMatching(/^lst1\./u),
    });
    expect(prisma.liveSession.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: sessionId, status: "starting" }),
      data: expect.objectContaining({ status: "running" }),
    }));
  });

  it("heartbeats without accepting assignments when requested", async () => {
    const { heartbeatLocalAgentWorker } = await import("../../../../../lib/agent/agent-device-registration");
    const { claimLoopAssignmentWithPrisma } = await import("../../../../../lib/orchestration/worker-commands");
    const response = await POST(new Request("http://localhost/api/agent/loop-assignments/claim", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer user_token",
        "x-agent-device-token": "device_token",
        origin: "tauri://localhost",
      },
      body: JSON.stringify({
        userId: "user_1",
        deviceId: "device_1",
        workerId: "local-worker:device_1",
        capabilitySnapshot,
        acceptAssignments: false,
      }),
    }));

    expect(response.status).toBe(200);
    expect(heartbeatLocalAgentWorker).toHaveBeenCalledOnce();
    expect(claimLoopAssignmentWithPrisma).toHaveBeenCalledWith(expect.objectContaining({
      acceptAssignments: false,
    }));
  });

  it("returns platform scheduled task content only inside the claimed assignment", async () => {
    const { claimLoopAssignmentWithPrisma } = await import("../../../../../lib/orchestration/worker-commands");
    vi.mocked(claimLoopAssignmentWithPrisma).mockResolvedValueOnce({
      assignment: {
        agentRunId: "agent_run_1",
        inputSnapshot: {
          scheduledTask: {
            id: "a".repeat(32),
            name: "每日巡检",
            description: "检查昨日交付",
            contentMode: "platform",
            contentMarkdown: "# 巡检项\n- 检查日志",
          },
        },
      },
      leaseGeneration: 2,
      leaseExpiresAt: "2026-09-22T08:01:00.000Z",
    } as never);

    const response = await POST(new Request("http://localhost/api/agent/loop-assignments/claim", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer user_token",
        "x-agent-device-token": "device_token",
        origin: "tauri://localhost",
      },
      body: JSON.stringify({
        userId: "user_1",
        deviceId: "device_1",
        workerId: "local-worker:device_1",
        capabilitySnapshot,
      }),
    }));
    const body = await response.json();

    expect(body.result.assignment.inputSnapshot.scheduledTask).toEqual({
      id: "a".repeat(32),
      name: "每日巡检",
      description: "检查昨日交付",
      contentMode: "platform",
      contentMarkdown: "# 巡检项\n- 检查日志",
    });
    expect(body.result.assignment).not.toHaveProperty("contentSnapshot");
    expect(JSON.stringify(body)).not.toContain("contentSnapshot");
  });

  it("omits loop-managed scheduled task content from the claim response", async () => {
    const { claimLoopAssignmentWithPrisma } = await import("../../../../../lib/orchestration/worker-commands");
    vi.mocked(claimLoopAssignmentWithPrisma).mockResolvedValueOnce({
      assignment: {
        agentRunId: "agent_run_1",
        inputSnapshot: {
          scheduledTask: {
            id: "a".repeat(32),
            name: "项目巡检",
            description: "",
            contentMode: "loop_managed",
          },
        },
      },
      leaseGeneration: 2,
      leaseExpiresAt: "2026-09-22T08:01:00.000Z",
    } as never);

    const response = await POST(new Request("http://localhost/api/agent/loop-assignments/claim", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer user_token",
        "x-agent-device-token": "device_token",
        origin: "tauri://localhost",
      },
      body: JSON.stringify({
        userId: "user_1",
        deviceId: "device_1",
        workerId: "local-worker:device_1",
        capabilitySnapshot,
      }),
    }));
    const body = await response.json();

    expect(body.result.assignment.inputSnapshot.scheduledTask).not.toHaveProperty("contentMarkdown");
    expect(body.result.assignment).not.toHaveProperty("contentSnapshot");
    expect(JSON.stringify(body)).not.toContain("contentSnapshot");
  });

  it("returns a configuration error without an assignment when platform content is missing", async () => {
    const { claimLoopAssignmentWithPrisma } = await import("../../../../../lib/orchestration/worker-commands");
    vi.mocked(claimLoopAssignmentWithPrisma).mockRejectedValueOnce(Object.assign(
      new Error("Worker execution configuration is required"),
      { code: "configuration_required" },
    ));

    const response = await POST(new Request("http://localhost/api/agent/loop-assignments/claim", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer user_token",
        "x-agent-device-token": "device_token",
        origin: "tauri://localhost",
      },
      body: JSON.stringify({
        userId: "user_1",
        deviceId: "device_1",
        workerId: "local-worker:device_1",
        capabilitySnapshot,
      }),
    }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toMatchObject({ ok: false, code: "configuration_required" });
    expect(body).not.toHaveProperty("result.assignment");
    expect(JSON.stringify(body)).not.toContain("contentSnapshot");
  });

  it("rejects credential-shaped capability material before authentication", async () => {
    const { authenticateAgentRequest } = await import("../../../../../lib/agent/agent-auth");
    const response = await POST(new Request("http://localhost/api/agent/loop-assignments/claim", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        userId: "user_1",
        deviceId: "device_1",
        workerId: "worker_1",
        capabilitySnapshot: {
          ...capabilitySnapshot,
          token: "raw",
        },
      }),
    }));

    expect(response.status).toBe(400);
    expect(authenticateAgentRequest).not.toHaveBeenCalled();
  });
});
