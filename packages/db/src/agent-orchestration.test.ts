import { describe, expect, it, vi } from "vitest";
import {
  claimAgentRun,
  createAgentRunRecord,
  deactivateAgentWorker,
  heartbeatAgentRun,
  invalidateLoopRunAgentLeases,
  matchesAgentRunCapabilities,
} from "./agent-orchestration";

describe("agent orchestration persistence", () => {
  it("does not recover an active assignment after advertised capabilities are reduced", () => {
    expect(matchesAgentRunCapabilities({
      workerCapabilities: ["workspace", "commands", "codex"],
      advertisedCapabilities: ["workspace", "codex"],
      runtimeCapabilities: [],
      profileCapabilities: ["workspace"],
      requiredCapabilities: ["commands"],
    })).toBe(false);
    expect(matchesAgentRunCapabilities({
      workerCapabilities: ["workspace", "commands", "codex"],
      advertisedCapabilities: ["workspace", "commands", "codex"],
      runtimeCapabilities: [],
      profileCapabilities: ["workspace"],
      requiredCapabilities: ["commands"],
    })).toBe(true);
  });

  it("combines device and ready runtime capabilities using canonical aliases", () => {
    expect(matchesAgentRunCapabilities({
      workerCapabilities: ["workspace", "files", "commands", "codex"],
      advertisedCapabilities: ["workspace", "files", "commands", "codex"],
      runtimeCapabilities: ["approvals", "session_resume", "structured_result"],
      profileCapabilities: ["structured_result", "commands", "filesystem"],
      requiredCapabilities: [],
    })).toBe(true);

    expect(matchesAgentRunCapabilities({
      workerCapabilities: ["workspace", "files", "commands", "codex"],
      advertisedCapabilities: ["workspace", "files", "commands", "codex"],
      runtimeCapabilities: [],
      profileCapabilities: ["structured_result", "commands", "filesystem"],
      requiredCapabilities: [],
    })).toBe(false);
  });

  it.each([
    {
      name: "mixed graph and legacy identity",
      data: { id: "run_mixed", taskId: "task_1", loopNodeRunId: "node_1" },
    },
    {
      name: "unscoped identity",
      data: { id: "run_unscoped", taskId: null, loopNodeRunId: null },
    },
  ])("rejects a future $name write before Prisma mutation", async ({ data }) => {
    const create = vi.fn();

    await expect(createAgentRunRecord({ agentRun: { create }, data })).rejects.toMatchObject({
      code: "invalid_agent_run_identity",
    });
    expect(create).not.toHaveBeenCalled();
  });

  it.each([
    { id: "run_legacy", taskId: "task_1", loopNodeRunId: null },
    { id: "run_graph", taskId: null, loopNodeRunId: "node_1" },
  ])("persists valid AgentRun identity for $id", async (data) => {
    const create = vi.fn().mockResolvedValue(data);

    await expect(createAgentRunRecord({ agentRun: { create }, data })).resolves.toEqual(data);
    expect(create).toHaveBeenCalledWith({ data });
  });

  it("claims only a graph run matching the worker device and capabilities", async () => {
    const updateWorker = vi.fn().mockResolvedValue({ count: 1 });
    const findMany = vi.fn().mockResolvedValue([
      {
        id: "run_unsupported",
        leaseGeneration: 1,
        agentProfile: { capabilities: ["workspace", "browser"] },
        loopNodeAttempt: {
          loopNodeRun: {
            nodeKey: "work",
            loopRun: { loopVersion: { graph: {
              schemaVersion: 1,
              inputSchema: {},
              outputSchema: {},
              limits: { maxStages: 1, maxRepeatCount: 1 },
              nodes: [{ key: "work", label: "Work", type: "agent_action", executionTarget: "local", promptTemplate: "Work" }],
              edges: [],
            } } },
          },
        },
      },
      {
        id: "run_1",
        leaseGeneration: 2,
        agentProfile: {
          provider: "codex",
          capabilities: ["structured_result", "commands", "filesystem"],
        },
        loopNodeAttempt: {
          loopNodeRun: {
            nodeKey: "work",
            loopRun: { loopVersion: { graph: {
              schemaVersion: 1,
              inputSchema: {},
              outputSchema: {},
              limits: { maxStages: 1, maxRepeatCount: 1 },
              nodes: [{
                key: "work",
                label: "Work",
                type: "agent_action",
                executionTarget: "local",
                promptTemplate: "Work",
                requiredCapabilities: ["commands"],
              }],
              edges: [],
            } } },
          },
        },
      },
    ]);
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const findUnique = vi.fn().mockResolvedValue({ id: "run_1", status: "claimed", leaseGeneration: 3 });
    await expect(claimAgentRun({
      tx: {
        deviceAgentRuntimeProfile: {
          findMany: vi.fn().mockResolvedValue([{
            provider: "codex",
            capabilities: ["approvals", "session_resume", "structured_result"],
          }]),
        },
        agentWorker: {
          findUnique: vi.fn().mockResolvedValue({
            id: "worker_1",
            localDeviceId: "device_1",
            status: "online",
            capabilities: ["workspace", "files", "commands", "codex"],
            activeRunCount: 0,
            maxConcurrentRuns: 1,
          }),
          updateMany: updateWorker,
        },
        agentRun: { findMany, updateMany, findUnique },
      },
      workerId: "worker_1",
      deviceId: "device_1",
      userId: "user_1",
      capabilities: ["workspace", "files", "commands", "codex"],
      now: new Date("2026-07-21T00:00:00.000Z"),
      leaseDurationMs: 60_000,
    })).resolves.toMatchObject({ id: "run_1", leaseGeneration: 3 });
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        status: "queued",
        taskId: null,
        project: { is: expect.any(Object) },
        loopNodeRunId: { not: null },
        loopRun: { engineKind: "graph_v1", status: "running" },
        loopNodeAttempt: expect.objectContaining({ executorType: "local" }),
      }),
      take: 25,
    }));
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "run_1", status: "queued", leaseGeneration: 2 },
      data: expect.objectContaining({ workerId: "worker_1", leaseGeneration: 3 }),
    }));
    expect(updateWorker).toHaveBeenCalledWith({
      where: {
        id: "worker_1",
        localDeviceId: "device_1",
        status: "online",
        activeRunCount: 0,
        maxConcurrentRuns: 1,
      },
      data: { activeRunCount: { increment: 1 } },
    });
  });

  it("claims a local run from a V2 published graph without version gating", async () => {
    const updateWorker = vi.fn().mockResolvedValue({ count: 1 });
    const v2Graph = {
      schemaVersion: 2,
      inputSchema: {},
      outputSchema: {},
      limits: { maxStages: 1, maxRepeatCount: 1 },
      nodes: [{
        key: "work",
        label: "Work",
        type: "agent_action",
        executionTarget: "local",
        promptTemplate: "Work",
        requiredCapabilities: ["commands"],
      }],
      edges: [],
      routingMetadata: {
        work: { responsibility: "Implement the approved requirement." },
      },
    };
    const findMany = vi.fn().mockResolvedValue([{
      id: "run_v2",
      leaseGeneration: 4,
      agentProfile: {
        provider: "codex",
        capabilities: ["structured_result", "commands", "filesystem"],
      },
      loopNodeAttempt: {
        loopNodeRun: {
          nodeKey: "work",
          loopRun: { loopVersion: { graph: v2Graph } },
        },
      },
    }]);
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const findUnique = vi.fn().mockResolvedValue({ id: "run_v2", status: "claimed", leaseGeneration: 5 });

    await expect(claimAgentRun({
      tx: {
        deviceAgentRuntimeProfile: {
          findMany: vi.fn().mockResolvedValue([{
            provider: "codex",
            capabilities: ["approvals", "session_resume", "structured_result"],
          }]),
        },
        agentWorker: {
          findUnique: vi.fn().mockResolvedValue({
            id: "worker_1",
            localDeviceId: "device_1",
            status: "online",
            capabilities: ["workspace", "files", "commands", "codex"],
            activeRunCount: 0,
            maxConcurrentRuns: 1,
          }),
          updateMany: updateWorker,
        },
        agentRun: { findMany, updateMany, findUnique },
      },
      workerId: "worker_1",
      deviceId: "device_1",
      userId: "user_1",
      capabilities: ["workspace", "files", "commands", "codex"],
      now: new Date("2026-07-21T00:00:00.000Z"),
      leaseDurationMs: 60_000,
    })).resolves.toMatchObject({ id: "run_v2", leaseGeneration: 5 });
    expect(updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "run_v2", status: "queued", leaseGeneration: 4 },
      data: expect.objectContaining({ workerId: "worker_1", leaseGeneration: 5 }),
    }));
  });

  it("invalidates active leases and releases each affected Worker capacity", async () => {
    const agentRunUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
    const workerUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
    const now = new Date("2026-07-21T00:00:00.000Z");

    await expect(invalidateLoopRunAgentLeases({
      tx: {
        agentRun: {
          findMany: vi.fn().mockResolvedValue([
            { id: "run_1", workerId: "worker_1", leaseGeneration: 2 },
            { id: "run_2", workerId: "worker_1", leaseGeneration: 4 },
          ]),
          updateMany: agentRunUpdateMany,
        },
        agentWorker: { updateMany: workerUpdateMany },
      },
      loopRunId: "loop_1",
      reason: "pause",
      now,
    })).resolves.toEqual({ invalidated: 2, releasedCapacity: 2 });

    expect(agentRunUpdateMany).toHaveBeenNthCalledWith(1, {
      where: {
        id: "run_1",
        loopRunId: "loop_1",
        leaseGeneration: 2,
        status: { in: ["claimed", "starting", "running", "waiting_approval"] },
      },
      data: expect.objectContaining({
        status: "orphaned",
        leaseGeneration: 3,
        leaseExpiresAt: now,
        exitReason: "loop_paused",
      }),
    });
    expect(workerUpdateMany).toHaveBeenCalledWith({
      where: { id: "worker_1", activeRunCount: { gte: 2 } },
      data: { activeRunCount: { decrement: 2 }, version: { increment: 1 } },
    });
  });

  it("deactivates one device Worker and invalidates all of its active leases", async () => {
    const now = new Date("2026-07-21T00:00:00.000Z");
    const agentRunUpdateMany = vi.fn().mockResolvedValue({ count: 2 });
    const workerUpdateMany = vi.fn().mockResolvedValue({ count: 1 });

    await expect(deactivateAgentWorker({
      tx: { agentRun: { updateMany: agentRunUpdateMany }, agentWorker: { updateMany: workerUpdateMany } },
      workerId: "local-worker:device_1",
      deviceId: "device_1",
      now,
    })).resolves.toEqual({ invalidated: 2 });

    expect(agentRunUpdateMany).toHaveBeenCalledWith({
      where: { workerId: "local-worker:device_1", status: { in: ["claimed", "starting", "running", "waiting_approval"] } },
      data: expect.objectContaining({ status: "orphaned", leaseExpiresAt: now, exitReason: "worker_disabled" }),
    });
    expect(workerUpdateMany).toHaveBeenCalledWith({
      where: { id: "local-worker:device_1", localDeviceId: "device_1" },
      data: expect.objectContaining({ status: "offline", activeRunCount: 0 }),
    });
  });

  it("returns no assignment when the worker is outside the device scope", async () => {
    const findMany = vi.fn();

    await expect(claimAgentRun({
      tx: {
        agentWorker: {
          findUnique: vi.fn().mockResolvedValue({
            id: "worker_1",
            localDeviceId: "device_other",
            status: "online",
            capabilities: ["workspace"],
            activeRunCount: 0,
            maxConcurrentRuns: 1,
          }),
          updateMany: vi.fn(),
        },
        agentRun: { findMany, updateMany: vi.fn(), findUnique: vi.fn() },
      },
      workerId: "worker_1",
      deviceId: "device_1",
      userId: "user_1",
      capabilities: ["workspace"],
      now: new Date("2026-07-21T00:00:00.000Z"),
      leaseDurationMs: 60_000,
    })).resolves.toBeNull();
    expect(findMany).not.toHaveBeenCalled();
  });

  it("rejects a stale heartbeat without mutation", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    await expect(heartbeatAgentRun({
      tx: { agentRun: { updateMany } }, runId: "run_1", workerId: "worker_1", leaseGeneration: 2,
      now: new Date("2026-07-21T00:00:00.000Z"), leaseDurationMs: 60_000,
    })).rejects.toMatchObject({ code: "stale_lease" });
  });
});
