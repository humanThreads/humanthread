import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { DesktopNotificationsResponse } from "@humanthread/workbench-client";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useLocation, MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useOptionalDesktopSession } from "../../session/session-provider";
import { NotificationPage } from "./notification-page";
import { useDesktopNotifications } from "./use-desktop-notifications";

const { openExternal } = vi.hoisted(() => ({ openExternal: vi.fn() }));

vi.mock("../../session/session-provider", () => ({
  useOptionalDesktopSession: vi.fn(),
}));
vi.mock("./use-desktop-notifications", () => ({
  useDesktopNotifications: vi.fn(),
}));

const openUrl = openExternal;

const response: DesktopNotificationsResponse = {
  ok: true,
  data: {
    summary: { unreadCount: 1, todayCount: 1 },
    items: [{
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
    }],
  },
};

function LocationProbe() {
  const location = useLocation();
  return <output aria-label="当前路由">{location.pathname}{location.search}</output>;
}

function renderPage(initialEntry = "/notifications") {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <NotificationPage />
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("desktop notification page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.humanthreadNative = {
      isNative: true,
      platform: "darwin",
      openExternal,
    } as never;
    vi.mocked(useDesktopNotifications).mockReturnValue({
      data: response,
      isPending: false,
      isError: false,
      isFetching: false,
    } as never);
  });

  it("marks an unread notification in the selected Space before navigating", async () => {
    const user = userEvent.setup();
    const request = vi.fn().mockResolvedValue({
      ok: true,
      result: { notificationId: "event:event_1", isUnread: false },
    });
    vi.mocked(useOptionalDesktopSession).mockReturnValue({
      status: "ready",
      actionsEnabled: true,
      client: { request },
      context: {
        deploymentKey: "https://ht.example.com",
        sessionId: "session_1",
        spaceKey: "company:company_1",
      },
    } as never);
    renderPage("/notifications?read=all&kind=all");

    await user.click(screen.getByRole("button", { name: "打开任务" }));

    await waitFor(() => expect(request).toHaveBeenCalledWith(
      "/api/desktop/notifications/event%3Aevent_1/read?space=company%3Acompany_1",
      expect.anything(),
      expect.objectContaining({ method: "POST" }),
    ));
    await waitFor(() => expect(screen.getByLabelText("当前路由"))
      .toHaveTextContent("/tasks/task_1"));
  });

  it("keeps the notification open when marking fails", async () => {
    const user = userEvent.setup();
    const request = vi.fn().mockRejectedValue(new Error("网络不可用"));
    vi.mocked(useOptionalDesktopSession).mockReturnValue({
      status: "ready",
      actionsEnabled: true,
      client: { request },
      context: {
        deploymentKey: "https://ht.example.com",
        sessionId: "session_1",
        spaceKey: "personal",
      },
    } as never);
    renderPage();

    await user.click(screen.getByRole("button", { name: "打开任务" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("网络不可用");
    expect(screen.getByLabelText("当前路由")).toHaveTextContent("/notifications");
  });

  it("keeps cached notifications visible and disables writes after a refetch failure", () => {
    vi.mocked(useDesktopNotifications).mockReturnValue({
      data: response,
      error: new Error("网络不可用"),
      isPending: false,
      isError: true,
      isFetching: false,
    } as never);
    vi.mocked(useOptionalDesktopSession).mockReturnValue({
      status: "ready",
      actionsEnabled: true,
      client: { request: vi.fn() },
      context: {
        deploymentKey: "https://ht.example.com",
        sessionId: "session_1",
        spaceKey: "personal",
      },
    } as never);

    renderPage("/notifications?item=event%3Aevent_1&read=all&kind=all");

    expect(screen.getByText("显示缓存通知")).toHaveAttribute("role", "status");
    expect(screen.getByRole("heading", { name: "等待人工审批" })).toBeVisible();
    expect(screen.getByRole("button", { name: "打开任务" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "不标记，直接打开" })).toBeEnabled();
  });

  it("clears an item from a previous Space when current data no longer contains it", async () => {
    vi.mocked(useDesktopNotifications).mockReturnValue({
      data: {
        ok: true,
        data: {
          summary: { unreadCount: 0, todayCount: 1 },
          items: [{
            id: "document:doc_1",
            kind: "document",
            title: "文档已更新",
            description: "新的 Space 通知",
            occurredAt: "2026-07-27T10:00:00.000Z",
            timeLabel: "07/27 18:00",
            tone: "info",
            isUnread: false,
            target: {
              resourceType: "document",
              resourceId: "doc_1",
              route: "/documents/doc_1",
              label: "打开文档",
            },
          }],
        },
      },
      isPending: false,
      isError: false,
      isFetching: false,
    } as never);
    vi.mocked(useOptionalDesktopSession).mockReturnValue({
      status: "ready",
      actionsEnabled: true,
      client: { request: vi.fn() },
      context: {
        deploymentKey: "https://ht.example.com",
        sessionId: "session_2",
        spaceKey: "company:company_2",
      },
    } as never);

    renderPage("/notifications?item=event%3Aevent_1&read=all&kind=all");

    await waitFor(() => expect(screen.getByLabelText("当前路由"))
      .toHaveTextContent("/notifications?read=all&kind=all"));
  });

  it("marks a Loop notification read before opening the authorized Web Run", async () => {
    const user = userEvent.setup();
    const loopResponse: DesktopNotificationsResponse = {
      ok: true,
      data: {
        summary: { unreadCount: 1, todayCount: 1 },
        items: [{
          id: "loop-notification:notice_1",
          kind: "agent",
          title: "Loop 重试预算已耗尽",
          description: "质量门禁已达到最大返工次数",
          occurredAt: "2026-07-31T08:00:00.000Z",
          timeLabel: "07/31 16:00",
          tone: "danger",
          isUnread: true,
          target: {
            resourceType: "loop_run",
            resourceId: "run_1",
            route: "/loop-runs/run_1",
            label: "打开运行图",
          },
        }],
      },
    };
    const request = vi.fn().mockResolvedValue({
      ok: true,
      result: { notificationId: "loop-notification:notice_1", isUnread: false },
    });
    vi.mocked(useDesktopNotifications).mockReturnValue({
      data: loopResponse,
      isPending: false,
      isError: false,
      isFetching: false,
    } as never);
    vi.mocked(useOptionalDesktopSession).mockReturnValue({
      status: "ready",
      actionsEnabled: true,
      client: { request },
      context: {
        deploymentKey: "https://ht.example.com",
        sessionId: "session_1",
        spaceKey: "company:company_1",
      },
    } as never);
    renderPage();

    await user.click(screen.getByRole("button", { name: "打开运行图" }));

    await waitFor(() => expect(request).toHaveBeenCalledOnce());
    await waitFor(() => expect(openUrl).toHaveBeenCalledWith("https://ht.example.com/loop-runs/run_1"));
    expect(screen.getByLabelText("当前路由")).toHaveTextContent("/notifications");
  });

  it("keeps a recoverable error when the authorized Web Run cannot be opened", async () => {
    const user = userEvent.setup();
    const loopResponse: DesktopNotificationsResponse = {
      ok: true,
      data: {
        summary: { unreadCount: 1, todayCount: 1 },
        items: [{
          id: "loop-notification:notice_1",
          kind: "agent",
          title: "Loop 重试预算已耗尽",
          description: "质量门禁已达到最大返工次数",
          occurredAt: "2026-07-31T08:00:00.000Z",
          timeLabel: "07/31 16:00",
          tone: "danger",
          isUnread: true,
          target: {
            resourceType: "loop_run",
            resourceId: "run_1",
            route: "/loop-runs/run_1",
            label: "打开运行图",
          },
        }],
      },
    };
    vi.mocked(useDesktopNotifications).mockReturnValue({
      data: loopResponse,
      isPending: false,
      isError: false,
      isFetching: false,
    } as never);
    vi.mocked(useOptionalDesktopSession).mockReturnValue({
      status: "ready",
      actionsEnabled: true,
      client: { request: vi.fn().mockResolvedValue({ ok: true }) },
      context: {
        deploymentKey: "https://ht.example.com",
        sessionId: "session_1",
        spaceKey: "company:company_1",
      },
    } as never);
    openUrl.mockRejectedValueOnce(new Error("系统浏览器不可用"));
    renderPage();

    await user.click(screen.getByRole("button", { name: "打开运行图" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("系统浏览器不可用");
    expect(screen.getByLabelText("当前路由")).toHaveTextContent("/notifications");
    expect(screen.getByRole("button", { name: "重试标记" })).toBeEnabled();
  });
});
