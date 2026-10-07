import { describe, expect, it, vi } from "vitest";
import { blockTaskAction } from "@/lib/tasks/task-status-actions";
import { POST } from "./route";

vi.mock("../../../../../lib/workbench/workbench-api-session", () => ({
  resolveWorkbenchApiActor: vi.fn().mockResolvedValue({ userId: "user_session" }),
}));

vi.mock("@/lib/tasks/task-status-actions", () => ({
  blockTaskAction: vi.fn().mockResolvedValue({
    workflow: {
      id: "workflow_1",
      currentStepKey: "confirm_requirement",
      status: "blocked",
    },
    task: {
      id: "workflow_1:confirm_requirement",
      status: "blocked",
    },
    events: [
      {
        id: "workflow_1:confirm_requirement:task_blocked",
        type: "task_blocked",
        message: "等待产品确认",
      },
    ],
  }),
}));

describe("POST /api/tasks/[taskId]/block", () => {
  it("blocks the task and returns the updated task state", async () => {
    const response = await POST(
      new Request("http://localhost:3000/api/tasks/workflow_1%3Aconfirm_requirement/block", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          actorUserId: "user_attacker",
          reason: "等待产品确认",
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
      workflow: { status: string };
      events: Array<{ type: string; message?: string }>;
    };

    expect(body).toMatchObject({
      ok: true,
      task: {
        status: "blocked",
      },
      workflow: {
        status: "blocked",
      },
      events: [
        {
          type: "task_blocked",
          message: "等待产品确认",
        },
      ],
    });
    expect(blockTaskAction).toHaveBeenCalledWith(expect.objectContaining({
      actorUserId: "user_session",
    }));
  });
});
