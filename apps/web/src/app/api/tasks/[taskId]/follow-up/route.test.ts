import { describe, expect, it, vi } from "vitest";
import { followUpTaskAction } from "@/lib/tasks/task-status-actions";
import { POST } from "./route";

vi.mock("../../../../../lib/workbench/workbench-api-session", () => ({
  resolveWorkbenchApiActor: vi.fn().mockResolvedValue({ userId: "user_session" }),
}));

vi.mock("@/lib/tasks/task-status-actions", () => ({
  followUpTaskAction: vi.fn().mockResolvedValue({
    workflow: {
      id: "workflow_1",
      currentStepKey: "confirm_requirement",
      status: "running",
    },
    task: {
      id: "workflow_1:confirm_requirement",
      status: "follow_up",
    },
    events: [
      {
        id: "workflow_1:confirm_requirement:task_follow_up_created",
        type: "task_follow_up_created",
        message: "需要补充验收边界",
      },
    ],
  }),
}));

describe("POST /api/tasks/[taskId]/follow-up", () => {
  it("marks the task for follow-up and returns the updated state", async () => {
    const response = await POST(
      new Request("http://localhost:3000/api/tasks/workflow_1%3Aconfirm_requirement/follow-up", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          actorUserId: "user_attacker",
          reason: "需要补充验收边界",
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
      events: Array<{ type: string; message?: string }>;
    };

    expect(body).toMatchObject({
      ok: true,
      task: {
        status: "follow_up",
      },
      events: [
        {
          type: "task_follow_up_created",
          message: "需要补充验收边界",
        },
      ],
    });
    expect(followUpTaskAction).toHaveBeenCalledWith(expect.objectContaining({
      actorUserId: "user_session",
    }));
  });
});
