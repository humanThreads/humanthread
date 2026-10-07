import { describe, expect, it, vi } from "vitest";

import {
  buildNativeNotification,
  deliverUnreadLoopNotifications,
  createNativeNotificationDispatcher,
  createInvokeNotificationDispatcher,
  routeNativeNotificationAction,
} from "./notifications";

describe("native desktop notifications", () => {
  it("delivers only unread Loop feed items through the native dispatcher", async () => {
    const deliver = vi.fn(async () => "native" as const);
    const response = {
      ok: true as const,
      data: {
        summary: { unreadCount: 2, todayCount: 3 },
        items: [
          {
            id: "loop-notification:notice_1",
            kind: "agent" as const,
            title: "Loop 需要本地执行配置",
            description: "本地 Agent 当前离线，请启动客户端并保持连接。",
            occurredAt: "2026-08-01T07:04:13.838Z",
            timeLabel: "15:04",
            tone: "warning" as const,
            isUnread: true,
            target: {
              resourceType: "loop_run" as const,
              resourceId: "loop_run:1",
              route: "/loop-runs/loop_run%3A1",
              label: "打开运行图",
            },
          },
          {
            id: "loop-notification:notice_2",
            kind: "agent" as const,
            title: "已读 Loop 通知",
            description: "不应再次投递",
            occurredAt: "2026-08-01T07:00:00.000Z",
            timeLabel: "15:00",
            tone: "info" as const,
            isUnread: false,
            target: {
              resourceType: "loop_run" as const,
              resourceId: "loop_run:2",
              route: "/loop-runs/loop_run%3A2",
              label: "打开运行图",
            },
          },
          {
            id: "event:event_1",
            kind: "agent" as const,
            title: "普通事件",
            description: "由其他通知机制处理",
            occurredAt: "2026-08-01T06:00:00.000Z",
            timeLabel: "14:00",
            tone: "warning" as const,
            isUnread: true,
            target: {
              resourceType: "task" as const,
              resourceId: "task_1",
              route: "/tasks/task_1",
              label: "打开任务",
            },
          },
        ],
      },
    };

    await deliverUnreadLoopNotifications(response, { deliver });

    expect(deliver).toHaveBeenCalledOnce();
    expect(deliver).toHaveBeenCalledWith({
      id: "loop-notification:notice_1",
      kind: "approval",
      title: "Loop 需要本地执行配置",
      body: "本地 Agent 当前离线，请启动客户端并保持连接。",
      route: "/notifications?item=loop-notification%3Anotice_1&read=all&kind=all",
    });
  });

  it("projects fixed event kinds without exposing commands or file paths", () => {
    const notification = buildNativeNotification({
      id: "command_1",
      kind: "command_failed",
      taskId: "task_1",
      taskTitle: "Production verification",
      filePath: "/Users/alice/private/token.txt",
      command: "deploy --token super-secret",
      exitCode: 1,
    });

    expect(notification).toEqual({
      id: "command_1",
      kind: "command_failed",
      title: "本地命令执行失败",
      body: "Production verification · 退出码 1",
      route: "/tasks/task_1",
    });
    expect(JSON.stringify(notification)).not.toMatch(/alice|token|deploy|super-secret/u);
  });

  it("deduplicates delivery and falls back in-app after notification permission is denied", async () => {
    const send = vi.fn(async () => {});
    const fallback = vi.fn();
    const dispatcher = createNativeNotificationDispatcher({
      isPermissionGranted: vi.fn(async () => false),
      requestPermission: vi.fn(async () => "denied" as const),
      send,
      fallback,
    });
    const notification = buildNativeNotification({
      id: "assignment_1",
      kind: "assignment",
      taskId: "task_1",
      taskTitle: "Investigate billing failure",
    });

    await dispatcher.deliver(notification);
    await dispatcher.deliver(notification);

    expect(send).not.toHaveBeenCalled();
    expect(fallback).toHaveBeenCalledTimes(1);
    expect(fallback).toHaveBeenCalledWith(notification);
  });

  it("does not repeatedly request permission after the user denies it", async () => {
    const requestPermission = vi.fn(async () => "denied" as const);
    const fallback = vi.fn();
    const dispatcher = createNativeNotificationDispatcher({
      isPermissionGranted: vi.fn(async () => false),
      requestPermission,
      send: vi.fn(async () => {}),
      fallback,
    });

    await dispatcher.deliver(buildNativeNotification({
      id: "assignment_1",
      kind: "assignment",
      taskId: "task_1",
      taskTitle: "First task",
    }));
    await dispatcher.deliver(buildNativeNotification({
      id: "assignment_2",
      kind: "assignment",
      taskId: "task_2",
      taskTitle: "Second task",
    }));

    expect(requestPermission).toHaveBeenCalledTimes(1);
    expect(fallback).toHaveBeenCalledTimes(2);
  });

  it("composes official permission checks with the validated native command", async () => {
    const invoke = vi.fn(async () => undefined);
    const fallback = vi.fn();
    const dispatcher = createInvokeNotificationDispatcher({
      fallback,
      invoke,
      isPermissionGranted: vi.fn(async () => true),
      requestPermission: vi.fn(async () => "granted" as const),
    });
    const notification = buildNativeNotification({
      id: "command_2",
      kind: "command_completed",
      taskId: "task_2",
      taskTitle: "Build desktop package",
    });

    await expect(dispatcher.deliver(notification)).resolves.toBe("native");
    expect(invoke).toHaveBeenCalledWith("send_native_notification", {
      body: "Build desktop package",
      id: "command_2",
      kind: "command_completed",
      route: "/tasks/task_2",
      title: "本地命令执行完成",
    });
    expect(fallback).not.toHaveBeenCalled();
  });

  it("routes only validated notification action targets", () => {
    const navigate = vi.fn();

    routeNativeNotificationAction("/tasks/task_1", navigate);
    routeNativeNotificationAction("https://evil.example/tasks/task_1", navigate);
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith("/tasks/task_1");
  });
});
