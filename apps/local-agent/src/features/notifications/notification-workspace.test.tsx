import type { DesktopNotificationsResponse } from "@humanthread/workbench-client";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import {
  filterNotifications,
  type NotificationQuery,
} from "./notification-queries";
import { NotificationWorkspace } from "./notification-workspace";

const data: DesktopNotificationsResponse["data"] = {
  summary: { unreadCount: 2, todayCount: 3 },
  items: [
    {
      id: "event:event_1",
      kind: "agent",
      title: "等待人工审批",
      description: "桌面通知中心需要确认",
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
      description: "完善桌面客户端",
      occurredAt: null,
      timeLabel: "当前",
      tone: "neutral",
      isUnread: false,
      target: {
        resourceType: "task",
        resourceId: "task_2",
        route: "/tasks/task_2",
        label: "打开任务",
      },
    },
    {
      id: "document:doc_1",
      kind: "document",
      title: "文档已更新",
      description: "桌面通知设计说明",
      occurredAt: "2026-07-27T08:00:00.000Z",
      timeLabel: "07/27 16:00",
      tone: "info",
      isUnread: true,
      target: {
        resourceType: "document",
        resourceId: "doc_1",
        route: "/documents/doc_1",
        label: "打开文档",
      },
    },
  ],
};

function WorkspaceHarness(props: {
  initialQuery?: NotificationQuery;
  source?: DesktopNotificationsResponse["data"];
  stale?: boolean;
  writeEnabled?: boolean;
  actionError?: string | null;
  onMarkRead?: (notificationId: string, openAfter: boolean) => void;
  onOpen?: (route: string) => void;
}) {
  const [query, setQuery] = useState<NotificationQuery>(props.initialQuery ?? {
    itemId: "event:event_1",
    read: "all",
    kind: "all",
  });
  const source = props.source ?? data;
  const visible = filterNotifications(source.items, query);
  const selected = visible.find((item) => item.id === query.itemId) ?? visible[0] ?? null;

  return (
    <NotificationWorkspace
      actionError={props.actionError ?? null}
      busyId={null}
      data={source}
      onMarkRead={props.onMarkRead ?? (() => undefined)}
      onOpen={props.onOpen ?? (() => undefined)}
      onQueryChange={setQuery}
      query={query}
      selected={selected}
      syncState={props.stale ? "syncing" : null}
      writeEnabled={props.writeEnabled ?? true}
    />
  );
}

describe("desktop notification workspace", () => {
  it("renders the inbox and changes detail selection without opening a target", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    render(<WorkspaceHarness onOpen={onOpen} />);

    expect(screen.getByRole("button", { name: "全部 3" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "未读 2" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: /等待人工审批/u }))
      .toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("heading", { name: "等待人工审批" })).toBeVisible();
    expect(screen.getByRole("button", { name: "打开任务" })).toBeEnabled();

    await user.click(screen.getByRole("button", { name: /文档已更新/u }));

    expect(screen.getByRole("heading", { name: "文档已更新" })).toBeVisible();
    expect(screen.getByRole("button", { name: "打开文档" })).toBeEnabled();
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("combines unread and kind filters while keeping the summary visible", async () => {
    const user = userEvent.setup();
    render(<WorkspaceHarness />);

    await user.click(screen.getByRole("button", { name: "未读 2" }));
    await user.selectOptions(screen.getByRole("combobox", { name: "通知类型" }), "document");

    expect(screen.getByRole("button", { name: /文档已更新/u })).toBeVisible();
    expect(screen.queryByRole("button", { name: /等待人工审批/u })).not.toBeInTheDocument();
    expect(screen.getByLabelText("通知摘要")).toBeVisible();
  });

  it("shows a filtered empty state without hiding the summary", () => {
    render(<WorkspaceHarness initialQuery={{ read: "all", kind: "system" }} />);

    expect(screen.getByText("当前筛选下没有通知")).toBeVisible();
    expect(screen.getByLabelText("通知摘要")).toHaveTextContent("2");
  });

  it("marks an unread notification before opening or without opening", async () => {
    const user = userEvent.setup();
    const onMarkRead = vi.fn();
    render(<WorkspaceHarness onMarkRead={onMarkRead} />);

    await user.click(screen.getByRole("button", { name: "打开任务" }));
    expect(onMarkRead).toHaveBeenLastCalledWith("event:event_1", true);

    await user.click(screen.getByRole("button", { name: "标记已读" }));
    expect(onMarkRead).toHaveBeenLastCalledWith("event:event_1", false);
  });

  it("opens an already-read target directly", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    render(<WorkspaceHarness
      initialQuery={{ itemId: "task:task_2", read: "all", kind: "all" }}
      onOpen={onOpen}
    />);

    await user.click(screen.getByRole("button", { name: "打开任务" }));

    expect(onOpen).toHaveBeenCalledWith("/tasks/task_2");
  });

  it("offers retry and direct-open recovery after a mutation failure", () => {
    render(<WorkspaceHarness actionError="标记失败，请检查网络连接" />);

    expect(screen.getByRole("alert")).toHaveTextContent("标记失败");
    expect(screen.getByRole("button", { name: "重试标记" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "不标记，直接打开" })).toBeEnabled();
  });

  it("keeps direct navigation available while stale or read-only", () => {
    render(<WorkspaceHarness stale writeEnabled={false} />);

    expect(screen.getByText("正在同步最新通知")).toHaveAttribute("role", "status");
    expect(screen.getByRole("button", { name: "打开任务" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "不标记，直接打开" })).toBeEnabled();
  });
});
