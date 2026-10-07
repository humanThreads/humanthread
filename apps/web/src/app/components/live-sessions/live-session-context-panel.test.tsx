// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { LiveSessionContextPanel } from "./live-session-context-panel";

afterEach(cleanup);

const projects = [{ id: "project_1", name: "humanthread", spaceId: "space_company" }];
const tasks = [{ id: "task_1", title: "实现在线 TUI", projectId: "project_1", statusCategory: "todo" }];
const session = {
  id: "a".repeat(32),
  kind: "worker" as const,
  surface: "web" as const,
  spaceId: "space_company",
  projectId: "project_1",
  taskId: "task_1",
  executionPolicy: "loop" as const,
  target: { type: "worker_pool" as const, workerPoolId: "b".repeat(32), displayName: "ht-agnet" },
  targetDisplayName: "ht-agnet",
  businessRun: { type: "loop_run" as const, id: "loop_1" },
  status: "running" as const,
  controlState: "controller" as const,
  journal: { status: "ready" as const, retentionDays: 30, firstSequence: 0, lastSequence: 42 },
  model: { siteId: "c".repeat(32), siteName: "mc", model: "gpt-5.6-terra", label: "GPT-5.6 Terra", reasoningEffort: "high" as const },
  createdAt: "2026-09-24T00:00:00.000Z",
  updatedAt: "2026-09-24T00:00:00.000Z",
};

describe("Live session context panel", () => {
  it("shows the authorized project and execution context without terminal bytes", () => {
    render(<LiveSessionContextPanel session={session} projects={projects} tasks={tasks} />);

    expect(screen.getByText("执行上下文")).toBeTruthy();
    expect(screen.getByText("humanthread")).toBeTruthy();
    expect(screen.getByText("实现在线 TUI")).toBeTruthy();
    expect(screen.getByText("ht-agnet")).toBeTruthy();
    expect(screen.queryByText(/终端输出/u)).toBeNull();
  });
});
