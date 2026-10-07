import { beforeEach, describe, expect, it, vi } from "vitest";
import { assertCanDispatchTaskAgent, assertCanWriteProject, handleReleasePlanLoopEvent, invalidateLoopRunAgentLeases, prisma, restartLoopRunFromNode } from "@humanthread/db";
import { resolveWorkbenchApiActor } from "@/lib/workbench/workbench-api-session";
import { POST } from "./route";

vi.mock("@/lib/orchestration/loop-commands", () => ({
  transitionLoopCommand: vi.fn().mockImplementation(async (input, dependencies) => {
    const result = { id: input.loop.id, status: input.command === "cancel" ? "cancelled" : "paused", version: input.loop.version + 1 };
    await dependencies.persist(result);
    return result;
  }),
}));
vi.mock("@humanthread/db", () => ({
  assertCanDispatchTaskAgent: vi.fn(),
  assertCanWriteProject: vi.fn(),
  handleReleasePlanLoopEvent: vi.fn(),
  invalidateLoopRunAgentLeases: vi.fn(),
  restartLoopRunFromNode: vi.fn(),
  prisma: {
    loopRun: { findUnique: vi.fn() },
    approvalRequest: { count: vi.fn() },
    $transaction: vi.fn(),
  },
}));
vi.mock("@/lib/workbench/workbench-api-session", () => ({ resolveWorkbenchApiActor: vi.fn() }));

const context = { params: Promise.resolve({ loopRunId: "loop_run_release" }) };

describe("POST /api/loop-runs/:loopRunId/commands", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveWorkbenchApiActor).mockResolvedValue({ userId: "user_1", authKind: "web_session", webSessionId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" });
    vi.mocked(prisma.loopRun.findUnique).mockResolvedValue({ id: "loop_run_release", projectId: "project_1", taskId: null, status: "running", version: 3, budgetSnapshot: { maxIterations: 1 }, usageAggregate: { iterations: 0 } } as never);
    vi.mocked(prisma.approvalRequest.count).mockResolvedValue(0);
    vi.mocked(prisma.$transaction).mockImplementation(async (callback) => callback({ loopRun: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) } } as never));
  });

  it("authorizes and cancels a project-level release Loop", async () => {
    const response = await POST(new Request("http://localhost/api/loop-runs/loop_run_release/commands", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ command: "cancel" }),
    }), context);

    expect(response.status).toBe(200);
    expect(assertCanWriteProject).toHaveBeenCalledWith({ userId: "user_1", projectId: "project_1" });
    expect(invalidateLoopRunAgentLeases).toHaveBeenCalledWith(expect.objectContaining({ loopRunId: "loop_run_release", reason: "cancel" }));
    expect(handleReleasePlanLoopEvent).toHaveBeenCalledWith({ loopRunId: "loop_run_release" });
  });

  it("authenticates before loading the LoopRun", async () => {
    vi.mocked(resolveWorkbenchApiActor).mockRejectedValue(new Error("Workbench API authentication required"));
    const response = await POST(new Request("http://localhost/api/loop-runs/loop_run_release/commands", { method: "POST", body: "not-json" }), context);
    expect(response.status).toBe(401);
    expect(prisma.loopRun.findUnique).not.toHaveBeenCalled();
  });

  it("restarts a failed task Loop from the selected node with an idempotent command", async () => {
    vi.mocked(prisma.loopRun.findUnique).mockResolvedValue({ id: "loop_run_task", projectId: "project_1", taskId: "task_1", status: "failed", version: 7, budgetSnapshot: {}, usageAggregate: {} } as never);
    vi.mocked(restartLoopRunFromNode).mockResolvedValue({ loopRunId: "loop_run_task", nodeKey: "agent-action-7", nodeRunId: "loop-node:1", activationNo: 2, loopRunVersion: 8 } as never);
    const response = await POST(new Request("http://localhost/api/loop-runs/loop_run_task/commands", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ command: "restart_from_node", targetNodeKey: "agent-action-7", commandId: "restart-1", reason: "从失败节点重试" }),
    }), { params: Promise.resolve({ loopRunId: "loop_run_task" }) });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true, result: { nodeKey: "agent-action-7", activationNo: 2 } });
    expect(assertCanDispatchTaskAgent).toHaveBeenCalledWith({ userId: "user_1", taskId: "task_1" });
    expect(restartLoopRunFromNode).toHaveBeenCalledWith(expect.objectContaining({
      loopRunId: "loop_run_task",
      targetNodeKey: "agent-action-7",
      reason: "从失败节点重试",
      actorUserId: "user_1",
      commandId: "restart-1",
      occurredAt: expect.any(Date),
    }));
    expect(handleReleasePlanLoopEvent).not.toHaveBeenCalled();
  });

  it("rejects a node restart without a target node key", async () => {
    const response = await POST(new Request("http://localhost/api/loop-runs/loop_run_release/commands", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ command: "restart_from_node", commandId: "restart-2" }),
    }), context);

    expect(response.status).toBe(400);
    expect(restartLoopRunFromNode).not.toHaveBeenCalled();
  });
});
