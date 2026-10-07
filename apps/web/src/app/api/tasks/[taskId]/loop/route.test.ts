import { beforeEach, describe, expect, it, vi } from "vitest";
import { invalidateLoopRunAgentLeases, prisma } from "@humanthread/db";
import { triggerTaskLoop } from "@/lib/orchestration/loop-trigger-commands";
import { resolveWorkbenchApiActor } from "@/lib/workbench/workbench-api-session";
import { POST } from "./route";

vi.mock("@humanthread/db", () => ({
  assertCanDispatchTaskAgent: vi.fn(),
  invalidateLoopRunAgentLeases: vi.fn(),
  prisma: {
    approvalRequest: { count: vi.fn() },
    loopRun: { findFirst: vi.fn(), findMany: vi.fn().mockResolvedValue([]), updateMany: vi.fn() },
    $transaction: vi.fn(async (callback) => callback({ loopRun: { findMany: vi.fn().mockResolvedValue([]), updateMany: vi.fn() }, agentRun: { findMany: vi.fn().mockResolvedValue([]), updateMany: vi.fn() }, agentWorker: { updateMany: vi.fn() } })),
  },
}));
vi.mock("@/lib/orchestration/loop-commands", () => ({ transitionLoopCommand: vi.fn() }));
vi.mock("@/lib/orchestration/loop-trigger-commands", () => ({ triggerTaskLoop: vi.fn() }));
vi.mock("@/lib/workbench/workbench-api-session", () => ({ resolveWorkbenchApiActor: vi.fn() }));

const context = { params: Promise.resolve({ taskId: "task_1" }) };

describe("POST /api/tasks/:taskId/loop", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveWorkbenchApiActor).mockResolvedValue({ userId: "user_session", authKind: "web_session", webSessionId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" });
  });

  it("starts a new Task LoopRun for the signed actor", async () => {
    vi.mocked(triggerTaskLoop).mockResolvedValue({ id: "loop_run_task_1", engineKind: "graph_v1" });
    const response = await POST(new Request("http://localhost/api/tasks/task_1/loop", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        command: "start",
        commandId: "task_start_1",
        bindingId: "binding_fast",
        executionTarget: { type: "linux_worker_pool", workerPoolId: "a".repeat(32) },
      }),
    }), context);

    expect(response.status).toBe(201);
    expect(triggerTaskLoop).toHaveBeenCalledWith({
      actorUserId: "user_session",
      taskId: "task_1",
      commandId: "task_start_1",
      bindingId: "binding_fast",
      payload: {},
      executionTarget: { type: "linux_worker_pool", workerPoolId: "a".repeat(32) },
    });
    await expect(response.json()).resolves.toEqual({
      ok: true,
      result: { id: "loop_run_task_1", engineKind: "graph_v1" },
    });
  });

  it("does not create a Task Loop without an explicit execution target", async () => {
    const response = await POST(new Request("http://localhost/api/tasks/task_1/loop", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ command: "start", commandId: "task_start_no_target" }),
    }), context);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ ok: false, error: "Execution target is required" });
    expect(triggerTaskLoop).not.toHaveBeenCalled();
  });

  it("starts a new Task LoopRun instead of restarting a cancelled Run", async () => {
    vi.mocked(triggerTaskLoop).mockResolvedValue({ id: "loop_run_task_2", engineKind: "graph_v1" });
    const response = await POST(new Request("http://localhost/api/tasks/task_1/loop", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        command: "start",
        commandId: "task_restart_1",
        loopRunId: "loop_run_cancelled_1",
        executionTarget: { type: "linux_worker_pool", workerPoolId: "a".repeat(32) },
      }),
    }), context);

    expect(response.status).toBe(201);
    expect(triggerTaskLoop).toHaveBeenCalledWith({
      actorUserId: "user_session",
      taskId: "task_1",
      commandId: "task_restart_1",
      payload: {},
      executionTarget: { type: "linux_worker_pool", workerPoolId: "a".repeat(32) },
    });
    await expect(response.json()).resolves.toEqual({
      ok: true,
      result: { id: "loop_run_task_2", engineKind: "graph_v1" },
    });
  });

  it("starts a fresh Run for an intervention-waiting worker failure", async () => {
    vi.mocked(triggerTaskLoop).mockResolvedValue({ id: "loop_run_worker_retry", engineKind: "graph_v1" });
    const response = await POST(new Request("http://localhost/api/tasks/task_1/loop", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ command: "start", commandId: "task_restart_worker_1", executionTarget: { type: "linux_worker_pool", workerPoolId: "a".repeat(32) } }),
    }), context);
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({ ok: true, result: { id: "loop_run_worker_retry", engineKind: "graph_v1" } });
  });

  it("cancels active task Runs and invalidates leases before restart", async () => {
    const activeRun = { id: "loop_run_old" };
    const txLoopRun = {
      findMany: vi.fn().mockResolvedValue([activeRun]),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    };
    const txAgentRun = { findMany: vi.fn().mockResolvedValue([]), updateMany: vi.fn() };
    const txAgentWorker = { updateMany: vi.fn() };
    vi.mocked(prisma.$transaction).mockImplementationOnce(async (callback) => callback({ loopRun: txLoopRun, agentRun: txAgentRun, agentWorker: txAgentWorker } as never));
    vi.mocked(triggerTaskLoop).mockResolvedValue({ id: "loop_run_new", engineKind: "graph_v1" });

    const response = await POST(new Request("http://localhost/api/tasks/task_1/loop", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ command: "start", commandId: "task_restart_cancel_old", executionTarget: { type: "linux_worker_pool", workerPoolId: "a".repeat(32) } }),
    }), context);

    expect(response.status).toBe(201);
    expect(txLoopRun.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "loop_run_old", status: { in: ["created", "running", "paused", "waiting", "waiting_approval"] } },
      data: expect.objectContaining({ status: "cancelled", stopReason: "superseded_by_restart" }),
    }));
    expect(invalidateLoopRunAgentLeases).toHaveBeenCalledWith(expect.objectContaining({ loopRunId: "loop_run_old", reason: "cancel" }));
  });

  it("retries once after a binding changes while the replacement Run is created", async () => {
    vi.mocked(triggerTaskLoop)
      .mockRejectedValueOnce(Object.assign(new Error("Loop binding changed before Run creation"), { code: "validation_failed" }))
      .mockResolvedValueOnce({ id: "loop_run_task_retry_1", engineKind: "graph_v1" });

    const response = await POST(new Request("http://localhost/api/tasks/task_1/loop", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        command: "start",
        commandId: "task_restart_retry_1",
        executionTarget: { type: "linux_worker_pool", workerPoolId: "a".repeat(32) },
      }),
    }), context);

    expect(response.status).toBe(201);
    expect(triggerTaskLoop).toHaveBeenCalledTimes(2);
    await expect(response.json()).resolves.toEqual({ ok: true, result: { id: "loop_run_task_retry_1", engineKind: "graph_v1" } });
  });

  it("does not create a Task Loop when the command is invalid", async () => {
    const response = await POST(new Request("http://localhost/api/tasks/task_1/loop", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ command: "finish", commandId: "task_finish_1" }),
    }), context);

    expect(response.status).toBe(400);
    expect(triggerTaskLoop).not.toHaveBeenCalled();
  });
});
