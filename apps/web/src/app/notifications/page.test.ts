import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("../../lib/workbench/workbench-route-auth", () => ({
  requireWorkbenchSession: vi.fn().mockResolvedValue({
    session: {
      context: {
        userId: "user_owner",
        teamId: "team_1",
      },
      loginEmail: "alice@example.com",
    },
    cookieStore: {
      get: vi.fn().mockReturnValue(undefined),
    },
  }),
}));

vi.mock("../../lib/workbench/workbench-companies", () => ({
  getWorkbenchCompanyFilters: vi.fn().mockResolvedValue([
    { key: "all", label: "全部", companyId: null, ownerType: null },
  ]),
}));

vi.mock("../../lib/workbench/workbench-dashboard", () => ({
  getWorkbenchDashboardData: vi.fn().mockResolvedValue({
    detail: {
      task: {
        task: {
          id: "task_1",
          status: "active",
          title: "处理登录问题",
        },
        workflow: {
          id: "workflow_1",
          title: "主流程",
          status: "active",
          currentStepKey: "step_1",
          matterType: {
            id: "matter_1",
            name: "开发任务",
            description: null,
          },
        },
        project: {
          id: "project_1",
          name: "Alpha 项目",
          spaceLabel: "个人空间",
          description: null,
          localPath: "/repo",
          defaultCommand: "pnpm test",
        },
        toolSession: null,
        assignee: {
          id: "user_owner",
          name: "Owner",
          email: "owner@example.com",
          status: "active",
          lastSeenAt: null,
        },
        riskIds: [],
        contextMissingKeys: [],
        isToday: true,
        isQueued: false,
        requiresAttention: true,
        timeBucket: "today",
        timeBucketLabel: "今天",
        priority: "high",
        displayQueueOrder: 1,
        displayQueueLabel: "队列 #1",
      },
      metadata: {
        ownerLabel: "Owner",
        agentLabel: "待接管",
        priorityLabel: "高",
        dueLabel: "今天",
        phaseLabel: "处理登录问题",
        projectLabel: "Alpha 项目 · 个人空间",
      },
      workflowDescription: null,
      context: {
        complete: 5,
        total: 5,
        items: [],
      },
      risks: [],
      nextAction: {
        label: "继续执行",
        description: "继续推进当前事项。",
      },
      relatedDocuments: [],
      timelineEvents: [],
      executionLinks: [],
    },
  }),
}));

vi.mock("../../lib/workbench/workbench-overview", () => ({
  getWorkbenchOverview: vi.fn().mockResolvedValue({
    currentTask: {
      task: {
        id: "task_1",
        status: "active",
        title: "处理登录问题",
      },
      workflow: {
        id: "workflow_1",
        title: "主流程",
        status: "active",
        currentStepKey: "step_1",
      },
      project: {
        id: "project_1",
        name: "Alpha 项目",
      },
    },
    queueLength: 0,
    team: { id: "team_1", name: "Team" },
    members: [
      {
        user: {
          id: "user_1",
          name: "张三",
          email: "zhangsan@example.com",
          status: "active",
          lastSeenAt: new Date("2026-05-22T00:00:00.000Z"),
        },
        currentTask: null,
        queueLength: 0,
      },
    ],
    devices: [],
    timeline: {
      workflow: {
        id: "workflow_1",
        projectId: "project_1",
        matterTypeId: "matter_1",
        workflowTemplateId: "template_1",
        title: "主流程",
        description: null,
        status: "active",
        currentStepKey: "step_1",
        createdById: "user_owner",
        createdAt: new Date("2026-05-22T00:00:00.000Z"),
        updatedAt: new Date("2026-05-22T00:00:00.000Z"),
      },
      events: [
        {
          id: "event_1",
          taskId: "task_1",
          workflowInstanceId: "workflow_1",
          type: "task_blocked",
          actorType: "user",
          actorUserId: "user_owner",
          message: "任务被阻塞",
          payload: { reason: "等待确认" },
          createdAt: new Date("2026-05-22T01:00:00.000Z"),
          task: {
            id: "task_1",
            title: "处理登录问题",
            status: "blocked",
            stepTemplateId: "step_1",
          },
        },
      ],
    },
  }),
}));

vi.mock("../../lib/workbench/workbench-projects", () => ({
  getWorkbenchProjects: vi.fn(),
}));

vi.mock("../../lib/workbench/workbench-documents", () => ({
  listAccessibleProjectDocuments: vi.fn().mockResolvedValue([
    {
      id: "doc_1",
      projectId: "project_1",
      projectName: "Alpha 项目",
      title: "接口说明",
      path: "docs/api.md",
      version: 2,
      updatedAt: new Date("2026-05-22T02:30:00.000Z"),
    },
  ]),
}));

vi.mock("../../lib/workbench/workbench-notification-state", () => ({
  getReadWorkbenchNotificationIds: vi.fn().mockResolvedValue(new Set()),
}));

vi.mock("../../lib/workbench/workbench-notifications", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../lib/workbench/workbench-notifications")>();
  return {
    ...original,
    listAccessibleLoopNotificationIntents: vi.fn().mockResolvedValue([{
      id: "loop-notification:notice_1",
      projectId: "project_1",
      loopRunId: "run_1",
      loopNodeRunId: "node_1",
      recipientUserId: "user_owner",
      level: "critical",
      title: "Loop 重试预算已耗尽",
      description: "质量门禁已达到最大返工次数",
      eventFamily: "loop.run.exhausted",
      channels: ["in_app", "desktop"],
      approvalId: null,
      templateData: {},
      readAt: null,
      createdAt: new Date("2026-05-22T03:00:00.000Z"),
    }]),
  };
});

vi.mock("../components/workbench-notification-link", () => ({
  WorkbenchNotificationLink: ({
    initialUnreadCount,
  }: {
    initialUnreadCount?: number;
  }) =>
    createElement("span", {
      "data-notification-count": initialUnreadCount ?? 0,
    }),
}));

import NotificationsPage from "./page";

describe("notifications page", () => {
  it("renders the real notification feed", async () => {
    const markup = renderToStaticMarkup(await NotificationsPage());

    expect(markup).toContain("通知中心");
    expect(markup).toContain("当前任务");
    expect(markup).toContain("任务被阻塞");
    expect(markup).toContain("接口说明");
    expect(markup).toContain("Loop 重试预算已耗尽");
    expect(markup).toContain('data-notification-count="4"');
    expect(markup).toContain("/tasks");
    expect(markup).toContain("/team");
    expect(markup).toContain("/notifications/open?notificationId=task%3Atask_1");
    expect(markup).toContain("/notifications/open?notificationId=event%3Aevent_1");
    expect(markup).toContain("/notifications/open?notificationId=loop-notification%3Anotice_1");
  });

  it("preserves selected task context in notification actions", async () => {
    const markup = renderToStaticMarkup(
      await NotificationsPage({
        searchParams: Promise.resolve({
          taskId: "task_1",
        }),
      } as never),
    );

    expect(markup).toContain("当前关注任务");
    expect(markup).toContain("处理登录问题");
    expect(markup).toContain("/tasks/task_1");
  });
});
