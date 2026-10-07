// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TASK_LIST_COLUMNS, TaskList } from "./task-list";

const tasks = [{
  id: "task_1", shortId: "HT100001", title: "完成内部发布与安全复核", statusCategory: "in_progress",
  status: { id: "status_1", name: "开发中", category: "in_progress", color: "#1f883d" },
  visibility: "project", priority: 2, startAt: null, dueAt: new Date("2026-07-20T08:00:00.000Z"),
  overdue: true, version: 3, createdAt: new Date("2026-07-18T00:00:00.000Z"), updatedAt: new Date("2026-07-22T00:00:00.000Z"),
  createdById: "user_1", assignee: { id: "user_1", name: "Alice", avatarUrl: null },
  project: { id: "project_1", name: "HumanThread" },
  blocker: { id: "blocker_1", reason: "等待安全审查", ownerUserId: "user_1", createdAt: new Date("2026-07-21T00:00:00.000Z") },
  labels: [{ id: "label_1", name: "安全", color: "#cf222e" }], childCount: 2, automation: null,
}];

afterEach(cleanup);

describe("TaskList", () => {
  it("renders the user-facing default columns and task signals", () => {
    const { container } = render(<TaskList tasks={tasks} selectedTaskIds={[]} onSelectionChange={vi.fn()} onCommand={vi.fn()} />);

    expect(TASK_LIST_COLUMNS).toEqual(["任务", "状态", "负责人", "优先级", "截止时间", "项目", "子任务"]);
    expect(screen.getAllByText("开发中").length).toBeGreaterThan(0);
    expect(screen.getAllByText("HT100001")).toHaveLength(2);
    expect(screen.getByText("等待安全审查")).toBeTruthy();
    expect(screen.getByText("安全").getAttribute("style")).toContain("--label-color: #cf222e");
    expect(screen.getAllByText("已逾期").length).toBeGreaterThan(0);
    expect(container.textContent).not.toContain("队列");
    expect(container.textContent).not.toContain("Worker");
    expect(container.textContent).not.toContain("Lease");
    expect(container.querySelector("[data-mobile-task-list]")).toBeTruthy();
  });

  it("does not expose an internal task ID when shortId is unavailable", () => {
    const { container } = render(<TaskList tasks={[{ ...tasks[0]!, shortId: null }]} selectedTaskIds={[]} onSelectionChange={vi.fn()} onCommand={vi.fn()} />);

    expect(container.textContent).not.toContain("task_1");
  });

  it("shows Loop progress and a status icon for automated tasks", () => {
    const { container } = render(<TaskList tasks={[{ ...tasks[0]!, loopRun: { id: "run_1", status: "paused", progress: { completed: 2, total: 5, percent: 40 }, pendingInteraction: null } }]} selectedTaskIds={[]} onSelectionChange={vi.fn()} onCommand={vi.fn()} />);

    expect(screen.getAllByRole("progressbar", { name: "Loop 运行进度 40%" })).toHaveLength(2);
    expect(screen.getAllByLabelText("Loop 状态：已暂停")).toHaveLength(2);
    expect(container.querySelector("[data-testid=task-loop-indicator]")).toBeTruthy();
  });

  it("selects rows, opens the full detail page, and sends inline status commands", async () => {
    const user = userEvent.setup();
    const onSelectionChange = vi.fn();
    const onCommand = vi.fn().mockResolvedValue(undefined);
    render(<TaskList tasks={tasks} selectedTaskIds={[]} currentTaskId="task_1" queryString="relation=assigned&sort=due_asc" onSelectionChange={onSelectionChange} onCommand={onCommand} />);

    await user.click(screen.getAllByRole("checkbox", { name: "选择完成内部发布与安全复核" })[0]!);
    expect(onSelectionChange).toHaveBeenCalledWith(["task_1"]);
    expect(screen.getAllByRole("link", { name: "完成内部发布与安全复核" })[0]?.getAttribute("href")).toBe("/tasks/task_1");
    expect(screen.getAllByRole("link", { name: "完成内部发布与安全复核" })).toHaveLength(2);
    for (const link of screen.getAllByRole("link", { name: "完成内部发布与安全复核" })) {
      expect(link.getAttribute("data-task-detail-trigger")).toBe("");
      expect(link.getAttribute("aria-current")).toBe("true");
    }
    await user.selectOptions(screen.getByLabelText("完成内部发布与安全复核的状态"), "submit_for_review");
    expect(onCommand).toHaveBeenCalledWith(tasks[0], "submit_for_review");
  });

  it("offers restore instead of inline status commands for archived tasks", async () => {
    const user = userEvent.setup();
    const onCommand = vi.fn().mockResolvedValue(undefined);
    render(<TaskList tasks={tasks} selectedTaskIds={[]} archivedView onSelectionChange={vi.fn()} onCommand={onCommand} />);

    expect(screen.queryByLabelText("完成内部发布与安全复核的状态")).toBeNull();
    const restoreButtons = screen.getAllByRole("button", { name: "恢复完成内部发布与安全复核" });
    expect(restoreButtons.length).toBeGreaterThan(0);
    await user.click(restoreButtons[0]!);
    expect(onCommand).toHaveBeenCalledWith(tasks[0], "restore");
  });

  it("explains the archived empty state separately", () => {
    const { rerender } = render(<TaskList tasks={[]} selectedTaskIds={[]} archivedView onSelectionChange={vi.fn()} onCommand={vi.fn()} />);
    expect(screen.getByText("没有已归档任务")).toBeTruthy();
    rerender(<TaskList tasks={[]} selectedTaskIds={[]} onSelectionChange={vi.fn()} onCommand={vi.fn()} />);
    expect(screen.getByText("当前视图没有任务")).toBeTruthy();
  });

  it("renders explicit empty, loading and error states", () => {
    const { rerender } = render(<TaskList tasks={[]} selectedTaskIds={[]} onSelectionChange={vi.fn()} onCommand={vi.fn()} loading />);
    expect(screen.getByRole("status").textContent).toContain("加载任务");
    rerender(<TaskList tasks={[]} selectedTaskIds={[]} onSelectionChange={vi.fn()} onCommand={vi.fn()} error="任务加载失败" />);
    expect(screen.getByRole("alert").textContent).toContain("任务加载失败");
    rerender(<TaskList tasks={[]} selectedTaskIds={[]} onSelectionChange={vi.fn()} onCommand={vi.fn()} />);
    expect(screen.getByText("当前视图没有任务")).toBeTruthy();
  });
});
