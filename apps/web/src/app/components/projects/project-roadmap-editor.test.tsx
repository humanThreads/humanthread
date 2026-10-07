// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectRoadmapEditor } from "./project-roadmap-editor";
import type { ProjectHubView } from "../../../lib/workbench/workbench-projects";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

describe("ProjectRoadmapEditor", () => {
  beforeEach(() => { vi.stubGlobal("fetch", vi.fn()); refresh.mockReset(); });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it("submits a fine-grained stage command with the current Project version", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ ok: true, result: { projectId: "project_1", version: 8 } }), { status: 200, headers: { "content-type": "application/json" } }));
    render(<ProjectRoadmapEditor projectId="project_1" projectVersion={7} roadmap={[]} />);
    fireEvent.change(screen.getByLabelText("新阶段名称"), { target: { value: "发布验证" } });
    fireEvent.click(screen.getByRole("button", { name: "添加阶段" }));
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    const request = vi.mocked(fetch).mock.calls[0];
    expect(request?.[0]).toBe("/api/projects/project_1/roadmap");
    expect(JSON.parse(String((request?.[1] as RequestInit).body))).toMatchObject({ expectedVersion: 7, action: { type: "stage.create", name: "发布验证" } });
    expect(refresh).toHaveBeenCalled();
  });

  it("preserves the draft and offers reload after a version conflict", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ ok: false, code: "version_conflict", error: "stale" }), { status: 409, headers: { "content-type": "application/json" } }));
    render(<ProjectRoadmapEditor projectId="project_1" projectVersion={7} roadmap={[]} />);
    const input = screen.getByLabelText("新阶段名称") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "保留的草稿" } });
    fireEvent.click(screen.getByRole("button", { name: "添加阶段" }));
    await screen.findByRole("button", { name: "重新加载" });
    expect(input.value).toBe("保留的草稿");
  });

  it("uses a refreshed server version after the parent projection changes", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ ok: true, result: { projectId: "project_1", version: 10 } }), { status: 200, headers: { "content-type": "application/json" } }));
    const rendered = render(<ProjectRoadmapEditor projectId="project_1" projectVersion={7} roadmap={[]} />);
    rendered.rerender(<ProjectRoadmapEditor projectId="project_1" projectVersion={9} roadmap={[]} />);
    fireEvent.change(screen.getByLabelText("新阶段名称"), { target: { value: "使用新版本" } });
    fireEvent.click(screen.getByRole("button", { name: "添加阶段" }));
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(JSON.parse(String((vi.mocked(fetch).mock.calls[0]?.[1] as RequestInit).body))).toMatchObject({ expectedVersion: 9 });
  });

  it("keeps roadmap editing collapsed until a stage is opened", () => {
    const roadmap: ProjectHubView["roadmap"] = [{
      id: "stage_1",
      version: 1,
      sortOrder: 0,
      name: "实施阶段",
      status: "active",
      startAt: null,
      targetAt: null,
      completedMilestones: 0,
      totalMilestones: 1,
      milestones: [{ id: "milestone_1", version: 1, sortOrder: 0, name: "首轮交付", status: "planned", targetAt: null, riskSummary: null, taskCount: 0, tasks: [] }],
    }];
    render(<ProjectRoadmapEditor projectId="project_1" projectVersion={7} roadmap={roadmap} />);

    expect(screen.queryByDisplayValue("首轮交付")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /实施阶段/ }));
    fireEvent.click(screen.getByRole("button", { name: /首轮交付/ }));
    expect(screen.getByDisplayValue("首轮交付")).not.toBeNull();
  });

  it("shows the milestone Loop batch action in editable roadmaps", () => {
    const roadmap: ProjectHubView["roadmap"] = [{
      id: "stage_1", version: 1, sortOrder: 0, name: "实施阶段", status: "active", startAt: null, targetAt: null, completedMilestones: 0, totalMilestones: 1,
      milestones: [{ id: "milestone_1", version: 1, sortOrder: 0, name: "首轮交付", status: "planned", targetAt: null, riskSummary: null, taskCount: 1, tasks: [{ id: "task_1", title: "任务", status: "待处理", statusCategory: "todo", publicationStatus: "unpublished", version: 1 }] }],
    }];
    render(<ProjectRoadmapEditor projectId="project_1" projectVersion={7} roadmap={roadmap} />);
    fireEvent.click(screen.getByRole("button", { name: /实施阶段/ }));
    expect(screen.getByRole("button", { name: "运行里程碑任务 Loop" })).toBeTruthy();
  });
});
