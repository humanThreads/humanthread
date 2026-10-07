// @vitest-environment jsdom

import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ProjectScheduledTaskListItem } from "../../../lib/orchestration/scheduled-task-read-model";
import { ProjectScheduledTaskList } from "./project-scheduled-task-list";

const navigation = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
  pathname: "/projects/project_1/scheduled-tasks",
  searchParams: new URLSearchParams(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => navigation,
  usePathname: () => navigation.pathname,
  useSearchParams: () => navigation.searchParams,
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  navigation.searchParams = new URLSearchParams();
});

function task(
  id: string,
  status: ProjectScheduledTaskListItem["status"],
  overrides: Partial<ProjectScheduledTaskListItem> = {},
): ProjectScheduledTaskListItem {
  return {
    id,
    name: `任务 ${id}`,
    description: "项目巡检",
    status,
    version: 1,
    cronExpression: "0 9 * * *",
    timezone: "Asia/Shanghai",
    contentMode: "platform",
    contentMarkdown: "检查项目状态",
    loopBinding: { id: "loop_1", name: "每日巡检", scope: "project", versionNumber: 2 },
    executionTarget: { type: "local_agent", id: "agent_1", displayName: "本地 Agent · Codex", provider: "codex" },
    nextRunAt: "2026-09-23T01:00:00.000Z",
    pendingScheduledFor: null,
    lastScheduledFor: null,
    updatedAt: "2026-09-22T01:00:00.000Z",
    activeRun: null,
    latestRun: null,
    ...overrides,
  };
}

const baseProps = {
  projectId: "project_1",
  status: "all" as const,
  loopOptions: [],
  targetOptions: [],
  canEdit: true,
};

describe("ProjectScheduledTaskList", () => {
  it("keeps project and status filters in URL navigation", async () => {
    const user = userEvent.setup();
    render(<ProjectScheduledTaskList {...baseProps} tasks={[]} />);

    await user.click(screen.getByRole("button", { name: "启用" }));
    await user.click(screen.getByRole("button", { name: "禁用" }));

    expect(navigation.push).toHaveBeenNthCalledWith(
      1,
      "/projects/project_1/scheduled-tasks?project=project_1&status=enabled",
    );
    expect(navigation.push).toHaveBeenNthCalledWith(
      2,
      "/projects/project_1/scheduled-tasks?project=project_1&status=disabled",
    );
  });

  it("preserves additional query parameters when changing status", async () => {
    const user = userEvent.setup();
    navigation.searchParams = new URLSearchParams("spaceKey=space_1&project=old_project&status=all");
    render(<ProjectScheduledTaskList {...baseProps} tasks={[]} />);

    await user.click(screen.getByRole("button", { name: "启用" }));

    expect(navigation.push).toHaveBeenCalledWith(
      "/projects/project_1/scheduled-tasks?spaceKey=space_1&project=project_1&status=enabled",
    );
  });

  it("applies the manual execution button matrix", () => {
    render(
      <ProjectScheduledTaskList
        {...baseProps}
        tasks={[
          task("inactive", "inactive"),
          task("enabled", "enabled"),
          task("disabled", "disabled"),
          task("active", "enabled", { activeRun: { id: "run_1", status: "running" } }),
        ]}
      />,
    );

    const inactiveButton = within(screen.getByTestId("scheduled-task-inactive")).getByRole("button", { name: "手动执行" }) as HTMLButtonElement;
    const enabledButton = within(screen.getByTestId("scheduled-task-enabled")).getByRole("button", { name: "手动执行" }) as HTMLButtonElement;
    const disabledButton = within(screen.getByTestId("scheduled-task-disabled")).getByRole("button", { name: "手动执行" }) as HTMLButtonElement;
    const activeButton = within(screen.getByTestId("scheduled-task-active")).getByRole("button", { name: "手动执行" }) as HTMLButtonElement;

    expect(inactiveButton.disabled).toBe(false);
    expect(enabledButton.disabled).toBe(false);
    expect(disabledButton.disabled).toBe(true);
    expect(disabledButton.getAttribute("title")).toBe("禁用状态下不可手动执行");
    expect(activeButton.disabled).toBe(true);
    expect(activeButton.getAttribute("title")).toBe("已有运行未结束");
    expect(within(screen.getByTestId("scheduled-task-active")).getByText("已有运行未结束")).toBeTruthy();
  });

  it("hides mutation controls when the read model does not grant edit permission", () => {
    render(<ProjectScheduledTaskList {...baseProps} canEdit={false} tasks={[task("inactive", "inactive")]} />);

    expect(screen.queryByRole("button", { name: "手动执行" })).toBeNull();
    expect(screen.queryByRole("button", { name: "编辑" })).toBeNull();
    expect(screen.queryByRole("button", { name: "新建定时任务" })).toBeNull();
  });

  it("links every task to its run logs and report detail", () => {
    render(<ProjectScheduledTaskList {...baseProps} tasks={[task("task_1", "enabled")]} />);

    const link = screen.getByRole("link", { name: /查看任务 task_1.*运行日志与任务报告/u });
    expect(link.getAttribute("href")).toBe("/projects/project_1/scheduled-tasks/task_1?tab=logs");
    expect(link.textContent).toContain("运行日志与报告");
  });

  it("shows the latest run regardless of terminal status with timing and report entry", () => {
    render(
      <ProjectScheduledTaskList
        {...baseProps}
        tasks={[task("latest", "enabled", {
          latestRun: {
            id: "run_latest",
            status: "succeeded",
            triggeredAt: "2026-09-22T01:00:00.000Z",
            startedAt: "2026-09-22T01:00:01.000Z",
            finishedAt: "2026-09-22T01:01:31.000Z",
            durationMs: 90_000,
            targetType: "linux_worker_pool",
            reportEntry: { label: "任务报告", href: "/projects/project_1/scheduled-tasks/latest?tab=report&run=run_latest" },
          },
        })]}
      />,
    );

    expect(screen.getByRole("columnheader", { name: "最近运行" })).toBeTruthy();
    const row = screen.getByTestId("scheduled-task-latest");
    expect(within(row).getByText("成功")).toBeTruthy();
    expect(within(row).getByText("耗时 1 分 30 秒")).toBeTruthy();
    expect(within(row).getByRole("link", { name: "任务报告" }).getAttribute("href"))
      .toBe("/projects/project_1/scheduled-tasks/latest?tab=report&run=run_latest");
  });
});
