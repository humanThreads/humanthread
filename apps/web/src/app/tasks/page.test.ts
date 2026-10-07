import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getTaskDetailView: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("../../lib/tasks/task-rollout", () => ({ getUserTaskRollout: () => ({ reads: true }) }));
vi.mock("../../lib/workbench/workbench-route-auth", () => ({
  requireWorkbenchSession: vi.fn().mockResolvedValue({
    session: { context: { userId: "user_owner" }, loginEmail: "owner@example.com", account: { name: "Owner" } },
    cookieStore: { get: vi.fn() },
  }),
}));
vi.mock("../../lib/workbench/workbench-companies", () => ({
  getWorkbenchCompanyFilters: vi.fn().mockResolvedValue([{ key: "personal", label: "个人空间", ownerType: "personal", role: "owner", spaceId: "space_1", companyId: null }]),
}));
vi.mock("../../lib/workbench/workbench-space-filters", () => ({
  WORKBENCH_SPACE_COOKIE: "workbench-space",
  getSingleWorkbenchSearchParam: (raw: Record<string, string | string[] | undefined>, key: string) => raw[key],
  getWorkbenchSelectedSpaceFilter: ({ filters }: { filters: Array<unknown> }) => filters[0],
}));
vi.mock("../../lib/tasks/task-read-model", () => ({
  getTaskCollection: vi.fn().mockResolvedValue({ listRows: [], boardGroups: [], calendar: { entries: [], unscheduled: [] }, relationCounts: {}, total: 0 }),
  listTaskSavedViews: vi.fn().mockResolvedValue([]),
  getTaskDetailView: mocks.getTaskDetailView,
}));
vi.mock("../../lib/tasks/task-settings", () => ({
  listTaskLabelDefinitions: vi.fn().mockResolvedValue([]),
  listTaskStatusDefinitions: vi.fn().mockResolvedValue([]),
}));
vi.mock("../../lib/workbench/workbench-avatar", () => ({ getWorkbenchShellLoginProps: () => ({}) }));
vi.mock("../../lib/workbench/workbench-projects", () => ({ getWorkbenchProjects: vi.fn().mockResolvedValue([]) }));
vi.mock("../../lib/workbench/workbench-settings", () => ({ getWorkbenchCompanyMembers: vi.fn().mockResolvedValue({ company: null, members: [] }) }));
vi.mock("../../lib/orchestration/agent-read-model", () => ({ listTaskAgentProfiles: vi.fn().mockResolvedValue([]) }));
vi.mock("../components/workbench-shell", () => ({
  WorkbenchShell: ({ children }: { children: ReactNode }) => createElement("main", null, children),
}));
vi.mock("../components/tasks/task-center", () => ({
  TaskCenter: ({ queryString, selectedDetail }: { queryString: string; selectedDetail: { task: { id: string } } | null }) => createElement("div", {
    "data-query-string": queryString,
    "data-selected-task-id": selectedDetail?.task.id ?? "",
  }),
}));
import {
  dynamic,
  TASK_CENTER_SAVED_VIEW_LABELS,
  TASK_CENTER_SECTION_TITLES,
  TASK_CENTER_SUMMARY_TITLES,
  TASK_CENTER_TABLE_COLUMNS,
  default as TaskCenterPage,
} from "./page";
import { WORKBENCH_NAV_ITEMS } from "../components/workbench-nav";
import { readFile } from "node:fs/promises";

beforeEach(() => {
  mocks.getTaskDetailView.mockReset();
  mocks.getTaskDetailView.mockResolvedValue({ task: { id: "task_a", space: { id: "space_1" } }, capabilities: {} });
});

describe("Task center page", () => {
  it("forces dynamic rendering", () => {
    expect(dynamic).toBe("force-dynamic");
  });

  it("is registered in the workbench navigation", () => {
    expect(
      WORKBENCH_NAV_ITEMS.find((item) => item.key === "tasks"),
    ).toMatchObject({
      href: "/tasks",
      label: "任务中心",
      key: "tasks",
    });
  });

  it("keeps task center sections focused on execution work", () => {
    expect(TASK_CENTER_SECTION_TITLES).toEqual([
      "关系视图",
      "筛选与排序",
      "任务列表",
      "批量操作",
      "保存视图",
      "空间设置",
    ]);
  });

  it("keeps distinct task-center summaries and saved views", () => {
    expect(TASK_CENTER_SUMMARY_TITLES).toEqual([
      "分配给我",
      "我创建的",
      "我参与的",
      "我关注的",
    ]);
    expect(TASK_CENTER_SAVED_VIEW_LABELS).toEqual([
      "我的待办",
      "本周到期",
      "待验收",
      "已阻塞",
      "已完成",
    ]);
  });

  it("keeps the compact task-center list schema stable", () => {
    expect(TASK_CENTER_TABLE_COLUMNS).toEqual([
      "任务",
      "状态",
      "负责人",
      "优先级",
      "截止时间",
      "项目",
      "子任务",
    ]);
  });

  it("renders the user Task workspace without the legacy Task Center page header", async () => {
    const source = await readFile(new URL("./page.tsx", import.meta.url), "utf8");
    expect(source).toContain('contentMode="workspace"');
    expect(source).toContain("<TaskCenter");
    expect(source).not.toContain("<PageHeader");
    expect(source).not.toContain("CurrentTaskConsole");
    expect(source).not.toContain("displayQueueLabel");
    expect(source).toContain("getUserTaskRollout().reads");
    expect(source).toContain('redirect("/dashboard")');
  });

  it("uses taskId as the detail read identity and forwards the original query string", async () => {
    const markup = renderToStaticMarkup(await TaskCenterPage({
      searchParams: Promise.resolve({ spaceKey: "personal", relation: "assigned", taskId: "task_a", status: ["todo", "in_progress"] }),
    }));

    expect(mocks.getTaskDetailView).toHaveBeenCalledWith({ userId: "user_owner", taskId: "task_a", includeArchived: false });
    expect(markup).toContain('data-selected-task-id="task_a"');
    expect(markup).toContain('data-query-string="spaceKey=personal&amp;relation=assigned&amp;taskId=task_a&amp;status=todo&amp;status=in_progress"');
  });

  it("reads archived details when the archived relation is active", async () => {
    renderToStaticMarkup(await TaskCenterPage({
      searchParams: Promise.resolve({ spaceKey: "personal", relation: "archived", taskId: "task_archived" }),
    }));

    expect(mocks.getTaskDetailView).toHaveBeenCalledWith({ userId: "user_owner", taskId: "task_archived", includeArchived: true });
  });

  it("does not read task detail when taskId is absent", async () => {
    const markup = renderToStaticMarkup(await TaskCenterPage({
      searchParams: Promise.resolve({ spaceKey: "personal", relation: "assigned" }),
    }));

    expect(mocks.getTaskDetailView).not.toHaveBeenCalled();
    expect(markup).toContain('data-selected-task-id=""');
  });
});
