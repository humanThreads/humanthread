import {
  createWorkbenchContextIdentity,
  type DesktopNotificationItem,
} from "@humanthread/workbench-client";
import { describe, expect, it } from "vitest";

import {
  buildNotificationSearch,
  createNotificationCommandMetadata,
  filterNotifications,
  notificationQueryKey,
  parseNotificationQuery,
} from "./notification-queries";

const items: DesktopNotificationItem[] = [
  {
    id: "event:event_1",
    kind: "agent",
    title: "等待人工审批",
    description: "任务一",
    occurredAt: "2026-07-27T09:00:00.000Z",
    timeLabel: "07/27 17:00",
    tone: "warning",
    isUnread: true,
    target: {
      resourceType: "task",
      resourceId: "task_1",
      route: "/tasks/task_1",
      label: "打开任务",
    },
  },
  {
    id: "task:task_2",
    kind: "task",
    title: "当前任务",
    description: "任务二",
    occurredAt: null,
    timeLabel: "当前",
    tone: "neutral",
    isUnread: true,
    target: {
      resourceType: "task",
      resourceId: "task_2",
      route: "/tasks/task_2",
      label: "打开任务",
    },
  },
  {
    id: "event:event_3",
    kind: "agent",
    title: "执行完成",
    description: "任务三",
    occurredAt: "2026-07-27T08:00:00.000Z",
    timeLabel: "07/27 16:00",
    tone: "success",
    isUnread: false,
    target: {
      resourceType: "task",
      resourceId: "task_3",
      route: "/tasks/task_3",
      label: "打开任务",
    },
  },
];

describe("desktop notification queries", () => {
  it("normalizes URL selection and filters", () => {
    expect(parseNotificationQuery(new URLSearchParams(
      "item=event%3Aevent_1&read=unread&kind=agent",
    ))).toEqual({ itemId: "event:event_1", read: "unread", kind: "agent" });

    expect(parseNotificationQuery(new URLSearchParams(
      "read=invalid&kind=unknown",
    ))).toEqual({ read: "all", kind: "all" });

    expect(buildNotificationSearch({
      itemId: "event:event_1",
      read: "unread",
      kind: "agent",
    }).toString()).toBe("item=event%3Aevent_1&read=unread&kind=agent");
  });

  it("applies read and kind filters together without changing source order", () => {
    expect(filterNotifications(items, { read: "unread", kind: "agent" })
      .map((item) => item.id)).toEqual(["event:event_1"]);
    expect(filterNotifications(items, { read: "all", kind: "agent" })
      .map((item) => item.id)).toEqual(["event:event_1", "event:event_3"]);
    expect(filterNotifications(items, { read: "unread", kind: "all" })
      .map((item) => item.id)).toEqual(["event:event_1", "task:task_2"]);
  });

  it("isolates notification caches by context and creates bounded command IDs", () => {
    const personal = createWorkbenchContextIdentity({
      deploymentUrl: "https://ht.example.com",
      sessionId: "session_1",
      spaceKey: "personal",
    });
    const company = createWorkbenchContextIdentity({
      deploymentUrl: "https://ht.example.com",
      sessionId: "session_1",
      spaceKey: "company:company_1",
    });

    expect(notificationQueryKey(personal)).not.toEqual(notificationQueryKey(company));
    expect(notificationQueryKey(company).slice(0, 4)).toEqual([
      "https://ht.example.com",
      "session_1",
      "company:company_1",
      "notifications",
    ]);
    expect(createNotificationCommandMetadata().commandId)
      .toMatch(/^desktop:notification:read:/u);
  });
});
