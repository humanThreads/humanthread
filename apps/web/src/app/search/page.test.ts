import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { dynamic, SEARCH_PAGE_SECTION_TITLES } from "./page";
import { WORKBENCH_NAV_ITEMS } from "../components/workbench-nav";

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

vi.mock("../../lib/workbench/workbench-overview", () => ({
  getWorkbenchOverview: vi.fn().mockResolvedValue({
    currentTask: null,
    queueLength: 0,
    team: { id: "team_1", name: "Team" },
    members: [],
    devices: [],
    timeline: {
      workflow: null,
      events: [],
    },
  }),
}));

vi.mock("../../lib/workbench/workbench-projects", () => ({
  getWorkbenchProjects: vi.fn().mockResolvedValue([
    {
      id: "project_1",
      name: "Alpha 项目",
      description: "主项目",
      updatedAt: new Date("2026-05-22T00:00:00.000Z"),
      localPath: "/tmp/alpha",
      defaultCommand: "pnpm dev",
      activeWorkflowCount: 1,
    },
  ]),
}));

vi.mock("../../lib/workbench/workbench-search", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../lib/workbench/workbench-search")>();
  return {
    ...original,
    searchWorkbenchTasks: vi.fn().mockResolvedValue([
    {
      id: "task_1",
      projectId: "project_1",
      projectName: "Alpha 项目",
      title: "处理登录问题",
      status: "active",
      updatedAt: new Date("2026-05-22T00:00:00.000Z"),
      assigneeName: "张三",
      href: "/tasks/task_1",
    },
  ]),
  };
});

vi.mock("../../lib/workbench/workbench-documents", () => ({
  listAccessibleProjectDocuments: vi.fn().mockResolvedValue([
    {
      id: "doc_1",
      projectId: "project_1",
      projectName: "Alpha 项目",
      title: "接口说明",
      path: "docs/api.md",
      version: 2,
      updatedAt: new Date("2026-05-22T00:00:00.000Z"),
    },
  ]),
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

import SearchPage from "./page";

describe("Search page", () => {
  it("forces dynamic rendering", () => {
    expect(dynamic).toBe("force-dynamic");
  });

  it("keeps the section structure stable", () => {
    expect(SEARCH_PAGE_SECTION_TITLES).toEqual([
      "搜索结果",
      "项目",
      "文档",
      "任务",
      "成员",
    ]);
  });

  it("is exposed by the workbench shell header entry", () => {
    expect(
      WORKBENCH_NAV_ITEMS.find((item) => item.key === "documents"),
    ).toBeDefined();
  });

  it("renders search results from batched task and document queries", async () => {
    const markup = renderToStaticMarkup(await SearchPage());

    expect(markup).toContain("Alpha 项目");
    expect(markup).toContain("处理登录问题");
    expect(markup).toContain('href="/tasks/task_1"');
    expect(markup).not.toContain("主流程");
    expect(markup).toContain("接口说明");
  });
});
