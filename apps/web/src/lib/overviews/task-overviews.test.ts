import { describe, expect, it, vi } from "vitest";
import {
  getCurrentTaskForUser,
  getTeamOverview,
  getWorkflowTimeline,
  listWorkbenchInboxTasks,
} from "./task-overviews";

describe("getCurrentTaskForUser", () => {
  it("excludes archived tasks from the current-task query", async () => {
    const findMany = vi.fn().mockResolvedValue([]);

    await getCurrentTaskForUser({
      db: {
        task: { findMany },
      },
      teamId: "team_1",
      userId: "user_owner",
    });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          archivedAt: null,
        }),
      }),
    );
  });

  it("selects the active task and counts the remaining queue", async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        id: "task_pending",
        teamId: "team_1",
        workflowInstanceId: "workflow_2",
        projectId: "project_2",
        stepTemplateId: "step_review_result",
        title: "人工验收结果",
        description: "检查结果是否满足验收标准。",
        status: "pending",
        executorType: "human",
        assigneeUserId: "user_owner",
        queuePosition: 1,
        localPath: null,
        command: null,
        startedAt: null,
        completedAt: null,
        createdAt: new Date("2026-05-18T12:10:00.000Z"),
        updatedAt: new Date("2026-05-18T12:10:00.000Z"),
        workflowInstance: {
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
          ownerType: "company",
          companyId: "company_1",
          ownerUserId: null,
          visibility: "private",
          name: "另一个项目",
          description: null,
          localPath: "/tmp/project-2",
          defaultCommand: "codex",
          createdAt: new Date("2026-05-18T12:00:00.000Z"),
          updatedAt: new Date("2026-05-18T12:10:00.000Z"),
          company: {
            name: "HumanThread Company",
          },
        },
        assignee: {
          id: "user_owner",
          name: "alice",
          email: "alice@example.com",
          status: "active",
          lastSeenAt: new Date("2026-05-18T12:09:00.000Z"),
        },
      },
      {
        id: "task_active",
        teamId: "team_1",
        workflowInstanceId: "workflow_1",
        projectId: "project_1",
        stepTemplateId: "step_confirm_requirement",
        title: "确认需求",
        description: "确认需求边界、约束和验收标准。",
        status: "active",
        executorType: "human",
        assigneeUserId: "user_owner",
        queuePosition: 0,
        localPath: null,
        command: null,
        startedAt: new Date("2026-05-18T12:03:00.000Z"),
        completedAt: null,
        createdAt: new Date("2026-05-18T12:00:00.000Z"),
        updatedAt: new Date("2026-05-18T12:03:00.000Z"),
        workflowInstance: {
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
          lastSeenAt: new Date("2026-05-18T12:09:00.000Z"),
        },
      },
      {
        id: "task_completed",
        teamId: "team_1",
        workflowInstanceId: "workflow_3",
        projectId: "project_1",
        stepTemplateId: "step_review_result",
        title: "人工验收结果",
        description: "检查结果是否满足验收标准。",
        status: "completed",
        executorType: "human",
        assigneeUserId: "user_owner",
        queuePosition: 2,
        localPath: null,
        command: null,
        startedAt: new Date("2026-05-18T11:50:00.000Z"),
        completedAt: new Date("2026-05-18T11:55:00.000Z"),
        createdAt: new Date("2026-05-18T11:45:00.000Z"),
        updatedAt: new Date("2026-05-18T11:55:00.000Z"),
        workflowInstance: {
          id: "workflow_3",
          title: "旧流程",
          status: "completed",
          currentStepKey: "review_result",
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
          lastSeenAt: new Date("2026-05-18T12:09:00.000Z"),
        },
      },
    ]);

    const result = await getCurrentTaskForUser({
      db: {
        task: { findMany },
      },
      teamId: "team_1",
      userId: "user_owner",
    });

    expect(findMany).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      teamId: "team_1",
      userId: "user_owner",
      queueLength: 1,
      currentTask: {
        task: {
          id: "task_active",
          status: "active",
        },
        workflow: {
          id: "workflow_1",
          title: "第一个流程",
        },
        project: {
          id: "project_1",
          name: "HumanThread",
        },
      },
      queuedTasks: [
        {
          task: {
            id: "task_pending",
            status: "pending",
          },
          workflow: {
            id: "workflow_2",
            title: "第二个流程",
          },
          project: {
            id: "project_2",
            name: "另一个项目",
            spaceLabel: "HumanThread Company",
          },
        },
      ],
    });
  });

  it("returns no current task when the user has no unfinished work", async () => {
    const result = await getCurrentTaskForUser({
      db: {
        task: {
          findMany: vi.fn().mockResolvedValue([]),
        },
      },
      teamId: "team_1",
      userId: "user_idle",
    });

    expect(result).toEqual({
      teamId: "team_1",
      userId: "user_idle",
      currentTask: null,
      queueLength: 0,
      queuedTasks: [],
    });
  });

  it("omits standalone user tasks from the legacy Workflow overview", async () => {
    const result = await getCurrentTaskForUser({
      db: {
        task: {
          findMany: vi.fn().mockResolvedValue([
            {
              id: "task_standalone",
              teamId: "team_1",
              workflowInstanceId: null,
              projectId: null,
              stepTemplateId: null,
              title: "Standalone task",
              description: "",
              status: "active",
              executorType: "human",
              assigneeUserId: "user_owner",
              queuePosition: 0,
              localPath: null,
              command: null,
              startedAt: null,
              completedAt: null,
              createdAt: new Date("2026-07-22T00:00:00.000Z"),
              updatedAt: new Date("2026-07-22T00:00:00.000Z"),
              workflowInstance: null,
              project: null,
              toolSessions: [],
              assignee: {
                id: "user_owner",
                name: "Owner",
                email: null,
                status: "active",
                lastSeenAt: null,
              },
            },
          ]),
        },
      },
      teamId: "team_1",
      userId: "user_owner",
    });

    expect(result).toMatchObject({
      currentTask: null,
      queueLength: 0,
      queuedTasks: [],
    });
  });

  it("filters current tasks by company project ownership when requested", async () => {
    const findMany = vi.fn().mockResolvedValue([]);

    await getCurrentTaskForUser({
      db: {
        task: { findMany },
      },
      teamId: "team_1",
      userId: "user_owner",
      companyId: "company_1",
    });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          project: expect.objectContaining({
            companyId: "company_1",
            ownerType: "company",
          }),
        }),
      }),
    );
  });
});

describe("listWorkbenchInboxTasks", () => {
  it("omits standalone user tasks from the legacy Workflow inbox", async () => {
    const result = await listWorkbenchInboxTasks({
      db: {
        task: {
          findMany: vi.fn().mockResolvedValue([
            {
              id: "task_standalone",
              workflowInstanceId: null,
              projectId: null,
              stepTemplateId: null,
              title: "Standalone task",
              status: "active",
              queuePosition: 0,
              createdAt: new Date("2026-07-28T04:00:00.000Z"),
              updatedAt: new Date("2026-07-28T04:00:00.000Z"),
              workflowInstance: null,
              project: null,
              toolSessions: [],
              assignee: {
                id: "user_owner",
                name: "Owner",
                email: null,
                status: "active",
                lastSeenAt: null,
              },
            },
            {
              id: "task_legacy",
              workflowInstanceId: "workflow_1",
              projectId: "project_1",
              stepTemplateId: "step_1",
              title: "Legacy task",
              status: "pending",
              queuePosition: 1,
              createdAt: new Date("2026-07-28T03:00:00.000Z"),
              updatedAt: new Date("2026-07-28T03:00:00.000Z"),
              workflowInstance: {
                id: "workflow_1",
                title: "Legacy workflow",
                status: "running",
                currentStepKey: "step_1",
                matterType: {
                  id: "matter_1",
                  name: "Development",
                  description: null,
                },
              },
              project: {
                id: "project_1",
                ownerType: "personal",
                company: null,
                name: "HumanThread",
                description: null,
                localPath: null,
                defaultCommand: null,
              },
              toolSessions: [],
              assignee: {
                id: "user_owner",
                name: "Owner",
                email: null,
                status: "active",
                lastSeenAt: null,
              },
            },
          ]),
        },
      },
      teamId: "team_1",
      userId: "user_owner",
    });

    expect(result).toHaveLength(1);
    expect(result[0]?.task.id).toBe("task_legacy");
  });

  it("excludes archived tasks from the home inbox query", async () => {
    const findMany = vi.fn().mockResolvedValue([]);

    await listWorkbenchInboxTasks({
      db: {
        task: { findMany },
      },
      teamId: "team_1",
      userId: "user_owner",
    });

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          archivedAt: null,
        }),
      }),
    );
  });
});

describe("getTeamOverview", () => {
  it("excludes archived tasks from the team overview query", async () => {
    const taskFindMany = vi.fn().mockResolvedValue([]);

    await getTeamOverview({
      db: {
        team: {
          findUnique: vi.fn().mockResolvedValue({
            id: "team_1",
            name: "HumanThread Team",
          }),
        },
        user: {
          findMany: vi.fn().mockResolvedValue([]),
        },
        task: {
          findMany: taskFindMany,
        },
      },
      teamId: "team_1",
    });

    expect(taskFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          archivedAt: null,
        }),
      }),
    );
  });

  it("groups current work by team member", async () => {
    const teamFindUnique = vi.fn().mockResolvedValue({
      id: "team_1",
      name: "HumanThread Team",
    });
    const userFindMany = vi.fn().mockResolvedValue([
      {
        id: "user_owner",
        teamId: "team_1",
        name: "alice",
        email: "alice@example.com",
        status: "active",
        lastSeenAt: new Date("2026-05-18T12:09:00.000Z"),
        createdAt: new Date("2026-05-18T11:00:00.000Z"),
        updatedAt: new Date("2026-05-18T12:09:00.000Z"),
      },
      {
        id: "user_peer",
        teamId: "team_1",
        name: "Alice",
        email: "alice@example.com",
        status: "active",
        lastSeenAt: null,
        createdAt: new Date("2026-05-18T11:10:00.000Z"),
        updatedAt: new Date("2026-05-18T11:10:00.000Z"),
      },
      {
        id: "user_idle",
        teamId: "team_1",
        name: "Bob",
        email: null,
        status: "active",
        lastSeenAt: null,
        createdAt: new Date("2026-05-18T11:20:00.000Z"),
        updatedAt: new Date("2026-05-18T11:20:00.000Z"),
      },
    ]);
    const taskFindMany = vi.fn().mockResolvedValue([
      {
        id: "task_owner_active",
        teamId: "team_1",
        workflowInstanceId: "workflow_1",
        projectId: "project_1",
        stepTemplateId: "step_confirm_requirement",
        title: "确认需求",
        description: "确认需求边界、约束和验收标准。",
        status: "active",
        executorType: "human",
        assigneeUserId: "user_owner",
        queuePosition: 0,
        localPath: null,
        command: null,
        startedAt: new Date("2026-05-18T12:03:00.000Z"),
        completedAt: null,
        createdAt: new Date("2026-05-18T12:00:00.000Z"),
        updatedAt: new Date("2026-05-18T12:03:00.000Z"),
        workflowInstance: {
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
          lastSeenAt: new Date("2026-05-18T12:09:00.000Z"),
        },
      },
      {
        id: "task_owner_pending",
        teamId: "team_1",
        workflowInstanceId: "workflow_2",
        projectId: "project_2",
        stepTemplateId: "step_review_result",
        title: "人工验收结果",
        description: "检查结果是否满足验收标准。",
        status: "pending",
        executorType: "human",
        assigneeUserId: "user_owner",
        queuePosition: 1,
        localPath: null,
        command: null,
        startedAt: null,
        completedAt: null,
        createdAt: new Date("2026-05-18T12:10:00.000Z"),
        updatedAt: new Date("2026-05-18T12:10:00.000Z"),
        workflowInstance: {
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
          lastSeenAt: new Date("2026-05-18T12:09:00.000Z"),
        },
      },
      {
        id: "task_peer_pending",
        teamId: "team_1",
        workflowInstanceId: "workflow_4",
        projectId: "project_1",
        stepTemplateId: "step_confirm_requirement",
        title: "确认需求",
        description: "确认需求边界、约束和验收标准。",
        status: "pending",
        executorType: "human",
        assigneeUserId: "user_peer",
        queuePosition: 0,
        localPath: null,
        command: null,
        startedAt: null,
        completedAt: null,
        createdAt: new Date("2026-05-18T12:11:00.000Z"),
        updatedAt: new Date("2026-05-18T12:11:00.000Z"),
        workflowInstance: {
          id: "workflow_4",
          title: "第三个流程",
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
          id: "user_peer",
          name: "Alice",
          email: "alice@example.com",
          status: "active",
          lastSeenAt: null,
        },
      },
      {
        id: "task_peer_pending_2",
        teamId: "team_1",
        workflowInstanceId: "workflow_5",
        projectId: "project_1",
        stepTemplateId: "step_review_result",
        title: "人工验收结果",
        description: "检查结果是否满足验收标准。",
        status: "pending",
        executorType: "human",
        assigneeUserId: "user_peer",
        queuePosition: 1,
        localPath: null,
        command: null,
        startedAt: null,
        completedAt: null,
        createdAt: new Date("2026-05-18T12:12:00.000Z"),
        updatedAt: new Date("2026-05-18T12:12:00.000Z"),
        workflowInstance: {
          id: "workflow_5",
          title: "第四个流程",
          status: "running",
          currentStepKey: "review_result",
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
          id: "user_peer",
          name: "Alice",
          email: "alice@example.com",
          status: "active",
          lastSeenAt: null,
        },
      },
    ]);

    const result = await getTeamOverview({
      db: {
        team: { findUnique: teamFindUnique },
        user: { findMany: userFindMany },
        task: { findMany: taskFindMany },
      },
      teamId: "team_1",
    });

    expect(teamFindUnique).toHaveBeenCalledTimes(1);
    expect(userFindMany).toHaveBeenCalledTimes(1);
    expect(taskFindMany).toHaveBeenCalledTimes(1);
    expect(result.team).toEqual({
      id: "team_1",
      name: "HumanThread Team",
    });

    const owner = result.members.find((member) => member.user.id === "user_owner");
    const peer = result.members.find((member) => member.user.id === "user_peer");
    const idle = result.members.find((member) => member.user.id === "user_idle");

    expect(owner).toMatchObject({
      queueLength: 1,
      currentTask: {
        task: {
          id: "task_owner_active",
          status: "active",
        },
      },
    });
    expect(peer).toMatchObject({
      queueLength: 1,
      currentTask: {
        task: {
          id: "task_peer_pending_2",
          status: "pending",
        },
      },
    });
    expect(idle).toMatchObject({
      queueLength: 0,
      currentTask: null,
    });
  });

  it("filters team overview tasks to a personal workspace when requested", async () => {
    const userFindMany = vi.fn().mockResolvedValue([]);
    const taskFindMany = vi.fn().mockResolvedValue([]);

    await getTeamOverview({
      db: {
        team: {
          findUnique: vi.fn().mockResolvedValue({
            id: "team_1",
            name: "HumanThread Team",
          }),
        },
        user: {
          findMany: userFindMany,
        },
        task: {
          findMany: taskFindMany,
        },
      },
      teamId: "team_1",
      userId: "user_owner",
      ownerType: "personal",
    });

    expect(userFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: {
            in: ["user_owner"],
          },
        }),
      }),
    );
    expect(taskFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          assigneeUserId: {
            in: ["user_owner"],
          },
          project: expect.objectContaining({
            ownerType: "personal",
          }),
        }),
      }),
    );
  });

  it("limits all-space team members to the current user when they have no company", async () => {
    const companyMemberFindMany = vi.fn().mockResolvedValue([]);
    const userFindMany = vi.fn().mockResolvedValue([
      {
        id: "user_owner",
        name: "Owner",
        email: "owner@example.com",
        status: "active",
        lastSeenAt: null,
      },
    ]);

    await getTeamOverview({
      db: {
        team: {
          findUnique: vi.fn().mockResolvedValue({
            id: "team_1",
            name: "HumanThread Team",
          }),
        },
        companyMember: {
          findMany: companyMemberFindMany,
        },
        user: {
          findMany: userFindMany,
        },
        task: {
          findMany: vi.fn().mockResolvedValue([]),
        },
      },
      teamId: "team_1",
      userId: "user_owner",
    });

    expect(companyMemberFindMany).toHaveBeenCalled();
    expect(userFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: {
            in: ["user_owner"],
          },
        }),
      }),
    );
  });
});

describe("getWorkflowTimeline", () => {
  it("returns the workflow base info and chronological event timeline", async () => {
    const workflowFindUnique = vi.fn().mockResolvedValue({
      id: "workflow_1",
      projectId: "project_1",
      matterTypeId: "matter_dev",
      workflowTemplateId: "template_dev_v1",
      title: "实现通知页",
      description: "完成通知页和提醒交互。",
      status: "blocked",
      currentStepKey: "confirm_requirement",
      createdById: "user_owner",
      createdAt: new Date("2026-05-19T00:00:00.000Z"),
      updatedAt: new Date("2026-05-19T00:02:00.000Z"),
    });
    const taskEventFindMany = vi.fn().mockResolvedValue([
      {
        id: "workflow_1:workflow_created",
        taskId: "workflow_1:confirm_requirement",
        workflowInstanceId: "workflow_1",
        type: "workflow_created",
        actorType: "system",
        actorUserId: "user_owner",
        message: null,
        createdAt: new Date("2026-05-19T00:00:00.000Z"),
        task: {
          id: "workflow_1:confirm_requirement",
          title: "确认需求",
          status: "pending",
          stepTemplateId: "step_confirm_requirement",
        },
      },
      {
        id: "workflow_1:confirm_requirement:task_blocked",
        taskId: "workflow_1:confirm_requirement",
        workflowInstanceId: "workflow_1",
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
        createdAt: new Date("2026-05-19T00:03:00.000Z"),
        task: {
          id: "workflow_1:run_cli",
          title: "运行 Claude/Codex",
          status: "completed",
          stepTemplateId: "step_run_cli",
        },
      },
    ]);

    const result = await getWorkflowTimeline({
      db: {
        workflowInstance: {
          findUnique: workflowFindUnique,
        },
        taskEvent: {
          findMany: taskEventFindMany,
        },
      },
      workflowId: "workflow_1",
    });

    expect(workflowFindUnique).toHaveBeenCalledTimes(1);
    expect(taskEventFindMany).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      workflow: {
        id: "workflow_1",
        status: "blocked",
      },
      events: [
        {
          id: "workflow_1:workflow_created",
          type: "workflow_created",
          task: {
            id: "workflow_1:confirm_requirement",
            status: "pending",
          },
        },
        {
          id: "workflow_1:confirm_requirement:task_blocked",
          type: "task_blocked",
          message: "等待产品确认",
          task: {
            id: "workflow_1:confirm_requirement",
            status: "blocked",
          },
        },
        {
          id: "workflow_1:run_cli:cli_reported:1",
          type: "cli_reported",
          message: "CLI 已顺利完成",
          payload: {
            command: ["codex", "run"],
            exitCode: 0,
            durationSeconds: 120,
            status: "completed",
          },
          task: {
            id: "workflow_1:run_cli",
            status: "completed",
          },
        },
      ],
    });
  });

  it("returns null workflow and empty events when the workflow does not exist", async () => {
    const result = await getWorkflowTimeline({
      db: {
        workflowInstance: {
          findUnique: vi.fn().mockResolvedValue(null),
        },
        taskEvent: {
          findMany: vi.fn(),
        },
      },
      workflowId: "workflow_missing",
    });

    expect(result).toEqual({
      workflow: null,
      events: [],
    });
  });
});
