import { describe, expect, it, vi } from "vitest";
import { GET } from "./route";

vi.mock("@/lib/overviews/task-overviews", () => ({
  getCurrentTaskForUser: vi.fn().mockResolvedValue({
    teamId: "team_1",
    userId: "user_owner",
    currentTask: {
      task: {
        id: "task_active",
        status: "active",
        title: "确认需求",
        queuePosition: 0,
      },
      workflow: {
        id: "workflow_1",
        title: "第一个流程",
        status: "running",
        currentStepKey: "confirm_requirement",
        matterType: {
          id: "matter_dev",
          name: "开发任务",
          description: "AI 辅助开发流程",
        },
      },
      project: {
        id: "project_1",
        name: "HumanThread",
        description: "HumanThread 主项目",
        localPath: "/Users/alice/IdeaProjects/humanThread",
        defaultCommand: "codex",
      },
      assignee: {
        id: "user_owner",
        name: "alice",
        email: "alice@example.com",
        status: "active",
        lastSeenAt: null,
      },
    },
    queueLength: 1,
  }),
}));

describe("GET /api/tasks/current", () => {
  it("returns the current task overview", async () => {
    const response = await GET(
      new Request("http://localhost:3000/api/tasks/current?teamId=team_1&userId=user_owner"),
    );
    const body = (await response.json()) as {
      ok: boolean;
      teamId: string;
      userId: string;
      queueLength: number;
      currentTask: { task: { id: string } } | null;
    };

    expect(body).toMatchObject({
      ok: true,
      teamId: "team_1",
      userId: "user_owner",
      queueLength: 1,
      currentTask: {
        task: {
          id: "task_active",
        },
      },
    });
  });
});
