// @vitest-environment jsdom

import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TaskCalendar } from "./task-calendar";

const dnd = vi.hoisted((): { onDragEnd(event: unknown): void } => ({ onDragEnd: () => undefined }));
vi.mock("@dnd-kit/core", () => ({
  DndContext: ({ children, onDragEnd }: { children: ReactNode; onDragEnd(event: unknown): void }) => { dnd.onDragEnd = onDragEnd; return children; },
  PointerSensor: class PointerSensor {}, KeyboardSensor: class KeyboardSensor {},
  useSensor: () => ({}), useSensors: () => [],
  useDraggable: () => ({ attributes: {}, listeners: {}, setNodeRef: () => undefined, transform: null, isDragging: false }),
  useDroppable: () => ({ setNodeRef: () => undefined, isOver: false }),
  closestCenter: vi.fn(),
}));

const scheduled = { id: "task_1", shortId: "HT100001", title: "跨日交付", statusCategory: "in_progress", status: { id: null, name: "进行中", category: "in_progress", color: "#1f883d" }, visibility: "project", priority: 2, startAt: new Date("2026-07-01T01:00:00.000Z"), dueAt: new Date("2026-07-02T09:00:00.000Z"), overdue: false, version: 3, createdAt: new Date(), updatedAt: new Date(), createdById: "user_1", assignee: null, project: null, blocker: null, labels: [], childCount: 0, automation: null };
const unscheduled = { ...scheduled, id: "task_2", shortId: "HT100002", title: "待排期", startAt: null, dueAt: null };

afterEach(cleanup);

describe("TaskCalendar", () => {
  it("shows current start/due markers, unscheduled tasks and a mobile agenda", async () => {
    render(<TaskCalendar tasks={[scheduled, unscheduled]} timeZone="Asia/Shanghai" initialMonth="2026-07" queryString="" currentTaskId="task_1" onMoveDate={vi.fn()} />);
    expect(screen.getAllByText("开始 · HT100001 · 跨日交付").length).toBeGreaterThan(0);
    expect(screen.getAllByText("截止 · HT100001 · 跨日交付").length).toBeGreaterThan(0);
    expect(screen.getByText("HT100002")).toBeTruthy();
    expect(screen.getByText("待排期")).toBeTruthy();
    expect(screen.getByLabelText("移动端任务议程")).toBeTruthy();
    const links = screen.getAllByRole("link", { name: /跨日交付/ });
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      expect(link.getAttribute("data-task-detail-trigger")).toBe("");
      expect(link.getAttribute("aria-current")).toBe("true");
    }
  });

  it("keeps the compact calendar label when a task has no shortId", () => {
    const withoutShortId = { ...scheduled, id: "task_without_short_id", shortId: null, title: "无编号任务", dueAt: null };
    const { container } = render(<TaskCalendar tasks={[withoutShortId]} timeZone="Asia/Shanghai" initialMonth="2026-07" queryString="" onMoveDate={vi.fn()} />);

    expect(screen.getAllByText("开始 · 无编号任务").length).toBeGreaterThan(0);
    expect(container.textContent).not.toContain("task_without_short_id");
  });

  it("moves a due marker with its expected version and rolls back on conflict", async () => {
    const onMoveDate = vi.fn().mockRejectedValue(new Error("版本冲突"));
    render(<TaskCalendar tasks={[scheduled]} timeZone="Asia/Shanghai" initialMonth="2026-07" queryString="" onMoveDate={onMoveDate} />);
    await act(async () => dnd.onDragEnd({ active: { data: { current: { taskId: "task_1", kind: "due" } } }, over: { data: { current: { dateKey: "2026-07-05" } } } }));
    expect(onMoveDate).toHaveBeenCalledWith(scheduled, { dueAt: "2026-07-05T09:00:00.000Z" });
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("版本冲突"));
    expect(screen.getAllByText("截止 · HT100001 · 跨日交付").some((entry) => entry.closest("[data-date-key]")?.getAttribute("data-date-key") === "2026-07-02")).toBe(true);
  });

  it("preserves Shanghai local time when a marker crosses the UTC day boundary", async () => {
    const onMoveDate = vi.fn().mockResolvedValue(undefined);
    const boundaryTask = { ...scheduled, dueAt: new Date("2026-07-01T18:00:00.000Z") };
    render(<TaskCalendar tasks={[boundaryTask]} timeZone="Asia/Shanghai" initialMonth="2026-07" queryString="" onMoveDate={onMoveDate} />);
    await act(async () => dnd.onDragEnd({ active: { data: { current: { taskId: "task_1", kind: "due" } } }, over: { data: { current: { dateKey: "2026-07-05" } } } }));
    expect(onMoveDate).toHaveBeenCalledWith(boundaryTask, { dueAt: "2026-07-04T18:00:00.000Z" });
  });
});
