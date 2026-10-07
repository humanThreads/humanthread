import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  markDesktopNotificationRead,
  projectLoopNotification,
  readDesktopNotifications,
} from "./desktop-notification-models";

const context = {
  actor: { userId: "user_1", authKind: "desktop_token", sessionId: "session_1" },
  space: {
    id: "space:company:company_1",
    key: "company:company_1",
    kind: "company",
    name: "Acme",
    role: "admin",
    companyId: "company_1",
  },
  spaces: [],
  workbench: { teamId: "team_1" },
  nativeExecutionAuthorized: true,
  localDeviceId: "device_1",
} as const;

const overview = {
  currentTask: {
    task: { id: "task_1", status: "active", title: "Build desktop notifications" },
    workflow: {
      id: "workflow_1",
      title: "Desktop delivery",
      status: "active",
      currentStepKey: "implementation",
    },
    project: { id: "project_1", name: "HumanThread" },
  },
  queueLength: 0,
  queuedTasks: [],
  team: { id: "team_1", name: "HumanThread" },
  members: [],
  devices: [],
  timeline: {
    workflow: null,
    events: [{
      id: "event_1",
      taskId: "task_1",
      workflowInstanceId: "workflow_1",
      type: "approval_waiting",
      actorType: "system",
      actorUserId: null,
      message: "等待人工审批",
      payload: { approvalId: "approval_1" },
      createdAt: new Date("2026-07-27T09:00:00.000Z"),
      task: {
        id: "task_1",
        title: "Build desktop notifications",
        status: "active",
        stepTemplateId: "implementation",
      },
    }],
  },
};

const document = {
  id: "doc_1",
  projectId: "project_1",
  projectName: "HumanThread",
  title: "Desktop notification design",
  path: "notifications/design.md",
  version: 3,
  updatedAt: new Date("2026-07-27T08:00:00.000Z"),
};

const loopNotification = {
  id: "loop-notification:notice_1",
  projectId: "project_1",
  loopRunId: "run_1",
  loopNodeRunId: "node_1",
  recipientUserId: "user_1",
  level: "critical" as const,
  title: "Loop 重试预算已耗尽",
  description: "质量门禁已达到最大返工次数",
  eventFamily: "loop.run.exhausted",
  channels: ["in_app", "desktop"] as const,
  approvalId: null,
  templateData: {},
  readAt: null,
  createdAt: new Date("2026-07-27T10:00:00.000Z"),
};

function dependencies(overrides: Record<string, unknown> = {}) {
  return {
    resolveDesktopReadContext: vi.fn().mockResolvedValue(context),
    getWorkbenchOverview: vi.fn().mockResolvedValue(overview),
    listAccessibleProjectDocuments: vi.fn().mockResolvedValue([document]),
    listAccessibleLoopNotificationIntents: vi.fn().mockResolvedValue([]),
    getReadNotificationIds: vi.fn().mockResolvedValue(new Set(["document:doc_1"])),
    markNotificationRead: vi.fn(),
    markLoopNotificationRead: vi.fn(),
    ...overrides,
  };
}

describe("desktop notification read model", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-27T12:00:00.000Z"));
  });

  afterEach(() => vi.useRealTimers());

  it("projects authorized sources to safe desktop routes and serialized dates", async () => {
    const result = await readDesktopNotifications(
      new Request("http://localhost/api/desktop/notifications?space=company:company_1"),
      dependencies() as never,
    );

    expect(result).toMatchObject({
      summary: { unreadCount: 2, todayCount: 3 },
      items: [
        {
          id: "task:task_1",
          kind: "task",
          occurredAt: null,
          target: {
            resourceType: "task",
            resourceId: "task_1",
            route: "/tasks/task_1",
          },
        },
        {
          id: "event:event_1",
          kind: "agent",
          occurredAt: "2026-07-27T09:00:00.000Z",
          target: {
            resourceType: "task",
            resourceId: "task_1",
            route: "/tasks/task_1",
          },
        },
        {
          id: "document:doc_1",
          kind: "document",
          occurredAt: "2026-07-27T08:00:00.000Z",
          isUnread: false,
          target: {
            resourceType: "document",
            resourceId: "doc_1",
            route: "/documents/doc_1",
          },
        },
      ],
    });
    expect(JSON.stringify(result)).not.toContain("/workflows/");
    expect(JSON.stringify(result)).not.toContain(context.space.id);
  });

  it("excludes command arguments from bounded desktop event descriptions", async () => {
    const secret = "sk-secret-command-argument";
    const result = await readDesktopNotifications(
      new Request("http://localhost/api/desktop/notifications?space=company:company_1"),
      dependencies({
        getWorkbenchOverview: vi.fn().mockResolvedValue({
          ...overview,
          timeline: {
            ...overview.timeline,
            events: [{
              ...overview.timeline.events[0],
              payload: {
                command: ["codex", "--token", secret],
                status: "completed",
                exitCode: 0,
                durationSeconds: 12,
              },
            }],
          },
        }),
      }) as never,
    );

    const event = result.items.find((item) => item.id === "event:event_1");
    expect(event?.description).toContain("状态：completed");
    expect(event?.description).toContain("退出码：0");
    expect(event?.description).toContain("耗时：12s");
    expect(event?.description).not.toContain(secret);
    expect(event?.description.length).toBeLessThanOrEqual(240);
  });

  it("loads notification sources and read state only within the selected company Space", async () => {
    const getWorkbenchOverview = vi.fn().mockResolvedValue(overview);
    const listAccessibleProjectDocuments = vi.fn().mockResolvedValue([document]);
    const getReadNotificationIds = vi.fn().mockResolvedValue(new Set<string>());
    const listAccessibleLoopNotificationIntents = vi.fn().mockResolvedValue([loopNotification]);

    await readDesktopNotifications(
      new Request("http://localhost/api/desktop/notifications?space=company:company_1"),
      dependencies({
        getWorkbenchOverview,
        listAccessibleProjectDocuments,
        listAccessibleLoopNotificationIntents,
        getReadNotificationIds,
      }) as never,
    );

    const selectedSpaceScope = {
      teamId: "team_1",
      userId: "user_1",
      ownerType: "company",
      companyId: "company_1",
    };
    expect(getWorkbenchOverview).toHaveBeenCalledWith(selectedSpaceScope);
    expect(listAccessibleProjectDocuments).toHaveBeenCalledWith({
      userId: "user_1",
      ownerType: "company",
      companyId: "company_1",
    });
    expect(getReadNotificationIds).toHaveBeenCalledWith({
      userId: "user_1",
      notificationIds: ["task:task_1", "event:event_1", "document:doc_1"],
    });
    expect(listAccessibleLoopNotificationIntents).toHaveBeenCalledWith({
      userId: "user_1",
      ownerType: "company",
      companyId: "company_1",
    });
  });

  it("marks an authorized Loop intent through its durable read state", async () => {
    const markNotificationRead = vi.fn();
    const markLoopNotificationRead = vi.fn().mockResolvedValue({
      ...loopNotification,
      readAt: new Date("2026-07-27T12:00:00.000Z"),
    });

    await expect(markDesktopNotificationRead(
      new Request("http://localhost/api/desktop/notifications/loop-notification%3Anotice_1/read?space=company:company_1"),
      loopNotification.id,
      { commandId: "desktop:notification:read:loop_1" },
      {
        resolveDesktopReadContext: vi.fn().mockResolvedValue(context),
        readDesktopNotifications: vi.fn().mockResolvedValue({
          summary: { unreadCount: 1, todayCount: 1 },
          items: [projectLoopNotification(loopNotification)],
        }),
        markNotificationRead,
        markLoopNotificationRead,
      } as never,
    )).resolves.toEqual({ notificationId: loopNotification.id, isUnread: false });
    expect(markLoopNotificationRead).toHaveBeenCalledWith({
      notificationId: loopNotification.id,
      recipientUserId: "user_1",
    });
    expect(markNotificationRead).not.toHaveBeenCalled();
  });

  it("marks an authorized notification read idempotently for the resolved user", async () => {
    const notification = {
      id: "event:event_1",
      kind: "agent" as const,
      title: "等待人工审批",
      description: "Build desktop notifications",
      occurredAt: "2026-07-27T09:00:00.000Z",
      timeLabel: "07/27 17:00",
      tone: "neutral" as const,
      isUnread: true,
      target: {
        resourceType: "task" as const,
        resourceId: "task_1",
        route: "/tasks/task_1" as const,
        label: "打开任务",
      },
    };
    const markNotificationRead = vi.fn().mockResolvedValue(undefined);
    const writeDependencies = {
      resolveDesktopReadContext: vi.fn().mockResolvedValue(context),
      readDesktopNotifications: vi.fn().mockResolvedValue({
        summary: { unreadCount: 1, todayCount: 1 },
        items: [notification],
      }),
      markNotificationRead,
    };
    const request = new Request(
      "http://localhost/api/desktop/notifications/event%3Aevent_1/read?space=company:company_1",
    );
    const input = { commandId: "desktop:notification:read:1" };

    const first = await markDesktopNotificationRead(
      request,
      "event:event_1",
      input,
      writeDependencies as never,
    );
    const second = await markDesktopNotificationRead(
      request,
      "event:event_1",
      input,
      writeDependencies as never,
    );

    expect(first).toEqual({ notificationId: "event:event_1", isUnread: false });
    expect(second).toEqual(first);
    expect(markNotificationRead).toHaveBeenCalledTimes(2);
    expect(markNotificationRead).toHaveBeenNthCalledWith(1, {
      userId: "user_1",
      notificationId: "event:event_1",
    });
    expect(markNotificationRead).toHaveBeenNthCalledWith(2, {
      userId: "user_1",
      notificationId: "event:event_1",
    });
  });

  it("rejects a notification outside the selected Space before writing read state", async () => {
    const markNotificationRead = vi.fn();

    await expect(markDesktopNotificationRead(
      new Request(
        "http://localhost/api/desktop/notifications/event%3Aother/read?space=company:company_1",
      ),
      "event:other",
      { commandId: "desktop:notification:read:other" },
      {
        resolveDesktopReadContext: vi.fn().mockResolvedValue(context),
        readDesktopNotifications: vi.fn().mockResolvedValue({
          summary: { unreadCount: 1, todayCount: 1 },
          items: [],
        }),
        markNotificationRead,
      } as never,
    )).rejects.toThrow("Notification not found");
    expect(markNotificationRead).not.toHaveBeenCalled();
  });

  it("projects an exhausted Run to a critical desktop deep link", () => {
    expect(projectLoopNotification(loopNotification)).toMatchObject({
      kind: "agent",
      tone: "danger",
      target: { resourceType: "loop_run", route: "/loop-runs/run_1" },
    });
  });
});
