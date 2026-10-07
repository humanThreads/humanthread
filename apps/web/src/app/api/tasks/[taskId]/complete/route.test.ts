import { describe, expect, it, vi } from "vitest";
import { completeTaskAction } from "@/lib/tasks/task-status-actions";
import { POST } from "./route";

vi.mock("../../../../../lib/workbench/workbench-api-session", () => ({
  resolveWorkbenchApiActor: vi.fn().mockResolvedValue({ userId: "user_session" }),
}));

vi.mock("@/lib/tasks/task-status-actions", () => ({
  completeTaskAction: vi.fn().mockResolvedValue({
    workflow: {
      id: "workflow_1",
      currentStepKey: "run_cli",
      status: "running",
    },
    completedTask: {
      id: "workflow_1:confirm_requirement",
      status: "completed",
    },
    nextTask: {
      id: "workflow_1:run_cli",
      status: "pending",
    },
    events: [
      {
        id: "workflow_1:confirm_requirement:task_completed",
        type: "task_completed",
      },
      {
        id: "workflow_1:run_cli:task_created",
        type: "task_created",
      },
    ],
  }),
}));

describe("POST /api/tasks/[taskId]/complete", () => {
  it("completes the task and returns the updated workflow state", async () => {
    const response = await POST(
      new Request("http://localhost:3000/api/tasks/workflow_1%3Aconfirm_requirement/complete", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          teamId: "team_attacker",
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
      completedTask: { status: string };
      nextTask: { id: string } | null;
      workflow: { currentStepKey: string };
    };

    expect(body).toMatchObject({
      ok: true,
      completedTask: {
        status: "completed",
      },
      nextTask: {
        id: "workflow_1:run_cli",
      },
      workflow: {
        currentStepKey: "run_cli",
      },
    });
    expect(completeTaskAction).toHaveBeenCalledWith(expect.objectContaining({
      actorUserId: "user_session",
    }));
  });
});
