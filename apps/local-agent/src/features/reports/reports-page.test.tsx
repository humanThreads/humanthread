import type { DesktopReportsResponse } from "@humanthread/workbench-client";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { ReportsView } from "./reports-page";

const data: DesktopReportsResponse["data"] = {
  range: "30d",
  generatedAt: "2026-07-27T12:00:00.000Z",
  metrics: {
    completedTasks: 18,
    overdueTasks: 2,
    blockerMedianAgeHours: 6,
    humanWaitMedianAgeHours: 3,
    automationSuccess: { state: "known", succeeded: 9, total: 10, rate: 90 },
  },
  trend: {
    state: "ready",
    points: [
      { label: "第 1 周", completed: 7, blockers: 1 },
      { label: "第 2 周", completed: 11, blockers: 2 },
    ],
  },
  projects: [{
    id: "project_1",
    name: "桌面客户端",
    status: "active",
    health: "at_risk",
    openTaskCount: 6,
    overdueTaskCount: 2,
    blockedTaskCount: 1,
    updatedAt: "2026-07-27T11:00:00.000Z",
    route: "/projects/project_1",
  }],
  insights: [{ label: "等待人工审批", count: 2, tone: "warning", route: "/agents?view=approvals" }],
};

describe("desktop reports page", () => {
  it("shows delivery metrics, trend and project drilldowns", () => {
    render(<MemoryRouter><ReportsView data={data} onRangeChange={() => undefined} /></MemoryRouter>);

    expect(screen.getByText("18")).toBeVisible();
    expect(screen.getByText("90%")).toBeVisible();
    expect(screen.getByText("第 2 周")).toBeVisible();
    expect(screen.getByRole("img", { name: "交付趋势图" })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "报表项目分页" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /桌面客户端/u }))
      .toHaveAttribute("href", "/projects/project_1");
    expect(screen.getByRole("link", { name: /等待人工审批/u }))
      .toHaveAttribute("href", "/agents?view=approvals");
  });

  it("changes the reporting range through the explicit control", async () => {
    const user = userEvent.setup();
    const onRangeChange = vi.fn();
    render(<MemoryRouter><ReportsView data={data} onRangeChange={onRangeChange} /></MemoryRouter>);

    await user.selectOptions(screen.getByRole("combobox", { name: "报表区间" }), "90d");

    expect(onRangeChange).toHaveBeenCalledWith("90d");
  });
});
