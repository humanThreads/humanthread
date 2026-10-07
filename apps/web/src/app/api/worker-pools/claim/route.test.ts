import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

vi.mock("@humanthread/db", () => ({
  authenticateWorkerPoolSession: vi.fn(),
  claimWorkerValidationChallenge: vi.fn(),
  resolveWorkerModelSiteSecret: vi.fn(),
  prisma: {
    liveSession: {
      findFirst: vi.fn(),
      updateMany: vi.fn(),
    },
    project: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
    },
    projectLoopBinding: {
      findFirst: vi.fn(),
    },
  },
}));
vi.mock("@/lib/orchestration/worker-commands", () => ({
  claimLinuxWorkerAssignmentWithPrisma: vi.fn(),
}));
vi.mock("@/lib/workbench/workbench-site-settings", () => ({
  getWorkbenchSiteSettings: vi.fn(),
}));
vi.mock("@/lib/live-session/live-session-store", () => ({
  ensureLoopAttemptLiveSessionWithPrisma: vi.fn(),
  derivedLoopLiveSessionId: vi.fn(),
}));

describe("POST /api/worker-pools/claim", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const { authenticateWorkerPoolSession } = await import("@humanthread/db");
    const { claimWorkerValidationChallenge } = await import("@humanthread/db");
    const { prisma } = await import("@humanthread/db");
    const { resolveWorkerModelSiteSecret } = await import("@humanthread/db");
    const { claimLinuxWorkerAssignmentWithPrisma } = await import("@/lib/orchestration/worker-commands");
    const { getWorkbenchSiteSettings } = await import("@/lib/workbench/workbench-site-settings");
    vi.mocked(authenticateWorkerPoolSession).mockResolvedValue({
      sessionId: "b".repeat(32),
      workerPoolId: "a".repeat(32),
      ownerType: "personal",
      ownerUserId: "user_owner",
      companyId: null,
      instanceId: "worker-1",
      runtime: "docker",
      taskGroupName: null,
      capabilities: { gpu: true },
      requestedConcurrency: 2,
      maxConcurrentRuns: 2,
      configuration: { gpuConcurrency: 1, unityBuildConcurrency: 1 },
    } as never);
    vi.mocked(claimLinuxWorkerAssignmentWithPrisma).mockResolvedValue({ assignment: null } as never);
    vi.mocked(claimWorkerValidationChallenge).mockResolvedValue(null as never);
    vi.mocked(getWorkbenchSiteSettings).mockResolvedValue({
      siteBaseUrl: "http://localhost:3000",
      mcpUrl: "http://localhost:3000/api/mcp",
      userTasks: {} as never,
    });
    vi.mocked(prisma.liveSession.findFirst).mockResolvedValue(null as never);
    vi.mocked(prisma.liveSession.updateMany).mockResolvedValue({ count: 1 } as never);
    vi.mocked(prisma.project.findFirst).mockResolvedValue({ id: "project_1" } as never);
    vi.mocked(prisma.project.findUnique).mockResolvedValue({
      ownerType: "personal",
      ownerUserId: "user_owner",
      companyId: null,
    } as never);
    vi.mocked(prisma.projectLoopBinding.findFirst).mockResolvedValue({
      workerStageConfigurations: {
        develop: {
          siteId: "f".repeat(32),
          model: "gpt-5.6-sol",
          reasoningEffort: "high",
        },
      },
    } as never);
    vi.mocked(resolveWorkerModelSiteSecret).mockResolvedValue({
      id: "f".repeat(32),
      endpoint: "https://model.example.com/v1",
      apiKeyReference: "f".repeat(32),
      apiKey: "worker-model-key",
    } as never);
    const { ensureLoopAttemptLiveSessionWithPrisma } = await import("@/lib/live-session/live-session-store");
    vi.mocked(ensureLoopAttemptLiveSessionWithPrisma).mockResolvedValue({
      unavailableCode: "live_stream_owner_unavailable",
    } as never);
  });

  it("creates an attempt-bound observation session for the claimed Worker assignment", async () => {
    process.env.HUMANTHREAD_DESKTOP_SESSION_SECRET = "claim-route-ticket-secret";
    const { claimLinuxWorkerAssignmentWithPrisma } = await import("@/lib/orchestration/worker-commands");
    const { ensureLoopAttemptLiveSessionWithPrisma } = await import("@/lib/live-session/live-session-store");
    vi.mocked(claimLinuxWorkerAssignmentWithPrisma).mockResolvedValueOnce({
      assignment: {
        agentRunId: "agent_run_1",
        loopRunId: "loop_run_1",
        loopNodeRunId: "node_run_1",
        loopNodeAttemptId: "attempt_1",
        attemptNo: 1,
        leaseGeneration: 4,
      },
    } as never);
    const sessionId = "e".repeat(32);
    vi.mocked(ensureLoopAttemptLiveSessionWithPrisma).mockResolvedValueOnce({
      session: {
        id: sessionId,
        kind: "worker",
        surface: "web",
        spaceId: "space_1",
        projectId: "project_1",
        taskId: "task_1",
        executionPolicy: "loop",
        target: { type: "worker_pool", workerPoolId: "a".repeat(32), displayName: "ht-agnet" },
        targetDisplayName: "ht-agnet",
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
      executionTicket: { token: "lst1.attempt.ticket" },
    } as never);

    const response = await POST(new Request("https://0.0.0.0:3000/api/worker-pools/claim", {
      method: "POST",
      headers: { "content-type": "application/json", "x-worker-pool-session": "htwps_session" },
      body: JSON.stringify({ poolId: "a".repeat(32), acceptAssignments: true }),
    }));
    const body = await response.json();

    expect(ensureLoopAttemptLiveSessionWithPrisma).toHaveBeenCalledWith({
      loopRunId: "loop_run_1",
      loopNodeRunId: "node_run_1",
      loopNodeAttemptId: "attempt_1",
      attemptNo: 1,
      leaseGeneration: 4,
      target: { type: "worker_pool", workerPoolId: "a".repeat(32) },
      now: expect.any(Date),
    });
    expect(body.result.assignment.liveSession).toMatchObject({
      sessionId,
      authorization: "lst1.attempt.ticket",
      relayUrl: expect.stringContaining(`sessionId=${sessionId}`),
    });
  });

  it("marks the attempt-bound session running when an existing row is reused", async () => {
    process.env.HUMANTHREAD_DESKTOP_SESSION_SECRET = "claim-route-ticket-secret";
    const { claimLinuxWorkerAssignmentWithPrisma } = await import("@/lib/orchestration/worker-commands");
    const { prisma } = await import("@humanthread/db");
    const { ensureLoopAttemptLiveSessionWithPrisma } = await import("@/lib/live-session/live-session-store");
    vi.mocked(claimLinuxWorkerAssignmentWithPrisma).mockResolvedValueOnce({
      assignment: {
        agentRunId: "agent_run_1",
        loopRunId: "loop_run_1",
        loopNodeRunId: "node_run_1",
        loopNodeAttemptId: "attempt_1",
        attemptNo: 1,
        leaseGeneration: 4,
      },
    } as never);
    const sessionId = "e".repeat(32);
    // A repeated claim returns the already-created attempt session. Because the
    // first claim only created the row, a later Worker must still flip it to
    // running so the browser stops showing "waiting for an execution target".
    vi.mocked(ensureLoopAttemptLiveSessionWithPrisma).mockResolvedValueOnce({
      session: {
        id: sessionId,
        kind: "worker",
        surface: "web",
        spaceId: "space_1",
        projectId: "project_1",
        taskId: "task_1",
        executionPolicy: "loop",
        target: { type: "worker_pool", workerPoolId: "a".repeat(32), displayName: "ht-agnet" },
        targetDisplayName: "ht-agnet",
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
      executionTicket: { token: "lst1.attempt.ticket" },
    } as never);

    await POST(new Request("https://0.0.0.0:3000/api/worker-pools/claim", {
      method: "POST",
      headers: { "content-type": "application/json", "x-worker-pool-session": "htwps_session" },
      body: JSON.stringify({ poolId: "a".repeat(32), acceptAssignments: true }),
    }));

    expect(prisma.liveSession.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: sessionId, status: "starting" }),
      data: expect.objectContaining({ status: "running" }),
    }));
  });

  it("keeps the business assignment successful when automatic session creation fails", async () => {
    process.env.HUMANTHREAD_DESKTOP_SESSION_SECRET = "claim-route-ticket-secret";
    const { claimLinuxWorkerAssignmentWithPrisma } = await import("@/lib/orchestration/worker-commands");
    const { ensureLoopAttemptLiveSessionWithPrisma } = await import("@/lib/live-session/live-session-store");
    vi.mocked(claimLinuxWorkerAssignmentWithPrisma).mockResolvedValueOnce({
      assignment: {
        agentRunId: "agent_run_1",
        loopRunId: "loop_run_1",
        loopNodeRunId: "node_run_1",
        loopNodeAttemptId: "attempt_1",
        attemptNo: 1,
        leaseGeneration: 4,
      },
    } as never);
    vi.mocked(ensureLoopAttemptLiveSessionWithPrisma).mockRejectedValueOnce(new Error("database unavailable"));

    const response = await POST(new Request("https://0.0.0.0:3000/api/worker-pools/claim", {
      method: "POST",
      headers: { "content-type": "application/json", "x-worker-pool-session": "htwps_session" },
      body: JSON.stringify({ poolId: "a".repeat(32), acceptAssignments: true }),
    }));
    const body = await response.json();

    expect(response.status, JSON.stringify(body)).toBe(200);
    expect(body.result.assignment).toMatchObject({ agentRunId: "agent_run_1" });
    expect(body.result.assignment.liveSession).toBeUndefined();
  });

  it("attaches a dispatchable LiveSession to the claimed Worker assignment", async () => {
    process.env.HUMANTHREAD_DESKTOP_SESSION_SECRET = "claim-route-ticket-secret";
    const { claimLinuxWorkerAssignmentWithPrisma } = await import("@/lib/orchestration/worker-commands");
    const { prisma } = await import("@humanthread/db");
    vi.mocked(claimLinuxWorkerAssignmentWithPrisma).mockResolvedValueOnce({
      assignment: { agentRunId: "agent_run_1", loopRunId: "loop_run_1" },
    } as never);
    const sessionId = "c".repeat(32);
    vi.mocked(prisma.liveSession.findFirst).mockResolvedValueOnce({
      id: sessionId,
      kind: "worker",
      targetType: "worker_pool",
      targetDeviceId: null,
      targetWorkerPoolId: "a".repeat(32),
      projectId: "project_1",
      taskId: "task_1",
      businessRunType: "loop_run",
      businessRunId: "loop_run_1",
      status: "starting",
      expiresAt: new Date(Date.now() + 600_000),
    } as never);

    const response = await POST(new Request("https://0.0.0.0:3000/api/worker-pools/claim", {
      method: "POST",
      headers: { "content-type": "application/json", "x-worker-pool-session": "htwps_session" },
      body: JSON.stringify({ poolId: "a".repeat(32), acceptAssignments: true }),
    }));
    const body = await response.json();

    expect(body.result.assignment.liveSession).toMatchObject({
      sessionId,
      relayUrl: expect.stringContaining("ws://localhost:3000/live-session/execution"),
      authorization: expect.stringMatching(/^lst1\./u),
    });
    expect(prisma.liveSession.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: sessionId, status: "starting" }),
      data: expect.objectContaining({ status: "running" }),
    }));
  });

  it("returns a taskless direct Worker LiveSession when no business assignment is available", async () => {
    process.env.HUMANTHREAD_DESKTOP_SESSION_SECRET = "claim-route-ticket-secret";
    const { prisma } = await import("@humanthread/db");
    const sessionId = "d".repeat(32);
    vi.mocked(prisma.liveSession.findFirst).mockResolvedValueOnce({
      id: sessionId,
      kind: "worker",
      targetType: "worker_pool",
      targetDeviceId: null,
      targetWorkerPoolId: "a".repeat(32),
      projectId: "project_1",
      taskId: null,
      businessRunType: null,
      businessRunId: null,
      targetDisplayName: "ht-agnet",
      executionPolicy: "direct",
      status: "starting",
      expiresAt: new Date(Date.now() + 600_000),
    } as never);

    const response = await POST(new Request("https://0.0.0.0:3000/api/worker-pools/claim", {
      method: "POST",
      headers: { "content-type": "application/json", "x-worker-pool-session": "htwps_session" },
      body: JSON.stringify({ poolId: "a".repeat(32), acceptAssignments: true }),
    }));
    const body = await response.json();

    expect(response.status, JSON.stringify(body)).toBe(200);
    expect(body.result.assignment).toBeNull();
    expect(body.result.liveSession).toMatchObject({
      sessionId,
      kind: "worker",
      executionPolicy: "direct",
      relayUrl: expect.stringContaining("ws://localhost:3000/live-session/execution"),
      authorization: expect.stringMatching(/^lst1\./u),
    });
    expect(prisma.liveSession.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: sessionId, status: "starting" }),
      data: expect.objectContaining({ status: "running" }),
    }));
  });

  it("claims a direct Worker LiveSession for a company-scoped Pool", async () => {
    process.env.HUMANTHREAD_DESKTOP_SESSION_SECRET = "claim-route-ticket-secret";
    const { authenticateWorkerPoolSession, prisma } = await import("@humanthread/db");
    vi.mocked(authenticateWorkerPoolSession).mockResolvedValueOnce({
      sessionId: "b".repeat(32),
      workerPoolId: "a".repeat(32),
      ownerType: "company",
      ownerUserId: null,
      companyId: "company_1",
      instanceId: "worker-company-1",
      runtime: "kubernetes",
      taskGroupName: "ht-agnet",
      capabilities: {},
      requestedConcurrency: 1,
      maxConcurrentRuns: 2,
      configuration: { gpuConcurrency: 1, unityBuildConcurrency: 1 },
    } as never);
    const sessionId = "e".repeat(32);
    vi.mocked(prisma.liveSession.findFirst).mockResolvedValueOnce({
      id: sessionId,
      kind: "worker",
      targetType: "worker_pool",
      targetDeviceId: null,
      targetWorkerPoolId: "a".repeat(32),
      projectId: "project_1",
      taskId: null,
      businessRunType: null,
      businessRunId: null,
      targetDisplayName: "ht-agnet",
      executionPolicy: "direct",
      status: "starting",
      expiresAt: new Date(Date.now() + 600_000),
    } as never);

    const response = await POST(new Request("https://0.0.0.0:3000/api/worker-pools/claim", {
      method: "POST",
      headers: { "content-type": "application/json", "x-worker-pool-session": "htwps_session" },
      body: JSON.stringify({ poolId: "a".repeat(32), acceptAssignments: true }),
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.result.liveSession).toMatchObject({
      sessionId,
      executionPolicy: "direct",
      runtime: { model: "gpt-5.6-sol" },
    });
  });

  it("优先返回无副作用校验 challenge，不触发业务 Assignment 领取", async () => {
    const { claimWorkerValidationChallenge } = await import("@humanthread/db");
    const { claimLinuxWorkerAssignmentWithPrisma } = await import("@/lib/orchestration/worker-commands");
    vi.mocked(claimWorkerValidationChallenge).mockResolvedValueOnce({
      id: "c".repeat(32), kind: "worker_validation", sideEffect: false,
    } as never);

    const response = await POST(new Request("http://localhost/api/worker-pools/claim", {
      method: "POST",
      headers: { "content-type": "application/json", "x-worker-pool-session": "htwps_session" },
      body: JSON.stringify({ poolId: "a".repeat(32), acceptAssignments: true }),
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      result: { assignment: { id: "c".repeat(32), kind: "worker_validation", sideEffect: false } },
    });
    expect(claimWorkerValidationChallenge).toHaveBeenCalledWith(expect.objectContaining({
      poolId: "a".repeat(32), sessionId: "b".repeat(32),
    }));
    expect(claimLinuxWorkerAssignmentWithPrisma).not.toHaveBeenCalled();
  });

  it("authenticates the Pool session and derives claim ownership from it", async () => {
    const { authenticateWorkerPoolSession } = await import("@humanthread/db");
    const { claimLinuxWorkerAssignmentWithPrisma } = await import("@/lib/orchestration/worker-commands");
    const response = await POST(new Request("http://localhost/api/worker-pools/claim", {
      method: "POST",
      headers: { "content-type": "application/json", "x-worker-pool-session": "htwps_session" },
      body: JSON.stringify({ poolId: "a".repeat(32), acceptAssignments: true }),
    }));

    expect(response.status).toBe(200);
    expect(authenticateWorkerPoolSession).toHaveBeenCalledWith(expect.objectContaining({
      poolId: "a".repeat(32), sessionToken: "htwps_session",
    }));
    expect(claimLinuxWorkerAssignmentWithPrisma).toHaveBeenCalledWith(expect.objectContaining({
      poolId: "a".repeat(32), ownerType: "personal", ownerUserId: "user_owner", companyId: null, sessionId: "b".repeat(32),
      instanceId: "worker-1",
      runtime: "docker",
      requestedConcurrency: 2, maxConcurrentRuns: 2, capabilities: { gpu: true },
    }));
  });

  it("passes Kubernetes shared-storage mode to the claim boundary", async () => {
    const { authenticateWorkerPoolSession } = await import("@humanthread/db");
    const { claimLinuxWorkerAssignmentWithPrisma } = await import("@/lib/orchestration/worker-commands");
    vi.mocked(authenticateWorkerPoolSession).mockResolvedValueOnce({
      sessionId: "b".repeat(32), workerPoolId: "a".repeat(32), ownerType: "personal", ownerUserId: "user_owner", companyId: null,
      instanceId: "worker-k8s-1", capabilities: {}, requestedConcurrency: 1, maxConcurrentRuns: 2,
      runtime: "kubernetes", taskGroupName: "ht-agnet", configuration: {},
    } as never);

    const response = await POST(new Request("http://localhost/api/worker-pools/claim", {
      method: "POST",
      headers: { "content-type": "application/json", "x-worker-pool-session": "htwps_session" },
      body: JSON.stringify({ poolId: "a".repeat(32) }),
    }));

    expect(response.status).toBe(200);
    expect(claimLinuxWorkerAssignmentWithPrisma).toHaveBeenCalledWith(expect.objectContaining({
      instanceId: "worker-k8s-1", runtime: "kubernetes",
    }));
  });

  it("returns an Attempt-scoped checklist MCP URL only for a claimed assignment", async () => {
    const { claimLinuxWorkerAssignmentWithPrisma } = await import("@/lib/orchestration/worker-commands");
    vi.mocked(claimLinuxWorkerAssignmentWithPrisma).mockResolvedValueOnce({
      assignment: { agentRunId: "agent_run_1" },
    } as never);

    const response = await POST(new Request("https://0.0.0.0:3000/api/worker-pools/claim", {
      method: "POST",
      headers: { "content-type": "application/json", "x-worker-pool-session": "htwps_session" },
      body: JSON.stringify({ poolId: "a".repeat(32), acceptAssignments: true }),
    }));
    const body = await response.json();

    expect(body.result.assignment.checklistMcp).toEqual({
      url: "http://localhost:3000/api/worker-pools/assignments/agent_run_1/checklist-mcp",
    });
  });

  it("returns platform scheduled task content only inside the claimed assignment", async () => {
    const { claimLinuxWorkerAssignmentWithPrisma } = await import("@/lib/orchestration/worker-commands");
    vi.mocked(claimLinuxWorkerAssignmentWithPrisma).mockResolvedValueOnce({
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
    } as never);

    const response = await POST(new Request("http://localhost/api/worker-pools/claim", {
      method: "POST",
      headers: { "content-type": "application/json", "x-worker-pool-session": "htwps_session" },
      body: JSON.stringify({ poolId: "a".repeat(32), acceptAssignments: true }),
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
    const { claimLinuxWorkerAssignmentWithPrisma } = await import("@/lib/orchestration/worker-commands");
    vi.mocked(claimLinuxWorkerAssignmentWithPrisma).mockResolvedValueOnce({
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
    } as never);

    const response = await POST(new Request("http://localhost/api/worker-pools/claim", {
      method: "POST",
      headers: { "content-type": "application/json", "x-worker-pool-session": "htwps_session" },
      body: JSON.stringify({ poolId: "a".repeat(32), acceptAssignments: true }),
    }));
    const body = await response.json();

    expect(body.result.assignment.inputSnapshot.scheduledTask).not.toHaveProperty("contentMarkdown");
    expect(body.result.assignment).not.toHaveProperty("contentSnapshot");
    expect(JSON.stringify(body)).not.toContain("contentSnapshot");
  });

  it("returns a configuration error without an assignment when platform content is missing", async () => {
    const { claimLinuxWorkerAssignmentWithPrisma } = await import("@/lib/orchestration/worker-commands");
    vi.mocked(claimLinuxWorkerAssignmentWithPrisma).mockRejectedValueOnce(Object.assign(
      new Error("Worker execution configuration is required"),
      { code: "configuration_required" },
    ));

    const response = await POST(new Request("http://localhost/api/worker-pools/claim", {
      method: "POST",
      headers: { "content-type": "application/json", "x-worker-pool-session": "htwps_session" },
      body: JSON.stringify({ poolId: "a".repeat(32), acceptAssignments: true }),
    }));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toMatchObject({ ok: false, errorCode: "configuration_required" });
    expect(body).not.toHaveProperty("result.assignment");
    expect(JSON.stringify(body)).not.toContain("contentSnapshot");
  });

  it("rejects a claim before dispatch when the Pool session header is missing", async () => {
    const { authenticateWorkerPoolSession } = await import("@humanthread/db");
    const response = await POST(new Request("http://localhost/api/worker-pools/claim", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ poolId: "a".repeat(32) }),
    }));
    expect(response.status).toBe(401);
    expect(authenticateWorkerPoolSession).not.toHaveBeenCalled();
  });
});

describe("POST /api/worker-pools/claim queue isolation", () => {
  it("does not let an abandoned running session block a newer dispatchable session", async () => {
    process.env.HUMANTHREAD_DESKTOP_SESSION_SECRET = "claim-route-ticket-secret";
    const { authenticateWorkerPoolSession, prisma } = await import("@humanthread/db");
    vi.mocked(authenticateWorkerPoolSession).mockResolvedValueOnce({
      sessionId: "b".repeat(32),
      workerPoolId: "a".repeat(32),
      ownerType: "company",
      ownerUserId: null,
      companyId: "company_1",
      instanceId: "worker-company-1",
      runtime: "kubernetes",
      taskGroupName: "ht-agnet",
      capabilities: {},
      requestedConcurrency: 1,
      maxConcurrentRuns: 2,
      configuration: { gpuConcurrency: 1, unityBuildConcurrency: 1 },
    } as never);

    // The oldest active row is an abandoned `running` session whose Worker is
    // gone. Loading it must not be the only thing the claim path ever considers:
    // otherwise every later session waits behind it forever.
    const abandonedId = "f".repeat(32);
    const dispatchableId = "0".repeat(32);
    const baseRow = {
      kind: "worker",
      targetType: "worker_pool",
      targetDeviceId: null,
      targetWorkerPoolId: "a".repeat(32),
      projectId: "project_1",
      taskId: null,
      businessRunType: null,
      businessRunId: null,
      targetDisplayName: "ht-agnet",
      executionPolicy: "direct",
      expiresAt: new Date(Date.now() + 600_000),
    };
    // Respect the `where.status` filter so the test exercises real query
    // semantics instead of returning a fixed sequence of rows.
    vi.mocked(prisma.liveSession.findFirst).mockImplementation((async (args: { where?: { status?: unknown } }) => {
      const status = args?.where?.status;
      if (status === "starting") return { ...baseRow, id: dispatchableId, status: "starting", lastTargetHeartbeatAt: null };
      if (status === "running") return { ...baseRow, id: abandonedId, status: "running", lastTargetHeartbeatAt: new Date(Date.now() - 3_600_000) };
      return null;
    }) as never);

    const response = await POST(new Request("https://0.0.0.0:3000/api/worker-pools/claim", {
      method: "POST",
      headers: { "content-type": "application/json", "x-worker-pool-session": "htwps_session" },
      body: JSON.stringify({ poolId: "a".repeat(32), acceptAssignments: true }),
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.result.liveSession).toMatchObject({ sessionId: dispatchableId });
    expect(prisma.liveSession.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: dispatchableId, status: "starting" }),
    }));
  });

  it("skips an abandoned running session when it is the only active row", async () => {
    process.env.HUMANTHREAD_DESKTOP_SESSION_SECRET = "claim-route-ticket-secret";
    const { authenticateWorkerPoolSession, prisma } = await import("@humanthread/db");
    vi.mocked(authenticateWorkerPoolSession).mockResolvedValueOnce({
      sessionId: "b".repeat(32),
      workerPoolId: "a".repeat(32),
      ownerType: "company",
      ownerUserId: null,
      companyId: "company_1",
      instanceId: "worker-company-1",
      runtime: "kubernetes",
      taskGroupName: "ht-agnet",
      capabilities: {},
      requestedConcurrency: 1,
      maxConcurrentRuns: 2,
      configuration: { gpuConcurrency: 1, unityBuildConcurrency: 1 },
    } as never);
    vi.mocked(prisma.liveSession.findFirst).mockImplementation((async (args: { where?: { status?: unknown } }) => {
      if (args?.where?.status !== "running") return null;
      return {
        id: "f".repeat(32),
        kind: "worker",
        targetType: "worker_pool",
        targetDeviceId: null,
        targetWorkerPoolId: "a".repeat(32),
        projectId: "project_1",
        taskId: null,
        businessRunType: null,
        businessRunId: null,
        targetDisplayName: "ht-agnet",
        executionPolicy: "direct",
        status: "running",
        lastTargetHeartbeatAt: new Date(Date.now() - 3_600_000),
        expiresAt: new Date(Date.now() + 600_000),
      };
    }) as never);

    // Another Worker refreshes the heartbeat between the load and the atomic
    // re-acquire, so this replica must not duplicate the session.
    vi.mocked(prisma.liveSession.updateMany).mockResolvedValueOnce({ count: 0 } as never);

    const response = await POST(new Request("https://0.0.0.0:3000/api/worker-pools/claim", {
      method: "POST",
      headers: { "content-type": "application/json", "x-worker-pool-session": "htwps_session" },
      body: JSON.stringify({ poolId: "a".repeat(32), acceptAssignments: true }),
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.result.liveSession).toBeUndefined();
  });

  it("re-acquires an abandoned session when no newer session is waiting", async () => {
    process.env.HUMANTHREAD_DESKTOP_SESSION_SECRET = "claim-route-ticket-secret";
    const { authenticateWorkerPoolSession, prisma } = await import("@humanthread/db");
    vi.mocked(authenticateWorkerPoolSession).mockResolvedValueOnce({
      sessionId: "b".repeat(32),
      workerPoolId: "a".repeat(32),
      ownerType: "company",
      ownerUserId: null,
      companyId: "company_1",
      instanceId: "worker-company-1",
      runtime: "kubernetes",
      taskGroupName: "ht-agnet",
      capabilities: {},
      requestedConcurrency: 1,
      maxConcurrentRuns: 2,
      configuration: { gpuConcurrency: 1, unityBuildConcurrency: 1 },
    } as never);
    const abandonedId = "f".repeat(32);
    vi.mocked(prisma.liveSession.findFirst).mockImplementation((async (args: { where?: { status?: unknown } }) => {
      if (args?.where?.status !== "running") return null;
      return {
        id: abandonedId,
        kind: "worker",
        targetType: "worker_pool",
        targetDeviceId: null,
        targetWorkerPoolId: "a".repeat(32),
        projectId: "project_1",
        taskId: null,
        businessRunType: null,
        businessRunId: null,
        targetDisplayName: "ht-agnet",
        executionPolicy: "direct",
        status: "running",
        lastTargetHeartbeatAt: new Date(Date.now() - 3_600_000),
        expiresAt: new Date(Date.now() + 600_000),
      };
    }) as never);

    const response = await POST(new Request("https://0.0.0.0:3000/api/worker-pools/claim", {
      method: "POST",
      headers: { "content-type": "application/json", "x-worker-pool-session": "htwps_session" },
      body: JSON.stringify({ poolId: "a".repeat(32), acceptAssignments: true }),
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.result.liveSession).toMatchObject({ sessionId: abandonedId });
    expect(prisma.liveSession.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: abandonedId, status: "running" }),
    }));
  });

  it("returns the session-level model in the direct Worker runtime", async () => {
    process.env.HUMANTHREAD_DESKTOP_SESSION_SECRET = "claim-route-ticket-secret";
    const { authenticateWorkerPoolSession, prisma } = await import("@humanthread/db");
    const { getWorkbenchSiteSettings } = await import("@/lib/workbench/workbench-site-settings");
    vi.mocked(getWorkbenchSiteSettings).mockResolvedValue({
      siteBaseUrl: "http://localhost:3000",
      mcpUrl: "http://localhost:3000/api/mcp",
      userTasks: {} as never,
    });
    vi.mocked(prisma.liveSession.updateMany).mockResolvedValue({ count: 1 } as never);
    vi.mocked(prisma.project.findFirst).mockResolvedValue({ id: "project_1" } as never);
    vi.mocked(prisma.project.findUnique).mockResolvedValue({
      ownerType: "company",
      ownerUserId: null,
      companyId: "company_1",
    } as never);
    vi.mocked(prisma.projectLoopBinding.findFirst).mockResolvedValue({
      workerStageConfigurations: {
        develop: { siteId: "f".repeat(32), model: "gpt-5.6-sol", reasoningEffort: "high" },
      },
    } as never);
    vi.mocked(authenticateWorkerPoolSession).mockResolvedValueOnce({
      sessionId: "b".repeat(32),
      workerPoolId: "a".repeat(32),
      ownerType: "company",
      ownerUserId: null,
      companyId: "company_1",
      instanceId: "worker-company-1",
      runtime: "kubernetes",
      taskGroupName: "ht-agnet",
      capabilities: {},
      requestedConcurrency: 1,
      maxConcurrentRuns: 2,
      configuration: { gpuConcurrency: 1, unityBuildConcurrency: 1 },
    } as never);
    const sessionId = "e".repeat(32);
    vi.mocked(prisma.liveSession.findFirst).mockResolvedValueOnce({
      id: sessionId,
      kind: "worker",
      targetType: "worker_pool",
      targetDeviceId: null,
      targetWorkerPoolId: "a".repeat(32),
      projectId: "project_1",
      taskId: null,
      businessRunType: null,
      businessRunId: null,
      targetDisplayName: "ht-agnet",
      executionPolicy: "direct",
      status: "starting",
      modelSiteId: "b".repeat(32),
      model: "selected-model",
      reasoningEffort: "medium",
      lastTargetHeartbeatAt: null,
      expiresAt: new Date(Date.now() + 600_000),
    } as never);

    const { resolveWorkerModelSiteSecret } = await import("@humanthread/db");
    vi.mocked(resolveWorkerModelSiteSecret).mockResolvedValue({
      id: "b".repeat(32),
      endpoint: "https://selected.example.com/v1",
      apiKeyReference: "b".repeat(32),
      apiKey: "selected-key",
    } as never);

    const response = await POST(new Request("https://0.0.0.0:3000/api/worker-pools/claim", {
      method: "POST",
      headers: { "content-type": "application/json", "x-worker-pool-session": "htwps_session" },
      body: JSON.stringify({ poolId: "a".repeat(32), acceptAssignments: true }),
    }));
    const body = await response.json();

    expect(response.status, JSON.stringify(body)).toBe(200);
    expect(body.result.liveSession.runtime).toMatchObject({
      model: "selected-model",
      reasoningEffort: "medium",
    });
    // The session-selected site must win over the project stage's site.
    expect(resolveWorkerModelSiteSecret).toHaveBeenCalledWith(expect.objectContaining({
      siteId: "b".repeat(32),
    }));
  });
});
