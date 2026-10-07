import { describe, expect, it, vi } from "vitest";
import { GET } from "./route";

vi.mock("@/lib/overviews/task-overviews", () => ({
  getWorkflowTimeline: vi.fn().mockResolvedValue({
    workflow: {
      id: "workflow_1",
      title: "实现通知页",
      description: "完成通知页和提醒交互。",
      status: "blocked",
      currentStepKey: "confirm_requirement",
      projectId: "project_1",
      matterTypeId: "matter_dev",
      workflowTemplateId: "template_dev_v1",
      createdById: "user_owner",
      createdAt: new Date("2026-05-19T00:00:00.000Z"),
      updatedAt: new Date("2026-05-19T00:02:00.000Z"),
    },
    events: [
      {
        id: "workflow_1:confirm_requirement:task_blocked",
        type: "task_blocked",
        actorType: "human",
        actorUserId: "user_owner",
        message: "等待产品确认",
        createdAt: new Date("2026-05-19T00:02:00.000Z"),
        task: {
          id: "workflow_1:confirm_requirement",
          title: "确认需求",
          status: "blocked",
          stepTemplateId: "step_confirm_requirement",
        },
      },
    ],
  }),
}));

describe("GET /api/workflows/[workflowId]/timeline", () => {
  it("returns the workflow timeline", async () => {
    const response = await GET(
      new Request("http://localhost:3000/api/workflows/workflow_1/timeline"),
      {
        params: Promise.resolve({
          workflowId: "workflow_1",
        }),
      },
    );

    const body = (await response.json()) as {
      ok: boolean;
      workflow: { id: string; status: string } | null;
      events: Array<{ type: string; message?: string; task: { id: string } }>;
    };

    expect(body).toMatchObject({
      ok: true,
      workflow: {
        id: "workflow_1",
        status: "blocked",
      },
      events: [
        {
          type: "task_blocked",
          message: "等待产品确认",
          task: {
            id: "workflow_1:confirm_requirement",
          },
        },
      ],
    });
  });
});
