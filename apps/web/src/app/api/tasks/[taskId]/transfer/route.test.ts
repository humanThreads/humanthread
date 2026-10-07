import { describe, expect, it, vi } from "vitest";
import { transferTaskAction } from "@/lib/tasks/task-status-actions";
import { POST } from "./route";

vi.mock("../../../../../lib/workbench/workbench-api-session", () => ({
  resolveWorkbenchApiActor: vi.fn().mockResolvedValue({ userId: "user_session" }),
}));

vi.mock("@/lib/tasks/task-status-actions", () => ({
  transferTaskAction: vi.fn().mockResolvedValue({
    workflow: {
      id: "workflow_1",
      currentStepKey: "confirm_requirement",
      status: "running",
    },
    task: {
      id: "workflow_1:confirm_requirement",
      status: "transferred",
      assigneeUserId: "user_peer",
    },
    events: [
      {
        id: "workflow_1:confirm_requirement:task_transferred",
        type: "task_transferred",
        message: "转交给同组同学继续",
      },
    ],
  }),
}));

describe("POST /api/tasks/[taskId]/transfer", () => {
  it("transfers the task and returns the updated state", async () => {
    const response = await POST(
      new Request("http://localhost:3000/api/tasks/workflow_1%3Aconfirm_requirement/transfer", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          actorUserId: "user_attacker",
          targetUserId: "user_peer",
          reason: "转交给同组同学继续",
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
      task: { status: string; assigneeUserId?: string };
      events: Array<{ type: string; message?: string }>;
    };

    expect(body).toMatchObject({
      ok: true,
      task: {
        status: "transferred",
        assigneeUserId: "user_peer",
      },
      events: [
        {
          type: "task_transferred",
          message: "转交给同组同学继续",
        },
      ],
    });
    expect(transferTaskAction).toHaveBeenCalledWith(expect.objectContaining({
      actorUserId: "user_session",
    }));
  });
});
