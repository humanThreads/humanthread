import type { DesktopTeamResponse } from "@humanthread/workbench-client";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { TeamView } from "./team-page";

const data: DesktopTeamResponse["data"] = {
  team: { id: "team_1", name: "HumanThread" },
  members: [{
    id: "user_1",
    name: "测试用户",
    email: "alice@example.com",
    status: "active",
    lastSeenAt: "2026-07-27T12:00:00.000Z",
    queueLength: 3,
    currentTask: {
      id: "task_1",
      title: "完成桌面信息域",
      status: "active",
      projectId: "project_1",
      projectName: "HumanThread",
      assigneeName: "测试用户",
      updatedAt: "2026-07-27T12:00:00.000Z",
      route: "/tasks/task_1",
    },
    route: "/team?member=user_1",
  }],
};

describe("desktop team page", () => {
  it("shows member workload and links the current task", () => {
    render(<MemoryRouter><TeamView data={data} selectedMemberId="user_1" /></MemoryRouter>);

    expect(screen.getByRole("heading", { name: "测试用户" })).toBeVisible();
    expect(screen.getByText("待处理 3")).toBeVisible();
    expect(screen.getByRole("link", { name: "完成桌面信息域" }))
      .toHaveAttribute("href", "/tasks/task_1");
  });

  it("renders a useful empty state for a Space without members", () => {
    render(<MemoryRouter><TeamView data={{ team: null, members: [] }} /></MemoryRouter>);

    expect(screen.getByText("当前工作空间暂无团队成员")).toBeVisible();
  });
});
