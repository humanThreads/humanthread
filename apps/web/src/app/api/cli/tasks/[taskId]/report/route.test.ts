import { describe, expect, it, vi } from "vitest";
import { authenticateCliTaskReport } from "@/lib/tasks/cli-report-actions";
import { POST } from "./route";

vi.mock("@/lib/tasks/cli-report-actions", () => ({
  authenticateCliTaskReport: vi.fn().mockResolvedValue({ userId: "user_owner", teamId: "team_1" }),
  reportCliTaskStatusAction: vi.fn().mockResolvedValue({
    reportedStatus: "completed",
    workflow: {
      id: "workflow_1",
      currentStepKey: "run_cli",
      status: "running",
    },
    task: {
      id: "workflow_1:confirm_requirement",
      status: "completed",
    },
    nextTask: {
      id: "workflow_1:run_cli",
      status: "pending",
    },
    events: [
      {
        id: "workflow_1:confirm_requirement:cli_reported:1",
        type: "cli_reported",
        message: "CLI 已顺利完成",
      },
      {
        id: "workflow_1:confirm_requirement:task_completed",
        type: "task_completed",
      },
    ],
  }),
}));

describe("POST /api/cli/tasks/[taskId]/report", () => {
  it("reports cli status and returns the updated workflow state", async () => {
    const response = await POST(
      new Request("http://localhost:3000/api/cli/tasks/workflow_1%3Aconfirm_requirement/report", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer token_123",
        },
        body: JSON.stringify({
          status: "completed",
          exitCode: 0,
          durationSeconds: 120,
          outputSummary: "CLI 已顺利完成",
          payload: {
            command: "codex",
          },
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
      reportedStatus: string;
      task: { status: string };
      nextTask: { id: string } | null;
      events: Array<{ type: string; message?: string }>;
    };

    expect(body).toMatchObject({
      ok: true,
      reportedStatus: "completed",
      task: {
        status: "completed",
      },
      nextTask: {
        id: "workflow_1:run_cli",
      },
    });
    expect(body.events[0]).toMatchObject({
      type: "cli_reported",
      message: "CLI 已顺利完成",
    });
    expect(authenticateCliTaskReport).toHaveBeenCalledWith({
      taskId: "workflow_1:confirm_requirement",
      authorizationHeader: "Bearer token_123",
    });
  });

  it("returns 401 before reporting when the CLI token is invalid", async () => {
    vi.mocked(authenticateCliTaskReport).mockRejectedValueOnce(
      new Error("Missing agent authorization token"),
    );

    const response = await POST(
      new Request("http://localhost/api/cli/tasks/task_1/report", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "completed" }),
      }),
      { params: Promise.resolve({ taskId: "task_1" }) },
    );

    expect(response.status).toBe(401);
  });
});
