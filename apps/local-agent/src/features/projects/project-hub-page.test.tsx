import type { DesktopProjectDetail } from "@humanthread/workbench-client";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { ProjectHub } from "./project-hub-page";

const detail = {
  project: {
    id: "project_1", name: "Atlas", spaceLabel: "Acme", objective: "交付项目工作区",
    owner: { id: "user_1", name: "Owner" }, status: "active", health: "blocked",
    progress: { completed: 1, total: 2, percent: 50 },
    taskCounts: { open: 3, overdue: 1, blocked: 1 }, nextMilestone: null,
    updatedAt: "2026-07-27T08:00:00.000Z", description: "Desktop delivery",
    startAt: null, targetAt: null, visibility: "company",
    capabilities: { edit: true, manageMembers: true, changeLifecycle: true, manageRoadmap: true, nativeWorkspace: true },
  },
  health: { objectiveState: "complete", currentStageName: "Build", nextAction: "处理阻塞任务", blockers: 1, overdueTasks: 1 },
  taskSummary: { total: 4, open: 3, overdue: 1, blocked: 1, completed: 1 },
  resources: { documents: 1, members: 2, activities: 0, automationState: "已自动化" },
  roadmap: [{ id: "stage_1", version: 2, sortOrder: 0, name: "Build", status: "active", startAt: null, targetAt: null, completedMilestones: 1, totalMilestones: 2, milestones: [{ id: "milestone_1", version: 3, sortOrder: 0, name: "Alpha", status: "completed", targetAt: null, riskSummary: "发布窗口确认", taskCount: 2, tasks: [{ id: "task_1", title: "实现项目中心", status: "doing", version: 4 }] }] }],
  tasks: [{ id: "task_1", title: "实现项目中心", status: "doing", priority: 2, assigneeName: "Owner", milestoneId: "milestone_1", updatedAt: "2026-07-27T08:00:00.000Z", route: "/tasks?project=project_1&taskId=task_1" }],
  documents: [{ id: "doc_1", title: "Architecture", path: "architecture.md", version: 2, updatedAt: "2026-07-27T08:00:00.000Z", route: "/documents/doc_1" }],
  risks: [{ id: "milestone_2", name: "Beta", status: "at_risk", summary: "依赖未确认" }],
  agents: [{ id: "workflow_1", title: "Codex implementation", status: "active", currentStepKey: "implement", updatedAt: "2026-07-27T08:00:00.000Z", route: "/agents?workflow=workflow_1" }],
  workspace: {
    bindingId: "workspace_1",
    status: "ready",
    pathFingerprint: "hmac-sha256:localfingerprint",
    configurationVersion: 1,
    lastValidatedAt: "2026-07-31T08:00:00.000Z",
  },
} satisfies DesktopProjectDetail;

describe("desktop Project hub", () => {
  it("renders objective, roadmap, Tasks, documents, risks and Agent context", () => {
    render(<MemoryRouter><ProjectHub
      detail={detail}
      workspaceSettings={<div>当前设备项目目录配置</div>}
    /></MemoryRouter>);

    expect(screen.getByRole("heading", { name: "Atlas" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Build" })).toBeVisible();
    expect(screen.getByText("发布窗口确认")).toBeVisible();
    expect(screen.getByRole("link", { name: "实现项目中心" }))
      .toHaveAttribute("href", "/tasks?project=project_1&taskId=task_1");
    expect(screen.getByRole("link", { name: "Architecture" })).toBeVisible();
    expect(screen.getByText("依赖未确认")).toBeVisible();
    expect(screen.getByRole("link", { name: "Codex implementation" })).toBeVisible();
    expect(screen.getByRole("region", { name: "本地工作区" }))
      .toHaveTextContent("当前设备项目目录配置");
  });

});
