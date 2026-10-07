import { describe, expect, it, vi } from "vitest";
import {
  getWorkbenchDashboardData,
  type WorkbenchDashboardTask,
} from "./workbench-dashboard";
import { filterTasksBySavedView } from "./workbench-task-analytics";

function createInboxTask(input: {
  id: string;
  status: "active" | "pending" | "blocked" | "follow_up" | "interrupted";
  title: string;
  workflowTitle: string;
  projectId: string;
  projectName: string;
  queuePosition: number;
  localPath?: string | null;
  defaultCommand?: string | null;
  updatedAt: string;
  toolSession?: {
    id: string;
    sessionType: string;
    sessionName: string;
    status: string;
    lastOutputSummary: string | null;
  } | null;
}): Omit<
  WorkbenchDashboardTask,
  | "riskIds"
  | "contextMissingKeys"
  | "isToday"
  | "isQueued"
  | "requiresAttention"
  | "timeBucket"
  | "timeBucketLabel"
  | "priority"
  | "displayQueueLabel"
  | "displayQueueOrder"
> {
  return {
    task: {
      id: input.id,
      status: input.status,
      title: input.title,
      queuePosition: input.queuePosition,
      createdAt: new Date("2026-05-28T09:00:00.000Z"),
      updatedAt: new Date(input.updatedAt),
    },
    workflow: {
      id: `${input.id}:workflow`,
      title: input.workflowTitle,
      status: input.status === "blocked" ? "blocked" : "running",
      currentStepKey: input.title,
      matterType: {
        id: "matter_dev",
        name: "开发任务",
        description: "AI 辅助开发流程",
      },
    },
    project: {
      id: input.projectId,
      name: input.projectName,
      spaceLabel: "个人空间",
      description: "Project description",
      localPath: input.localPath ?? null,
      defaultCommand: input.defaultCommand ?? null,
    },
    toolSession: input.toolSession ?? null,
    assignee: {
      id: "user_owner",
      name: "Owner",
      email: "owner@example.com",
      status: "active",
      lastSeenAt: new Date("2026-05-28T09:30:00.000Z"),
    },
  };
}

describe("getWorkbenchDashboardData", () => {
  it("builds overdue/blocked stats and falls back to the first visible task for the selected filter", async () => {
    const listWorkbenchInboxTasks = vi.fn().mockResolvedValue([
      createInboxTask({
        id: "task_active",
        status: "active",
        title: "确认需求",
        workflowTitle: "小说后端数据库索引",
        projectId: "project_1",
        projectName: "HumanThread",
        queuePosition: 0,
        localPath: null,
        defaultCommand: null,
        updatedAt: "2026-05-28T08:10:00.000Z",
      }),
      createInboxTask({
        id: "task_queue",
        status: "pending",
        title: "执行索引变更",
        workflowTitle: "站内信同步修复",
        projectId: "project_2",
        projectName: "Message Center",
        queuePosition: 2,
        localPath: "/repo/message-center",
        defaultCommand: "pnpm test",
        updatedAt: "2026-05-27T07:10:00.000Z",
      }),
      createInboxTask({
        id: "task_blocked",
        status: "blocked",
        title: "等待凭据",
        workflowTitle: "支付回调联调",
        projectId: "project_3",
        projectName: "Payments",
        queuePosition: 1,
        localPath: "/repo/payments",
        defaultCommand: "pnpm dev",
        updatedAt: "2026-05-25T07:10:00.000Z",
      }),
    ]);
    const getTeamOverview = vi.fn().mockResolvedValue({
      team: {
        id: "team_1",
        name: "HumanThread Team",
      },
      members: [
        {
          user: {
            id: "user_owner",
            name: "Owner",
            email: "owner@example.com",
            status: "active",
            lastSeenAt: new Date("2026-05-28T09:30:00.000Z"),
          },
          currentTask: null,
          queueLength: 2,
        },
      ],
    });
    const getWorkbenchDevices = vi.fn().mockResolvedValue([
      {
        id: "device_1",
        name: "Owner Mac",
        platform: "macos",
        status: "authorized",
        authorizedAt: new Date("2026-05-28T08:00:00.000Z"),
        revokedAt: null,
        lastSeenAt: new Date("2026-05-28T09:45:00.000Z"),
        user: {
          id: "user_owner",
          name: "Owner",
        },
      },
    ]);
    const listAccessibleProjectDocuments = vi.fn().mockResolvedValue([
      {
        id: "doc_payment",
        projectId: "project_3",
        projectName: "Payments",
        title: "支付联调说明",
        path: "docs/payment-debug.md",
        version: 1,
        updatedAt: new Date("2026-05-28T09:20:00.000Z"),
      },
    ]);
    const listWorkbenchMcpCredentials = vi.fn().mockResolvedValue([
      {
        id: "cred_1",
        name: "Codex",
        status: "active",
        lastUsedAt: null,
        createdAt: new Date("2026-05-28T09:00:00.000Z"),
        revokedAt: null,
      },
    ]);
    const getWorkflowTimeline = vi.fn().mockResolvedValue({
      workflow: {
        id: "task_blocked:workflow",
        projectId: "project_3",
        matterTypeId: "matter_dev",
        workflowTemplateId: "template_dev_v1",
        title: "支付回调联调",
        description: "补齐线上回调验收条件并完成联调。",
        status: "blocked",
        currentStepKey: "等待凭据",
        createdById: "user_owner",
        createdAt: new Date("2026-05-28T07:00:00.000Z"),
        updatedAt: new Date("2026-05-28T09:00:00.000Z"),
      },
      events: [
        {
          id: "task_blocked:event_1",
          taskId: "task_blocked",
          workflowInstanceId: "task_blocked:workflow",
          type: "task_blocked",
          actorType: "human",
          actorUserId: "user_owner",
          message: "等待支付沙箱凭据",
          payload: null,
          createdAt: new Date("2026-05-28T09:00:00.000Z"),
          task: {
            id: "task_blocked",
            title: "等待凭据",
            status: "blocked",
            stepTemplateId: "step_wait_credential",
          },
        },
      ],
    });
    const getWorkbenchProjects = vi.fn().mockResolvedValue([
      {
        id: "project_1",
        name: "HumanThread",
        description: null,
        localPath: null,
        defaultCommand: null,
        updatedAt: new Date("2026-05-28T08:00:00.000Z"),
        activeWorkflowCount: 2,
      },
      {
        id: "project_3",
        name: "Payments",
        description: null,
        localPath: "/repo/payments",
        defaultCommand: "pnpm dev",
        updatedAt: new Date("2026-05-28T07:00:00.000Z"),
        activeWorkflowCount: 1,
      },
    ]);

    const result = await getWorkbenchDashboardData(
      {
        teamId: "team_1",
        userId: "user_owner",
        filterKey: "blocked",
        selectedTaskId: "task_queue",
      },
      {
        listWorkbenchInboxTasks,
        getTeamOverview,
        getWorkbenchDevices,
        listAccessibleProjectDocuments,
        listWorkbenchMcpCredentials,
        getWorkflowTimeline,
        getWorkbenchProjects,
        getNow: () => new Date("2026-05-28T12:00:00.000Z"),
      },
    );

    expect(result.activeFilter).toBe("blocked");
    expect(result.selectedTaskId).toBe("task_blocked");
    expect(result.stats).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: "blocked",
          label: "阻塞",
          count: 1,
        }),
        expect.objectContaining({
          key: "overdue",
          label: "已逾期",
          count: 1,
        }),
        expect.objectContaining({
          key: "devices",
          label: "Agent 可用",
          count: 1,
        }),
      ]),
    );
    expect(result.inboxGroups).toHaveLength(1);
    expect(result.inboxGroups[0]).toMatchObject({
      key: "overdue",
      title: "已逾期",
    });
    expect(result.inboxGroups[0]?.tasks.map((task) => task.task.id)).toEqual(["task_blocked"]);
    expect(result.detail).toMatchObject({
      task: {
        task: {
          id: "task_blocked",
        },
      },
      metadata: {
        ownerLabel: "Owner",
        agentLabel: "待接管",
        priorityLabel: "高",
        dueLabel: "已逾期",
        phaseLabel: "等待凭据",
        projectLabel: "Payments · 个人空间",
      },
      context: {
        complete: 5,
        total: 5,
      },
      nextAction: {
        label: "解除阻塞并继续推进",
      },
    });
    expect(result.detail?.risks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: "任务已阻塞",
          description: "等待支付沙箱凭据",
        }),
      ]),
    );
  });

  it("groups the inbox by overdue, today, next 7 days, and later windows", async () => {
    const result = await getWorkbenchDashboardData(
      {
        teamId: "team_1",
        userId: "user_owner",
      },
      {
        listWorkbenchInboxTasks: vi.fn().mockResolvedValue([
          createInboxTask({
            id: "task_today",
            status: "active",
            title: "确认需求",
            workflowTitle: "首页路由修复",
            projectId: "project_1",
            projectName: "HumanThread",
            queuePosition: 0,
            localPath: "/repo/humanthread",
            defaultCommand: "pnpm --filter web test",
            updatedAt: "2026-05-28T11:10:00.000Z",
          }),
          createInboxTask({
            id: "task_next_7",
            status: "pending",
            title: "执行索引变更",
            workflowTitle: "站内信同步修复",
            projectId: "project_2",
            projectName: "Message Center",
            queuePosition: 3,
            localPath: "/repo/message-center",
            defaultCommand: "pnpm test",
            updatedAt: "2026-05-27T07:10:00.000Z",
          }),
          createInboxTask({
            id: "task_later",
            status: "pending",
            title: "补充迁移文档",
            workflowTitle: "归档历史报表",
            projectId: "project_4",
            projectName: "Reports",
            queuePosition: 12,
            localPath: "/repo/reports",
            defaultCommand: "pnpm lint",
            updatedAt: "2026-05-26T07:10:00.000Z",
          }),
          createInboxTask({
            id: "task_overdue",
            status: "blocked",
            title: "等待凭据",
            workflowTitle: "支付回调联调",
            projectId: "project_3",
            projectName: "Payments",
            queuePosition: 1,
            localPath: "/repo/payments",
            defaultCommand: "pnpm dev",
            updatedAt: "2026-05-25T07:10:00.000Z",
            toolSession: {
              id: "tool_session_1",
              sessionType: "codex",
              sessionName: "Owner Mac",
              status: "active",
              lastOutputSummary: "waiting for credentials",
            },
          }),
        ]),
        getTeamOverview: vi.fn().mockResolvedValue({
          team: {
            id: "team_1",
            name: "HumanThread Team",
          },
          members: [],
        }),
        getWorkbenchDevices: vi.fn().mockResolvedValue([]),
        listAccessibleProjectDocuments: vi.fn().mockResolvedValue([]),
        listWorkbenchMcpCredentials: vi.fn().mockResolvedValue([]),
        getWorkflowTimeline: vi.fn().mockResolvedValue({
          workflow: {
            id: "task_today:workflow",
            projectId: "project_1",
            matterTypeId: "matter_dev",
            workflowTemplateId: "template_dev_v1",
            title: "首页路由修复",
            description: "补齐路由回退逻辑。",
            status: "running",
            currentStepKey: "确认需求",
            createdById: "user_owner",
            createdAt: new Date("2026-05-28T07:00:00.000Z"),
            updatedAt: new Date("2026-05-28T09:00:00.000Z"),
          },
          events: [],
        }),
        getWorkbenchProjects: vi.fn().mockResolvedValue([]),
        getNow: () => new Date("2026-05-28T12:00:00.000Z"),
      },
    );

    expect(result.stats).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "today", count: 1 }),
        expect.objectContaining({ key: "overdue", count: 1 }),
        expect.objectContaining({ key: "queue", count: 2 }),
      ]),
    );
    expect(result.inboxGroups.map((group) => group.key)).toEqual([
      "overdue",
      "today",
      "next_7",
      "later",
    ]);
    expect(result.inboxGroups.map((group) => group.title)).toEqual([
      "已逾期",
      "今天",
      "未来 7 天",
      "以后或未安排",
    ]);
  });

  it("treats unscheduled pending tasks as queue work so stats stay aligned with the visible inbox", async () => {
    const result = await getWorkbenchDashboardData(
      {
        teamId: "team_1",
        userId: "user_owner",
      },
      {
        listWorkbenchInboxTasks: vi.fn().mockResolvedValue([
          createInboxTask({
            id: "task_unscheduled_1",
            status: "pending",
            title: "确认需求",
            workflowTitle: "任务一",
            projectId: "project_1",
            projectName: "HumanThread",
            queuePosition: 0,
            updatedAt: "2026-05-20T07:10:00.000Z",
          }),
          createInboxTask({
            id: "task_unscheduled_2",
            status: "pending",
            title: "补充文档",
            workflowTitle: "任务二",
            projectId: "project_2",
            projectName: "Docs",
            queuePosition: 0,
            updatedAt: "2026-05-20T08:10:00.000Z",
          }),
          createInboxTask({
            id: "task_unscheduled_3",
            status: "pending",
            title: "等待反馈",
            workflowTitle: "任务三",
            projectId: "project_3",
            projectName: "Ops",
            queuePosition: 0,
            updatedAt: "2026-05-20T09:10:00.000Z",
          }),
          createInboxTask({
            id: "task_unscheduled_4",
            status: "pending",
            title: "验证回归",
            workflowTitle: "任务四",
            projectId: "project_4",
            projectName: "QA",
            queuePosition: 0,
            updatedAt: "2026-05-20T10:10:00.000Z",
          }),
        ]),
        getTeamOverview: vi.fn().mockResolvedValue({
          team: {
            id: "team_1",
            name: "HumanThread Team",
          },
          members: [],
        }),
        getWorkbenchDevices: vi.fn().mockResolvedValue([]),
        listAccessibleProjectDocuments: vi.fn().mockResolvedValue([]),
        listWorkbenchMcpCredentials: vi.fn().mockResolvedValue([]),
        getWorkflowTimeline: vi.fn().mockResolvedValue({
          workflow: null,
          events: [],
        }),
        getWorkbenchProjects: vi.fn().mockResolvedValue([]),
        getNow: () => new Date("2026-05-28T12:00:00.000Z"),
      },
    );

    expect(result.stats).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "today", count: 0 }),
        expect.objectContaining({ key: "overdue", count: 0 }),
        expect.objectContaining({ key: "blocked", count: 0 }),
        expect.objectContaining({ key: "queue", count: 4 }),
      ]),
    );
    expect(result.inboxGroups.map((group) => group.key)).toEqual(["later"]);
    expect(result.inboxGroups[0]?.tasks).toHaveLength(4);
  });

  it("groups the inbox by phase when the phase view is selected", async () => {
    const result = await getWorkbenchDashboardData(
      {
        teamId: "team_1",
        userId: "user_owner",
        viewKey: "phase",
      },
      {
        listWorkbenchInboxTasks: vi.fn().mockResolvedValue([
          createInboxTask({
            id: "task_confirm",
            status: "active",
            title: "确认需求",
            workflowTitle: "小说后端数据库索引",
            projectId: "project_1",
            projectName: "HumanThread",
            queuePosition: 0,
            updatedAt: "2026-05-28T11:10:00.000Z",
          }),
          createInboxTask({
            id: "task_execute",
            status: "pending",
            title: "执行索引变更",
            workflowTitle: "站内信同步修复",
            projectId: "project_2",
            projectName: "Message Center",
            queuePosition: 3,
            updatedAt: "2026-05-27T07:10:00.000Z",
          }),
        ]),
        getTeamOverview: vi.fn().mockResolvedValue({
          team: {
            id: "team_1",
            name: "HumanThread Team",
          },
          members: [],
        }),
        getWorkbenchDevices: vi.fn().mockResolvedValue([]),
        listAccessibleProjectDocuments: vi.fn().mockResolvedValue([]),
        listWorkbenchMcpCredentials: vi.fn().mockResolvedValue([]),
        getWorkflowTimeline: vi.fn().mockResolvedValue({
          workflow: null,
          events: [],
        }),
        getWorkbenchProjects: vi.fn().mockResolvedValue([]),
        getNow: () => new Date("2026-05-28T12:00:00.000Z"),
      },
    );

    expect(result.activeView).toBe("phase");
    expect(result.inboxGroups.map((group) => group.title)).toEqual([
      "确认需求",
      "执行索引变更",
    ]);
  });

  it("groups the inbox by risk when the risk view is selected", async () => {
    const result = await getWorkbenchDashboardData(
      {
        teamId: "team_1",
        userId: "user_owner",
        viewKey: "risk",
      },
      {
        listWorkbenchInboxTasks: vi.fn().mockResolvedValue([
          createInboxTask({
            id: "task_blocked",
            status: "blocked",
            title: "等待凭据",
            workflowTitle: "支付回调联调",
            projectId: "project_3",
            projectName: "Payments",
            queuePosition: 1,
            localPath: "/repo/payments",
            defaultCommand: "pnpm dev",
            updatedAt: "2026-05-25T07:10:00.000Z",
          }),
          createInboxTask({
            id: "task_missing_path",
            status: "active",
            title: "确认需求",
            workflowTitle: "小说后端数据库索引",
            projectId: "project_1",
            projectName: "HumanThread",
            queuePosition: 0,
            localPath: null,
            defaultCommand: "pnpm dev",
            updatedAt: "2026-05-28T08:10:00.000Z",
          }),
          createInboxTask({
            id: "task_ready",
            status: "pending",
            title: "执行索引变更",
            workflowTitle: "站内信同步修复",
            projectId: "project_2",
            projectName: "Message Center",
            queuePosition: 2,
            localPath: "/repo/message-center",
            defaultCommand: "pnpm test",
            updatedAt: "2026-05-27T07:10:00.000Z",
          }),
        ]),
        getTeamOverview: vi.fn().mockResolvedValue({
          team: {
            id: "team_1",
            name: "HumanThread Team",
          },
          members: [],
        }),
        getWorkbenchDevices: vi.fn().mockResolvedValue([]),
        listAccessibleProjectDocuments: vi.fn().mockResolvedValue([
          {
            id: "doc_1",
            projectId: "project_2",
            projectName: "Message Center",
            title: "站内信联动说明",
            path: "docs/message-center.md",
            version: 1,
            updatedAt: new Date("2026-05-28T09:20:00.000Z"),
          },
        ]),
        listWorkbenchMcpCredentials: vi.fn().mockResolvedValue([
          {
            id: "cred_1",
            name: "Codex",
            status: "active",
            lastUsedAt: null,
            createdAt: new Date("2026-05-28T09:00:00.000Z"),
            revokedAt: null,
          },
        ]),
        getWorkflowTimeline: vi.fn().mockResolvedValue({
          workflow: null,
          events: [],
        }),
        getWorkbenchProjects: vi.fn().mockResolvedValue([]),
        getNow: () => new Date("2026-05-28T12:00:00.000Z"),
      },
    );

    expect(result.activeView).toBe("risk");
    expect(result.inboxGroups.map((group) => group.title)).toEqual([
      "阻塞中",
      "缺少目录",
      "可继续执行",
    ]);
    expect(result.inboxGroups[0]?.tasks.map((task) => task.task.id)).toEqual([
      "task_blocked",
    ]);
  });

  it("clears selected detail when the saved view excludes the selected task", async () => {
    const result = await getWorkbenchDashboardData(
      {
        teamId: "team_1",
        userId: "user_owner",
        selectedTaskId: "task_missing_context",
      },
      {
        listWorkbenchInboxTasks: vi.fn().mockResolvedValue([
          createInboxTask({
            id: "task_missing_context",
            status: "active",
            title: "确认需求",
            workflowTitle: "小说后端数据库索引",
            projectId: "project_1",
            projectName: "HumanThread",
            queuePosition: 0,
            localPath: null,
            defaultCommand: null,
            updatedAt: "2026-05-28T11:10:00.000Z",
          }),
          createInboxTask({
            id: "task_ready",
            status: "pending",
            title: "执行索引变更",
            workflowTitle: "站内信同步修复",
            projectId: "project_2",
            projectName: "Message Center",
            queuePosition: 2,
            localPath: "/repo/message-center",
            defaultCommand: "pnpm test",
            updatedAt: "2026-05-27T07:10:00.000Z",
          }),
        ]),
        getTeamOverview: vi.fn().mockResolvedValue({
          team: {
            id: "team_1",
            name: "HumanThread Team",
          },
          members: [],
        }),
        getWorkbenchDevices: vi.fn().mockResolvedValue([]),
        listAccessibleProjectDocuments: vi.fn().mockResolvedValue([
          {
            id: "doc_1",
            projectId: "project_2",
            projectName: "Message Center",
            title: "站内信联动说明",
            path: "docs/message-center.md",
            version: 1,
            updatedAt: new Date("2026-05-28T09:20:00.000Z"),
          },
        ]),
        listWorkbenchMcpCredentials: vi.fn().mockResolvedValue([
          {
            id: "cred_1",
            name: "Codex",
            status: "active",
            lastUsedAt: null,
            createdAt: new Date("2026-05-28T09:00:00.000Z"),
            revokedAt: null,
          },
        ]),
        getWorkflowTimeline: vi.fn().mockResolvedValue({
          workflow: null,
          events: [],
        }),
        getWorkbenchProjects: vi.fn().mockResolvedValue([]),
        getNow: () => new Date("2026-05-28T12:00:00.000Z"),
      },
    );

    const agentReadyTasks = filterTasksBySavedView(result.allTasks, "agent_ready");

    expect(agentReadyTasks.map((task) => task.task.id)).toEqual(["task_ready"]);
    expect(agentReadyTasks.find((task) => task.task.id === result.selectedTaskId)).toBeUndefined();
  });

  it("returns an empty dashboard safely when the inbox has no tasks", async () => {
    const getWorkflowTimeline = vi.fn();

    const result = await getWorkbenchDashboardData(
      {
        teamId: "team_1",
        userId: "user_owner",
      },
      {
        listWorkbenchInboxTasks: vi.fn().mockResolvedValue([]),
        getTeamOverview: vi.fn().mockResolvedValue({
          team: {
            id: "team_1",
            name: "HumanThread Team",
          },
          members: [],
        }),
        getWorkbenchDevices: vi.fn().mockResolvedValue([]),
        listAccessibleProjectDocuments: vi.fn().mockResolvedValue([]),
        listWorkbenchMcpCredentials: vi.fn().mockResolvedValue([]),
        getWorkflowTimeline,
        getWorkbenchProjects: vi.fn().mockResolvedValue([]),
        getNow: () => new Date("2026-05-28T12:00:00.000Z"),
      },
    );

    expect(result.selectedTaskId).toBeNull();
    expect(result.detail).toBeNull();
    expect(result.inboxGroups).toEqual([]);
    expect(getWorkflowTimeline).not.toHaveBeenCalled();
  });

  it("assigns a visible 1-based inbox order to pending tasks even when raw queue positions are zero", async () => {
    const result = await getWorkbenchDashboardData(
      {
        teamId: "team_1",
        userId: "user_owner",
      },
      {
        listWorkbenchInboxTasks: vi.fn().mockResolvedValue([
          createInboxTask({
            id: "task_pending_a",
            status: "pending",
            title: "补任务说明",
            workflowTitle: "支付回调联调",
            projectId: "project_1",
            projectName: "Payments",
            queuePosition: 0,
            localPath: "/repo/payments",
            defaultCommand: "pnpm dev",
            updatedAt: "2026-05-28T08:10:00.000Z",
          }),
          createInboxTask({
            id: "task_pending_b",
            status: "pending",
            title: "补 MCP 凭据",
            workflowTitle: "站内信同步修复",
            projectId: "project_2",
            projectName: "Message Center",
            queuePosition: 0,
            localPath: "/repo/message-center",
            defaultCommand: "pnpm test",
            updatedAt: "2026-05-28T07:10:00.000Z",
          }),
          createInboxTask({
            id: "task_blocked",
            status: "blocked",
            title: "等待目录",
            workflowTitle: "首页路由修复",
            projectId: "project_3",
            projectName: "HumanThread",
            queuePosition: 0,
            localPath: null,
            defaultCommand: null,
            updatedAt: "2026-05-27T07:10:00.000Z",
          }),
        ]),
        getTeamOverview: vi.fn().mockResolvedValue({
          team: {
            id: "team_1",
            name: "HumanThread Team",
          },
          members: [],
        }),
        getWorkbenchDevices: vi.fn().mockResolvedValue([]),
        listAccessibleProjectDocuments: vi.fn().mockResolvedValue([]),
        listWorkbenchMcpCredentials: vi.fn().mockResolvedValue([]),
        getWorkflowTimeline: vi.fn().mockResolvedValue({
          workflow: null,
          events: [],
        }),
        getWorkbenchProjects: vi.fn().mockResolvedValue([]),
        getNow: () => new Date("2026-05-28T12:00:00.000Z"),
      },
    );

    const pendingTasks = result.allTasks.filter(
      (task) => task.task.status === "pending",
    );

    expect(pendingTasks.map((task) => task.displayQueueOrder)).toEqual([1, 2]);
    expect(pendingTasks.map((task) => task.displayQueueLabel)).toEqual([
      "队列 #1",
      "队列 #2",
    ]);
    expect(
      result.allTasks.find((task) => task.task.id === "task_blocked")
        ?.displayQueueLabel,
    ).toBeNull();
  });
});
