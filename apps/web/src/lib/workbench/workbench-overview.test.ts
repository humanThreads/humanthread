import { describe, expect, it, vi } from "vitest";
import { getWorkbenchOverview } from "./workbench-overview";

describe("getWorkbenchOverview", () => {
  it("loads current task, team overview and workflow timeline for the current workflow", async () => {
    const getCurrentTaskForUser = vi.fn().mockResolvedValue({
      teamId: "team_1",
      userId: "user_owner",
      queueLength: 1,
      queuedTasks: [
        {
          task: {
            id: "workflow_2:review_result",
            status: "pending",
            title: "人工验收结果",
            queuePosition: 1,
          },
          workflow: {
            id: "workflow_2",
            title: "第二个流程",
            status: "running",
            currentStepKey: "review_result",
            matterType: {
              id: "matter_dev",
              name: "开发任务",
              description: "AI 辅助开发流程",
            },
          },
          project: {
            id: "project_2",
            name: "另一个项目",
            description: null,
            localPath: "/tmp/project-2",
            defaultCommand: "codex",
          },
          assignee: {
            id: "user_owner",
            name: "alice",
            email: "alice@example.com",
            status: "active",
            lastSeenAt: null,
          },
          toolSession: null,
        },
      ],
      currentTask: {
        task: {
          id: "workflow_1:run_cli",
          status: "active",
          title: "运行 Claude/Codex",
          queuePosition: 0,
        },
        workflow: {
          id: "workflow_1",
          title: "实现通知页",
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
        assignee: {
          id: "user_owner",
          name: "alice",
          email: "alice@example.com",
          status: "active",
          lastSeenAt: null,
        },
      },
    });
    const getTeamOverview = vi.fn().mockResolvedValue({
      team: {
        id: "team_1",
        name: "HumanThread Team",
      },
      members: [
        {
          user: {
            id: "user_owner",
            name: "alice",
            email: "alice@example.com",
            status: "active",
            lastSeenAt: null,
          },
          currentTask: null,
          queueLength: 1,
        },
      ],
    });
    const getWorkbenchDevices = vi.fn().mockResolvedValue([
      {
        id: "device_mac_1",
        name: "agent-macbook",
        platform: "macos",
        lastSeenAt: new Date("2026-05-19T00:04:00.000Z"),
        status: "authorized",
        authorizedAt: new Date("2026-05-19T00:01:00.000Z"),
        revokedAt: null,
        user: {
          id: "user_owner",
          name: "alice",
        },
      },
    ]);
    const getWorkflowTimeline = vi.fn().mockResolvedValue({
      workflow: {
        id: "workflow_1",
        projectId: "project_1",
        matterTypeId: "matter_dev",
        workflowTemplateId: "template_dev_v1",
        title: "实现通知页",
        description: "完成通知页和提醒交互。",
        status: "running",
        currentStepKey: "run_cli",
        createdById: "user_owner",
        createdAt: new Date("2026-05-19T00:00:00.000Z"),
        updatedAt: new Date("2026-05-19T00:05:00.000Z"),
      },
      events: [
        {
          id: "workflow_1:run_cli:cli_reported:1",
          taskId: "workflow_1:run_cli",
          workflowInstanceId: "workflow_1",
          type: "cli_reported",
          actorType: "human",
          actorUserId: "user_owner",
          message: "CLI 已顺利完成",
          payload: {
            command: ["codex", "run"],
            exitCode: 0,
            durationSeconds: 120,
            status: "completed",
          },
          createdAt: new Date("2026-05-19T00:05:00.000Z"),
          task: {
            id: "workflow_1:run_cli",
            title: "运行 Claude/Codex",
            status: "completed",
            stepTemplateId: "step_run_cli",
          },
        },
      ],
    });

    const result = await getWorkbenchOverview(
      {
        teamId: "team_1",
        userId: "user_owner",
      },
      {
        getCurrentTaskForUser,
        getTeamOverview,
        getWorkbenchDevices,
        getWorkflowTimeline,
      },
    );

    expect(getCurrentTaskForUser).toHaveBeenCalledWith({
      teamId: "team_1",
      userId: "user_owner",
    });
    expect(getTeamOverview).toHaveBeenCalledWith({
      teamId: "team_1",
      userId: "user_owner",
    });
    expect(getWorkbenchDevices).toHaveBeenCalledWith({
      teamId: "team_1",
    });
    expect(getWorkflowTimeline).toHaveBeenCalledWith({
      workflowId: "workflow_1",
    });
    expect(result).toMatchObject({
      currentTask: {
        task: {
          id: "workflow_1:run_cli",
        },
      },
      queueLength: 1,
      queuedTasks: [
        {
          task: {
            id: "workflow_2:review_result",
          },
        },
      ],
      team: {
        id: "team_1",
      },
      devices: [
        {
          id: "device_mac_1",
          platform: "macos",
          status: "authorized",
        },
      ],
      timeline: {
        workflow: {
          id: "workflow_1",
        },
        events: [
          {
            type: "cli_reported",
            payload: {
              exitCode: 0,
            },
          },
        ],
      },
    });
  });

  it("skips timeline loading when there is no current task", async () => {
    const getCurrentTaskForUser = vi.fn().mockResolvedValue({
      teamId: "team_1",
      userId: "user_owner",
      queueLength: 0,
      queuedTasks: [],
      currentTask: null,
    });
    const getTeamOverview = vi.fn().mockResolvedValue({
      team: {
        id: "team_1",
        name: "HumanThread Team",
      },
      members: [],
    });
    const getWorkbenchDevices = vi.fn().mockResolvedValue([]);
    const getWorkflowTimeline = vi.fn();

    const result = await getWorkbenchOverview(
      {
        teamId: "team_1",
        userId: "user_owner",
      },
      {
        getCurrentTaskForUser,
        getTeamOverview,
        getWorkbenchDevices,
        getWorkflowTimeline,
      },
    );

    expect(getWorkflowTimeline).not.toHaveBeenCalled();
    expect(result.devices).toEqual([]);
    expect(result.queuedTasks).toEqual([]);
    expect(result.timeline).toEqual({
      workflow: null,
      events: [],
    });
  });

  it("passes project space filters to task overview queries", async () => {
    const getCurrentTaskForUser = vi.fn().mockResolvedValue({
      teamId: "team_1",
      userId: "user_owner",
      queueLength: 0,
      queuedTasks: [],
      currentTask: null,
    });
    const getTeamOverview = vi.fn().mockResolvedValue({
      team: {
        id: "team_1",
        name: "HumanThread Team",
      },
      members: [],
    });
    const getWorkbenchDevices = vi.fn().mockResolvedValue([]);

    await getWorkbenchOverview(
      {
        teamId: "team_1",
        userId: "user_owner",
        companyId: "company_1",
      },
      {
        getCurrentTaskForUser,
        getTeamOverview,
        getWorkbenchDevices,
        getWorkflowTimeline: vi.fn(),
      },
    );

    expect(getCurrentTaskForUser).toHaveBeenCalledWith({
      teamId: "team_1",
      userId: "user_owner",
      companyId: "company_1",
    });
    expect(getTeamOverview).toHaveBeenCalledWith({
      teamId: "team_1",
      userId: "user_owner",
      companyId: "company_1",
    });
  });
});
