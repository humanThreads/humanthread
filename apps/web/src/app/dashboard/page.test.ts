import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { getWorkbenchDashboardData } from "../../lib/workbench/workbench-dashboard";
import { getWorkbenchNotificationSummary } from "../../lib/workbench/workbench-notification-summary";
import DashboardPage, { DASHBOARD_PRIMARY_SECTION_ORDER } from "./page";

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
    currentTask: null,
    allTasks: [],
    activeFilter: "all",
    activeView: "time",
    selectedTaskId: null,
    actionSignals: [{ key: "assigned", label: "待我处理", count: 1, description: "需要确认、推进或重新安排的事项。" }, { key: "blocked", label: "已阻塞", count: 0, description: "等待人工解除或补充关键上下文。" }],
    inboxGroups: [],
    detail: null,
    team: { id: "team_1", name: "Team" },
    members: [],
    devices: [],
    quickCreateProjects: [],
  }),
}));

vi.mock("../../lib/workbench/workbench-projects", () => ({ getProjectListItems: vi.fn().mockResolvedValue([]) }));
vi.mock("../../lib/orchestration/agent-read-model", () => ({ getAgentControlPlane: vi.fn().mockResolvedValue({ approvals: [], loops: [], runs: [] }) }));
vi.mock("../../lib/workbench/workbench-delivery-health-report", () => ({ countAccessibleTasksAwaitingAcceptance: vi.fn().mockResolvedValue(0) }));

vi.mock("../../lib/workbench/workbench-notification-summary", () => ({
  getWorkbenchNotificationSummary: vi.fn().mockResolvedValue({
    unreadCount: 4,
    todayCount: 4,
  }),
  summarizeWorkbenchNotifications: vi.fn().mockReturnValue({
    unreadCount: 4,
    todayCount: 4,
  }),
}));

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

describe("Dashboard page", () => {
  it("keeps lifecycle queue and secondary summary in primary order", () => {
    expect(DASHBOARD_PRIMARY_SECTION_ORDER).toEqual([
      "queue", "running", "confirmation", "secondary",
    ]);
  });

  it("exports the dashboard route component", () => {
    expect(typeof DashboardPage).toBe("function");
  });

  it("passes the real unread count into the shell notification badge", async () => {
    const markup = renderToStaticMarkup(await DashboardPage({}));

    expect(markup).toContain('data-notification-count="4"');
  });

  it("drills action signals into blocked tasks and the approval inbox", async () => {
    const markup = renderToStaticMarkup(await DashboardPage({}));

    expect(markup).toContain("/tasks?spaceKey=all&amp;relation=blocked");
    expect(markup).toContain("/agents?space=all#approvals");
  });

  it("does not re-query notification summary on the dashboard route", async () => {
    await DashboardPage({});

    expect(getWorkbenchNotificationSummary).not.toHaveBeenCalled();
  });

  it("passes filter, view, and selected task params into the dashboard data query", async () => {
    await DashboardPage({
      searchParams: Promise.resolve({
        filter: "blocked",
        view: "risk",
        taskId: "task_blocked",
      }),
    });

    expect(getWorkbenchDashboardData).toHaveBeenCalledWith({
      teamId: "team_1",
      userId: "user_owner",
      filterKey: "blocked",
      viewKey: "risk",
      selectedTaskId: "task_blocked",
    });
  });
});
