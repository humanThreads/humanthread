import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { MonthCalendar, buildCalendarGrid } from "./month-calendar";

describe("buildCalendarGrid", () => {
  it("builds six complete weeks from Monday and includes adjacent-month days", () => {
    const cells = buildCalendarGrid(2026, 9, new Date(2026, 8, 18));
    expect(cells).toHaveLength(42);
    expect(cells[0]).toMatchObject({ dateKey: "2026-08-31", inMonth: false });
    expect(cells[1]).toMatchObject({ dateKey: "2026-09-01", inMonth: true });
    expect(cells.find((cell) => cell.dateKey === "2026-09-18")?.isToday).toBe(true);
  });
});

describe("MonthCalendar", () => {
  it("renders a standard month grid and opens a task from its date cell", async () => {
    const user = userEvent.setup();
    const onOpenTask = vi.fn();
    render(
      <MonthCalendar
        entries={[{
          id: "entry-1",
          dateKey: "2026-09-18",
          title: "实现客户端开箱向导",
          kind: "due",
          overdue: false,
          taskId: "task-1",
        }]}
        initialMonth="2026-09"
        onOpenTask={onOpenTask}
      />,
    );

    expect(screen.getByText("2026 年 9 月")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "实现客户端开箱向导" }));
    expect(onOpenTask).toHaveBeenCalledWith("task-1");
    await user.click(screen.getByRole("button", { name: "下个月" }));
    expect(screen.getByText("2026 年 10 月")).toBeInTheDocument();
  });
});
