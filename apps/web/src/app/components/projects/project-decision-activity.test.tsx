// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { ProjectDecisionActivity } from "./project-decision-activity";

const view = {
  project: { id: "project_1", name: "交付中心" },
  canDecide: true,
  decisions: [{ id: "approval_1", type: "merge", status: "pending", taskTitle: "合并发布分支", action: "merge", scope: "main", policyReason: "需要人工确认", requestedByActor: "agent:1", decisionReason: null, decidedByUserId: null, occurredAt: new Date("2026-07-29T08:00:00.000Z") }],
  timeline: [{ id: "activity_1", kind: "task_activity" as const, title: "任务动态", description: "任务进入进行中", actorLabel: "项目经理", taskId: "task_1", taskTitle: "合并发布分支", occurredAt: new Date("2026-07-29T10:00:00.000Z") }],
};

afterEach(() => cleanup());

describe("ProjectDecisionActivity", () => {
  it("shows decision controls only to authorized managers", async () => {
    const user = userEvent.setup();
    render(<ProjectDecisionActivity view={view} />);
    await user.click(screen.getByRole("button", { name: "处理决策" }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByText("任务进入进行中")).toBeTruthy();
  });

  it("keeps ordinary members on a read-only audit view", () => {
    render(<ProjectDecisionActivity view={{ ...view, canDecide: false }} />);
    expect(screen.queryByRole("button", { name: "处理决策" })).toBeNull();
    expect(screen.getByText("等待决定")).toBeTruthy();
  });
});
