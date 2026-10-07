import { beforeEach, describe, expect, it, vi } from "vitest";
import { readLoopRunProjection } from "@/lib/orchestration/loop-read-model";
import { resolveWorkbenchApiActor } from "@/lib/workbench/workbench-api-session";
import { assertCanDispatchTaskAgent, prisma, retryFailedChildLoop } from "@humanthread/db";
import * as route from "./route";

vi.mock("@/lib/orchestration/loop-read-model", () => ({ readLoopRunProjection: vi.fn() }));
vi.mock("@/lib/workbench/workbench-api-session", () => ({ resolveWorkbenchApiActor: vi.fn() }));
vi.mock("@humanthread/db", () => ({
  assertCanDispatchTaskAgent: vi.fn(),
  retryFailedChildLoop: vi.fn(),
  prisma: { loopRun: { findUnique: vi.fn() } },
}));

const context = { params: Promise.resolve({ loopRunId: "loop_run_1" }) };

describe("GET /api/loop-runs/:loopRunId", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveWorkbenchApiActor).mockResolvedValue({ userId: "user_1", authKind: "web_session", webSessionId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" });
  });

  it("returns the authorized graph projection", async () => {
    vi.mocked(readLoopRunProjection).mockResolvedValue({
      definitionVersion: 2,
      projectionVersion: 4,
      eventCursor: 12,
      run: { id: "loop_run_1", status: "running", repeatCount: 0, transitionCount: 1, stopReason: null },
      pendingApprovals: [{ id: "approval_1", type: "loop_human_gate", status: "pending", createdAt: new Date("2026-08-11T10:00:00.000Z"), taskTitle: "确认需求", action: "确认", scope: "任务", policyReason: "人工门禁" }],
      nodes: [],
      edges: [],
      activities: [],
    });

    const response = await route.GET(new Request("http://localhost/api/loop-runs/loop_run_1"), context);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true, result: { eventCursor: 12, pendingApprovals: [{ id: "approval_1" }] } });
    expect(readLoopRunProjection).toHaveBeenCalledWith({ userId: "user_1", loopRunId: "loop_run_1" });
  });

  it("does not read a Run when session authentication fails", async () => {
    vi.mocked(resolveWorkbenchApiActor).mockRejectedValue(new Error("Workbench API authentication required"));

    const response = await route.GET(new Request("http://localhost/api/loop-runs/loop_run_1"), context);

    expect(response.status).toBe(401);
    expect(readLoopRunProjection).not.toHaveBeenCalled();
  });

  it("retries a failed child Loop without restarting its waiting parent", async () => {
    expect("POST" in route).toBe(true);
    if (!("POST" in route)) return;
    vi.mocked(prisma.loopRun.findUnique).mockResolvedValue({
      id: "child_run_1",
      taskId: "task_1",
      parentLoopRunId: "parent_run_1",
    } as never);
    vi.mocked(retryFailedChildLoop).mockResolvedValue({
      parentLoopRunId: "parent_run_1",
      childLoopRunId: "child_run_1",
      nodeRunId: "child_node_2",
      activationNo: 2,
      duplicate: false,
    });

    const response = await route.POST(new Request("http://localhost/api/loop-runs/child_run_1", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ command: "retry_child", commandId: "retry_child_1" }),
    }), { params: Promise.resolve({ loopRunId: "child_run_1" }) });

    expect(response.status).toBe(201);
    expect(assertCanDispatchTaskAgent).toHaveBeenCalledWith({ userId: "user_1", taskId: "task_1" });
    expect(retryFailedChildLoop).toHaveBeenCalledWith(expect.objectContaining({
      childLoopRunId: "child_run_1",
      commandId: "retry_child_1",
      actor: { type: "user", id: "user_1" },
    }));
    await expect(response.json()).resolves.toEqual({
      ok: true,
      result: {
        parentLoopRunId: "parent_run_1",
        childLoopRunId: "child_run_1",
        nodeRunId: "child_node_2",
        activationNo: 2,
        duplicate: false,
      },
    });
  });

  it("passes the user-selected recovery node to the existing child LoopRun", async () => {
    vi.mocked(prisma.loopRun.findUnique).mockResolvedValue({ id: "child_run_1", taskId: "task_1", parentLoopRunId: "parent_run_1" } as never);
    vi.mocked(retryFailedChildLoop).mockResolvedValue({ parentLoopRunId: "parent_run_1", childLoopRunId: "child_run_1", nodeRunId: "child_plan_2", activationNo: 2, duplicate: false });

    const response = await route.POST(new Request("http://localhost/api/loop-runs/child_run_1", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ command: "retry_child", commandId: "retry_child_plan", targetNodeId: "write_plan" }),
    }), context);

    expect(response.status).toBe(201);
    expect(retryFailedChildLoop).toHaveBeenCalledWith(expect.objectContaining({ targetNodeId: "write_plan" }));
  });
});
