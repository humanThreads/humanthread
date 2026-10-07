import type { DesktopProjectSummary } from "@humanthread/workbench-client";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { ProjectList } from "./project-list-page";

const project: DesktopProjectSummary = {
  id: "project_1",
  name: "Atlas",
  spaceLabel: "Acme",
  objective: "交付桌面项目工作区",
  owner: { id: "user_1", name: "Owner" },
  status: "active",
  health: "blocked",
  progress: { completed: 2, total: 4, percent: 50 },
  taskCounts: { open: 6, overdue: 2, blocked: 1 },
  nextMilestone: { id: "milestone_2", name: "Beta", targetAt: null, status: "active" },
  updatedAt: "2026-07-27T08:00:00.000Z",
};

describe("desktop Project list", () => {
  it("renders dense delivery facts and scoped Task links", () => {
    render(<MemoryRouter><ProjectList projects={[project]} /></MemoryRouter>);

    const table = screen.getByRole("table", { name: "项目列表" });
    expect(within(table).getByRole("heading", { name: "Atlas" })).toBeVisible();
    expect(within(table).getByText("里程碑 2 / 4")).toBeVisible();
    expect(within(table).getByRole("link", { name: "已阻塞 1" }))
      .toHaveAttribute("href", "/tasks?project=project_1&relation=blocked");
    expect(within(table).getByRole("link", { name: /Atlas/ }))
      .toHaveAttribute("href", "/projects/project_1");
    expect(within(table).getByRole("link", { name: "配置 Loop 模型" }))
      .toHaveAttribute("href", "/projects/project_1/loops/models");
    expect(within(table).getByRole("link", { name: "查看详情" }))
      .toHaveAttribute("href", "/projects/project_1");
  });
});
