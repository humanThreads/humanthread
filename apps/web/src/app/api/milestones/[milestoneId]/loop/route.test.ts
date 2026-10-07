import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@humanthread/db";
import { triggerTaskLoop } from "@/lib/orchestration/loop-trigger-commands";
import { resolveWorkbenchApiActor } from "@/lib/workbench/workbench-api-session";
import { POST } from "./route";

vi.mock("@humanthread/db", () => ({
  prisma: { milestone: { findUnique: vi.fn() }, projectLoopBinding: { findFirst: vi.fn() } },
}));
vi.mock("@/lib/orchestration/loop-trigger-commands", () => ({ triggerTaskLoop: vi.fn() }));
vi.mock("@/lib/workbench/workbench-api-session", () => ({ resolveWorkbenchApiActor: vi.fn() }));

const context = { params: Promise.resolve({ milestoneId: "milestone_1" }) };
const poolId = "a".repeat(32);
const request = (body: unknown) => new Request("http://localhost/api/milestones/milestone_1/loop", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

describe("POST /api/milestones/:milestoneId/loop", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveWorkbenchApiActor).mockResolvedValue({ userId: "user_1", authKind: "web_session", webSessionId: "a".repeat(32) });
    vi.mocked(triggerTaskLoop).mockResolvedValue({ id: "loop_run:task_1" } as never);
    vi.mocked(prisma.milestone.findUnique).mockResolvedValue({
      id: "milestone_1",
      projectId: "project_1",
      version: 1,
      tasks: [
        { id: "task_1", statusCategory: "in_progress", archivedAt: null, projectId: "project_1" },
        { id: "task_2", statusCategory: "completed", archivedAt: null, projectId: "project_1" },
      ],
    } as never);
    vi.mocked(prisma.projectLoopBinding.findFirst).mockResolvedValue({ id: "binding_1" } as never);
  });

  it("refuses to trigger any task without a valid execution target", async () => {
    for (const executionTarget of [undefined, null, { type: "local_agent", agentProfileId: "  " }, { type: "linux_worker_pool", workerPoolId: "bad" }]) {
      const response = await POST(request({ commandId: "cmd_1", executionTarget }), context);

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({ ok: false, error: "请选择执行目标" });
    }
    expect(triggerTaskLoop).not.toHaveBeenCalled();
  });

  it("starts eligible tasks with the selected execution target", async () => {
    const response = await POST(request({ commandId: "cmd_1", executionTarget: { type: "linux_worker_pool", workerPoolId: poolId } }), context);
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body).toMatchObject({ ok: true, result: { started: 1, skipped: 1, failed: 0 } });
    expect(triggerTaskLoop).toHaveBeenCalledTimes(1);
    expect(triggerTaskLoop).toHaveBeenCalledWith(expect.objectContaining({
      actorUserId: "user_1",
      taskId: "task_1",
      executionTarget: { type: "linux_worker_pool", workerPoolId: poolId },
      payload: { source: "milestone_batch", milestoneId: "milestone_1" },
    }));
  });

  it("skips every task and never triggers when no Loop binding is enabled", async () => {
    vi.mocked(prisma.projectLoopBinding.findFirst).mockResolvedValue(null as never);

    const response = await POST(request({ commandId: "cmd_1", executionTarget: { type: "linux_worker_pool", workerPoolId: poolId } }), context);
    const body = await response.json() as { result: { started: number; skipped: number; failed: number } };

    expect(body.result).toMatchObject({ started: 0, skipped: 2, failed: 0 });
    expect(triggerTaskLoop).not.toHaveBeenCalled();
  });
});
