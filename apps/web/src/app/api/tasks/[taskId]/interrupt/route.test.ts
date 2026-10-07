import { describe, expect, it, vi } from "vitest";
import { interruptTaskAction } from "@/lib/tasks/task-status-actions";
import { POST } from "./route";

vi.mock("../../../../../lib/workbench/workbench-api-session", () => ({
  resolveWorkbenchApiActor: vi.fn().mockResolvedValue({ userId: "user_session" }),
}));

vi.mock("@/lib/tasks/task-status-actions", () => ({
  interruptTaskAction: vi.fn().mockResolvedValue({
    workflow: {
      id: "workflow_1",
      currentStepKey: "confirm_requirement",
      status: "running",
    },
    task: {
      id: "workflow_1:confirm_requirement",
      status: "interrupted",
    },
    events: [
      {
        id: "workflow_1:confirm_requirement:task_interrupted",
        type: "task_interrupted",
        message: "去处理紧急问题",
      },
    ],
  }),
}));

describe("POST /api/tasks/[taskId]/interrupt", () => {
  it("interrupts the task and returns the updated task state", async () => {
    const response = await POST(
      new Request("http://localhost:3000/api/tasks/workflow_1%3Aconfirm_requirement/interrupt", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          actorUserId: "user_attacker",
          reason: "去处理紧急问题",
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
        status: "interrupted",
      },
      workflow: {
        status: "running",
      },
      events: [
        {
          type: "task_interrupted",
          message: "去处理紧急问题",
        },
      ],
    });
    expect(interruptTaskAction).toHaveBeenCalledWith(expect.objectContaining({
      actorUserId: "user_session",
    }));
  });
});
