import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { TaskCalendar } from "./task-calendar";
import { collectionFixture } from "./task-test-fixtures";

describe("desktop Task calendar", () => {
  it("shows scheduled markers and an explicit unscheduled section", () => {
    render(
      <MemoryRouter>
        <TaskCalendar calendar={collectionFixture.calendar} month="2026-07" />
      </MemoryRouter>,
    );

    expect(screen.getByText("截止 · 完成桌面任务中心")).toBeVisible();
    expect(screen.getByRole("region", { name: "未排期任务" }))
      .toHaveTextContent("补充未排期验收项");
    expect(screen.getByRole("navigation", { name: "任务月历月份" })).toBeInTheDocument();
    expect(screen.getAllByRole("columnheader")).toHaveLength(7);
    expect(screen.getAllByRole("gridcell")).toHaveLength(42);
  });
});
