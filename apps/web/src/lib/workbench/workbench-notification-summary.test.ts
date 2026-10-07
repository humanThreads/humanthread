import { describe, expect, it, vi } from "vitest";
import {
  getWorkbenchNotificationSummary,
  summarizeWorkbenchNotifications,
} from "./workbench-notification-summary";

describe("workbench notification summary", () => {
  it("aggregates unread and today counts for the selected space", async () => {
    const result = await getWorkbenchNotificationSummary({
      teamId: "team_1",
      userId: "user_owner",
      companyId: "company_1",
      ownerType: "company",
      now: new Date("2026-05-25T10:00:00.000Z"),
      dependencies: {
        getWorkbenchOverview: vi.fn().mockResolvedValue({
          currentTask: {
            task: {
              id: "task_1",
              status: "active",
              title: "处理登录问题",
              queuePosition: 0,
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
              description: null,
              localPath: null,
              defaultCommand: null,
            },
            toolSession: null,
            assignee: {
              id: "user_owner",
              name: "Alice",
              email: "alice@example.com",
              status: "active",
              lastSeenAt: null,
            },
          },
          queueLength: 0,
          team: { id: "team_1", name: "Team" },
          members: [],
          devices: [],
          timeline: {
            workflow: null,
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
                createdAt: new Date("2026-05-25T02:00:00.000Z"),
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
        listAccessibleProjectDocuments: vi.fn().mockResolvedValue([
          {
            id: "doc_1",
            projectId: "project_1",
            projectName: "Alpha 项目",
            title: "接口说明",
            path: "docs/api.md",
            version: 2,
            updatedAt: new Date("2026-05-25T03:00:00.000Z"),
          },
        ]),
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
          createdAt: new Date("2026-05-25T04:00:00.000Z"),
        }]),
        getReadNotificationIds: vi.fn().mockResolvedValue(
          new Set(["event:event_1"]),
        ),
      },
    });

    expect(result).toEqual({
      unreadCount: 3,
      todayCount: 4,
    });
  });

  it("can summarize notification counts from already loaded workbench data", () => {
    const result = summarizeWorkbenchNotifications({
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
      timelineEvents: [
        {
          id: "event_1",
          workflowInstanceId: "workflow_1",
          type: "task_blocked",
          message: "任务被阻塞",
          payload: { reason: "等待确认" },
          createdAt: new Date("2026-05-25T02:00:00.000Z"),
          task: {
            id: "task_1",
            title: "处理登录问题",
            status: "blocked",
            stepTemplateId: "step_1",
          },
        },
      ],
      documents: [
        {
          id: "doc_1",
          projectId: "project_1",
          projectName: "Alpha 项目",
          title: "接口说明",
          path: "docs/api.md",
          version: 2,
          updatedAt: new Date("2026-05-25T03:00:00.000Z"),
        },
      ],
      loopNotifications: [{
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
        createdAt: new Date("2026-05-25T04:00:00.000Z"),
      }],
      readNotificationIds: new Set(["event:event_1"]),
      now: new Date("2026-05-25T10:00:00.000Z"),
    });

    expect(result).toEqual({
      unreadCount: 3,
      todayCount: 4,
    });
  });
});
