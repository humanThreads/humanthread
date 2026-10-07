import { describe, expect, it, vi } from "vitest";
import { getAgentCurrentTask } from "./agent-current-task";

describe("getAgentCurrentTask", () => {
  it("maps the current task overview into the local agent shape", async () => {
    const getCurrentTaskForUser = vi.fn().mockResolvedValue({
      teamId: "team_1",
      userId: "user_owner",
      queueLength: 2,
      currentTask: {
        task: {
          id: "workflow_1:run_cli",
          status: "active",
          title: "运行 Claude/Codex",
          queuePosition: 0,
        },
        workflow: {
          id: "workflow_1",
          title: "实现任务工作台交互",
          status: "running",
          currentStepKey: "run_cli",
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
        toolSession: {
          id: "tool_session_1",
          sessionType: "tmux",
          sessionName: "ht-workflow_1-run_cli-device_mac_1",
          status: "active",
          lastOutputSummary: "正在安装依赖",
        },
        assignee: {
          id: "user_owner",
          name: "alice",
          email: "alice@example.com",
          status: "active",
          lastSeenAt: null,
        },
      },
    });

    const result = await getAgentCurrentTask(
      {
        teamId: "team_1",
        userId: "user_owner",
      },
      {
        getCurrentTaskForUser,
      },
    );

    expect(getCurrentTaskForUser).toHaveBeenCalledWith({
      teamId: "team_1",
      userId: "user_owner",
    });
    expect(result).toEqual({
      teamId: "team_1",
      userId: "user_owner",
      queueLength: 2,
      task: {
        id: "workflow_1:run_cli",
        title: "运行 Claude/Codex",
        projectId: "project_1",
        projectName: "HumanThread",
        workflowInstanceId: "workflow_1",
        workflowTitle: "实现任务工作台交互",
        status: "active",
        localPath: "/Users/alice/IdeaProjects/humanThread",
        command: "codex",
        toolSession: {
          id: "tool_session_1",
          sessionType: "tmux",
          sessionName: "ht-workflow_1-run_cli-device_mac_1",
          status: "active",
          lastOutputSummary: "正在安装依赖",
        },
      },
    });
  });

  it("returns a null task when the user has no current task", async () => {
    const result = await getAgentCurrentTask(
      {
        teamId: "team_1",
        userId: "user_owner",
      },
      {
        getCurrentTaskForUser: vi.fn().mockResolvedValue({
          teamId: "team_1",
          userId: "user_owner",
          queueLength: 0,
          currentTask: null,
        }),
      },
    );

    expect(result.task).toBeNull();
    expect(result.queueLength).toBe(0);
  });
});
