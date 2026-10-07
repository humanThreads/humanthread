// @vitest-environment jsdom

import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TaskBoard } from "./task-board";

const dnd = vi.hoisted((): { onDragEnd(event: unknown): void } => ({ onDragEnd: () => undefined }));
vi.mock("@dnd-kit/core", () => ({
  DndContext: ({ children, onDragEnd }: { children: ReactNode; onDragEnd(event: unknown): void }) => { dnd.onDragEnd = onDragEnd; return children; },
  PointerSensor: class PointerSensor {}, KeyboardSensor: class KeyboardSensor {},
  useSensor: () => ({}), useSensors: () => [],
  useDraggable: ({ id, data }: { id: string; data: unknown }) => ({ attributes: { "data-drag-id": id }, listeners: {}, setNodeRef: () => undefined, transform: null, isDragging: false, data }),
  useDroppable: () => ({ setNodeRef: () => undefined, isOver: false }),
  closestCorners: vi.fn(),
}));

const task = { id: "task_1", shortId: "HT100001", title: "发布", statusCategory: "todo", status: { id: null, name: "待处理", category: "todo", color: "#57606a" }, visibility: "private", priority: 2, startAt: null, dueAt: null, overdue: false, version: 1, createdAt: new Date(), updatedAt: new Date(), createdById: "user_1", assignee: null, project: null, blocker: null, labels: [], childCount: 0, automation: null };

afterEach(cleanup);

describe("TaskBoard", () => {
  it("renders stable status columns including current detail links", async () => {
    render(<TaskBoard tasks={[task]} group="status" queryString="relation=assigned" currentTaskId="task_1" members={[]} projects={[]} onMove={vi.fn()} />);
    expect(screen.getByRole("region", { name: "任务看板" }).className).toContain("overflow-x-auto");
    expect(screen.getByRole("group", { name: "待规划" })).toBeTruthy();
    expect(screen.getByRole("group", { name: "待处理" })).toBeTruthy();
    expect(screen.getByRole("group", { name: "已完成" })).toBeTruthy();
    expect(screen.getByText("HT100001")).toBeTruthy();
    const link = screen.getByRole("link", { name: "发布" });
    expect(link.getAttribute("href")).toBe("/tasks/task_1");
    expect(link.getAttribute("data-task-detail-trigger")).toBe("");
    expect(link.getAttribute("aria-current")).toBe("true");
  });

  it("does not expose the internal task ID when a board card has no shortId", () => {
    const { container } = render(<TaskBoard tasks={[{ ...task, shortId: null }]} group="status" queryString="" members={[]} projects={[]} onMove={vi.fn()} />);

    expect(container.textContent).not.toContain("task_1");
  });

  it("sends a versioned status move and rolls back on conflict", async () => {
    const onMove = vi.fn().mockRejectedValue(new Error("任务已被其他人更新"));
    render(<TaskBoard tasks={[task]} group="status" queryString="" members={[]} projects={[]} onMove={onMove} />);
    await act(() => dnd.onDragEnd({ active: { data: { current: { taskId: "task_1" } } }, over: { data: { current: { groupKey: "in_progress" } } } }));
    expect(onMove).toHaveBeenCalledWith(task, "start", {});
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("任务已被其他人更新"));
    expect(screen.getByRole("group", { name: "待处理" }).textContent).toContain("发布");
  });
});
