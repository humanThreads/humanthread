import { describe, expect, it, vi } from "vitest";
import { resolveWorkbenchApiActor } from "../../../../../lib/workbench/workbench-api-session";
import { startTaskAction } from "@/lib/tasks/task-status-actions";
import { POST } from "./route";

vi.mock("../../../../../lib/workbench/workbench-api-session", () => ({
  resolveWorkbenchApiActor: vi.fn().mockResolvedValue({ userId: "user_session" }),
}));
vi.mock("@/lib/tasks/task-status-actions", () => ({
  startTaskAction: vi.fn().mockResolvedValue({
    workflow: {
      id: "workflow_1",
      currentStepKey: "confirm_requirement",
      status: "running",
    },
    task: {
      id: "workflow_1:confirm_requirement",
      status: "active",
    },
    events: [
      {
        id: "workflow_1:confirm_requirement:task_started",
        type: "task_started",
      },
    ],
  }),
}));

describe("POST /api/tasks/[taskId]/start", () => {
  it("starts the task and returns the updated task state", async () => {
    const response = await POST(
      new Request("http://localhost:3000/api/tasks/workflow_1%3Aconfirm_requirement/start", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          actorUserId: "user_attacker",
        }),
      }),
      {
        params: Promise.resolve({
          taskId: "workflow_1:confirm_requirement",
        }),
      },
    );

    const body = (await response.json()) as {
      ok: boolean;
      task: { status: string };
      workflow: { id: string };
    };

    expect(body).toMatchObject({
      ok: true,
      task: {
        status: "active",
      },
      workflow: {
        id: "workflow_1",
      },
    });
    expect(resolveWorkbenchApiActor).toHaveBeenCalled();
    expect(startTaskAction).toHaveBeenCalledWith(expect.objectContaining({
      actorUserId: "user_session",
    }));
  });

  it("returns 401 when no signed Workbench session exists", async () => {
    vi.mocked(resolveWorkbenchApiActor).mockRejectedValueOnce(
      new Error("Workbench API authentication required"),
    );

    const response = await POST(
      new Request("http://localhost/api/tasks/task_1/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ actorUserId: "user_attacker" }),
      }),
      { params: Promise.resolve({ taskId: "task_1" }) },
    );

    expect(response.status).toBe(401);
  });
});
