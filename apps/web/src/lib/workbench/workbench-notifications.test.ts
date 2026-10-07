import { describe, expect, it, vi } from "vitest";
import { buildWorkbenchNotificationFeed, projectLoopNotification, projectTaskActivityNotifications } from "./workbench-notifications";

describe("workbench notifications feed", () => {
  it("merges current task, timeline events, and document updates", () => {
    const result = buildWorkbenchNotificationFeed({
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
          createdAt: new Date("2026-05-22T01:00:00.000Z"),
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
          updatedAt: new Date("2026-05-22T02:00:00.000Z"),
        },
      ],
      readNotificationIds: new Set(["event:event_1"]),
      now: new Date("2026-05-22T10:00:00.000Z"),
    });

    expect(result.summary).toEqual({
      unreadCount: 2,
      todayCount: 3,
    });
    expect(result.items[0]?.title).toContain("当前任务");
    expect(result.items.find((item) => item.id === "event:event_1")?.isUnread).toBe(false);
    expect(result.items.map((item) => item.href)).toContain(
      "/projects/project_1",
    );
    expect(result.items.map((item) => item.href)).toContain(
      "/workflows/workflow_1",
    );
    expect(result.items.map((item) => item.href)).toContain(
      "/projects/project_1/documents/doc_1",
    );
    expect(result.items.map((item) => item.openHref)).toContain(
      "/notifications/open?notificationId=task%3Atask_1&redirectTo=%2Fprojects%2Fproject_1",
    );
  });
});

describe("TaskActivity notification projection", () => {
  it("projects explicit recipients after rechecking Task visibility", async () => {
    const canReadTask = vi.fn().mockResolvedValue(true);
    const result = await projectTaskActivityNotifications({
      recipientUserId: "user_2",
      activities: [{
        id: "activity_1", taskId: "task_1", taskTitle: "安全发布", type: "assigned",
        actorUserId: "user_1", message: "任务负责人已更新", payload: { assigneeUserId: "user_2" },
        createdAt: new Date("2026-07-22T01:00:00.000Z"), recipientUserIds: ["user_2"], followerUserIds: [],
      }],
      canReadTask,
    });
    expect(canReadTask).toHaveBeenCalledWith({ userId: "user_2", taskId: "task_1" });
    expect(result).toEqual([expect.objectContaining({
      id: "task-activity:activity_1:user_2", href: "/tasks/task_1", title: "任务负责人已更新",
    })]);
  });

  it("suppresses self notifications and revoked visibility", async () => {
    const base = {
      id: "activity_1", taskId: "task_1", taskTitle: "安全发布", type: "comment_added",
      actorUserId: "user_1", message: "新评论", payload: {}, createdAt: new Date(),
      recipientUserIds: ["user_1", "user_2"], followerUserIds: [],
    };
    await expect(projectTaskActivityNotifications({ recipientUserId: "user_1", activities: [base], canReadTask: vi.fn() }))
      .resolves.toEqual([]);
    await expect(projectTaskActivityNotifications({ recipientUserId: "user_2", activities: [base], canReadTask: vi.fn().mockResolvedValue(false) }))
      .resolves.toEqual([]);
  });

  it("honors follower preferences for non-explicit collaboration updates", async () => {
    const activity = {
      id: "activity_follow", taskId: "task_1", taskTitle: "安全发布", type: "content_updated",
      actorUserId: "user_1", message: "正文已更新", payload: {}, createdAt: new Date(),
      recipientUserIds: [], followerUserIds: ["user_follower"],
    };
    await expect(projectTaskActivityNotifications({
      recipientUserId: "user_follower", activities: [activity], followerUpdatesEnabled: false,
      canReadTask: vi.fn().mockResolvedValue(true),
    })).resolves.toEqual([]);
  });
});

describe("Loop notification projection", () => {
  it("keeps the persisted tier and deep-links to the Run or approval", () => {
    const source = {
      id: "loop-notification:notice_1",
      projectId: "project_1",
      loopRunId: "run_1",
      loopNodeRunId: "node_1",
      recipientUserId: "user_1",
      level: "critical",
      title: "Loop 重试预算已耗尽",
      description: "质量门禁已达到最大返工次数",
      eventFamily: "loop.run.exhausted",
      channels: ["in_app", "desktop"],
      approvalId: null,
      templateData: {},
      readAt: null,
      createdAt: new Date("2026-07-31T08:00:00.000Z"),
    } as const;
    const exhausted = projectLoopNotification(source);
    const approval = projectLoopNotification({
      ...source,
      id: "loop-notification:notice_2",
      level: "action_required",
      approvalId: "approval_1",
    });

    expect(exhausted).toMatchObject({ href: "/loop-runs/run_1", tone: "warning", isUnread: true });
    expect(approval.href).toBe("/agents?approvalId=approval_1");
  });
});
