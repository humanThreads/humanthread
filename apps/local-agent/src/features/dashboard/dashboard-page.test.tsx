import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { DashboardView } from "./dashboard-page";

describe("desktop dashboard", () => {
  it("routes action signals and current work to their operational views", () => {
    render(
      <MemoryRouter>
        <DashboardView data={{
          currentTask: {
            id: "task_1",
            title: "重构桌面客户端",
            status: "doing",
            projectId: "project_1",
            projectName: "HumanThread",
            assigneeName: "Owner",
            updatedAt: "2026-07-27T08:00:00.000Z",
            route: "/tasks/task_1",
          },
          stats: [{ key: "active", label: "进行中", count: 4, description: "当前执行" }],
          actionSignals: [{
            key: "approvals",
            label: "待确认",
            count: 2,
            description: "需要人工确认的 Agent 操作",
          }],
          tasks: [],
          devices: [],
        }} />
      </MemoryRouter>,
    );

    expect(screen.getByRole("link", { name: /待确认 2/ }))
      .toHaveAttribute("href", "/agents?view=approvals");
    expect(screen.getByRole("link", { name: /重构桌面客户端/ }))
      .toHaveAttribute("href", "/tasks/task_1");
  });
});
