// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProjectRoadmap } from "./project-roadmap";

const roadmap = [{
  id: "stage_1",
  version: 1,
  sortOrder: 0,
  name: "实施阶段",
  status: "active",
  startAt: null,
  targetAt: null,
  completedMilestones: 0,
  totalMilestones: 1,
  milestones: [{
    id: "milestone_1",
    version: 1,
    sortOrder: 0,
    name: "首轮交付",
    status: "planned",
    targetAt: null,
    riskSummary: null,
    taskCount: 1,
    tasks: [{ id: "task_assigned", title: "已分配任务", status: "todo", version: 1 }],
  }],
}];

const projectTasks = [
  {
    id: "task_assigned",
    title: "已分配任务",
    statusCategory: "todo",
    status: { id: "status_todo", name: "待处理", category: "todo", color: "#57606a" },
    dueAt: null,
    overdue: false,
    version: 1,
    assignee: null,
    blocker: null,
  },
  {
    id: "task_unassigned",
    title: "待规划任务",
    statusCategory: "in_progress",
    status: { id: "status_progress", name: "进行中", category: "in_progress", color: "#0969da" },
    dueAt: null,
    overdue: false,
    version: 2,
    assignee: { id: "user_1", name: "张三", avatarUrl: null },
    blocker: null,
  },
];

describe("ProjectRoadmap", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("reveals stages, milestones, and tasks one level at a time", () => {
    render(<ProjectRoadmap projectId="project_1" roadmap={roadmap} projectTasks={projectTasks} />);

    expect(screen.getByRole("progressbar", { name: "实施阶段进度" }).getAttribute("aria-valuenow")).toBe("0");
    expect(screen.queryByText("首轮交付")).toBeNull();
    expect(screen.queryByText("待规划任务")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /实施阶段/ }));
    expect(screen.getByText("首轮交付")).not.toBeNull();
    expect(screen.queryByText("已分配任务")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /首轮交付/ }));
    expect(screen.getByText("已分配任务")).not.toBeNull();
  });

  it("places tasks outside roadmap milestones in the collapsed unassigned group", () => {
    render(<ProjectRoadmap projectId="project_1" roadmap={roadmap} projectTasks={projectTasks} />);

    const unassigned = screen.getByRole("button", { name: /未分配/ });
    expect(unassigned.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("待规划任务")).toBeNull();

    fireEvent.click(unassigned);
    expect(screen.getByText("待规划任务")).not.toBeNull();
    expect(screen.getByRole("link", { name: "待规划任务" }).getAttribute("href")).toBe("/tasks/task_unassigned");
  });

  it("keeps the started release Loop reachable from the temporary release plan", async () => {
    const releaseRoadmap = [{
      ...roadmap[0]!,
      milestones: [{
        ...roadmap[0]!.milestones[0]!,
        tasks: [{ id: "task_release", title: "可发布任务", status: "completed", statusCategory: "completed", publicationStatus: "unreleased", version: 1 }],
      }],
    }];
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ json: async () => ({ ok: true, plan: { id: "plan_1" } }) })
      .mockResolvedValueOnce({ json: async () => ({ ok: true, loopRunId: "loop_run:release_1" }) });
    vi.stubGlobal("fetch", fetchMock);

    render(<ProjectRoadmap projectId="project_1" roadmap={releaseRoadmap} />);
    fireEvent.click(screen.getByRole("button", { name: "发布计划" }));
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "创建" }));

    await waitFor(() => expect(screen.getByRole("link", { name: /进入发布 Loop 运行工作区/ }).getAttribute("href")).toBe("/loop-runs/loop_run%3Arelease_1"));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("disables release submission while create/start is in flight", async () => {
    const releaseRoadmap = [{
      ...roadmap[0]!,
      milestones: [{
        ...roadmap[0]!.milestones[0]!,
        tasks: [{ id: "task_release", title: "可发布任务", status: "completed", statusCategory: "completed", publicationStatus: "unreleased", version: 1 }],
      }],
    }];
    let resolveCreate!: (value: unknown) => void;
    const fetchMock = vi.fn().mockReturnValue(new Promise((resolve) => { resolveCreate = resolve; }));
    vi.stubGlobal("fetch", fetchMock);

    render(<ProjectRoadmap projectId="project_1" roadmap={releaseRoadmap} />);
    fireEvent.click(screen.getByRole("button", { name: "发布计划" }));
    fireEvent.click(screen.getByRole("checkbox"));
    const createButton = screen.getByRole("button", { name: "创建" });
    fireEvent.click(createButton);
    fireEvent.click(createButton);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(createButton.getAttribute("disabled")).not.toBeNull();
    resolveCreate({ json: async () => ({ ok: false, error: "busy" }) });
    await waitFor(() => expect(createButton.getAttribute("disabled")).toBeNull());
  });

  it("allows excluding a selected task before creating the release plan", () => {
    const releaseRoadmap = [{
      ...roadmap[0]!,
      milestones: [{
        ...roadmap[0]!.milestones[0]!,
        tasks: [
          { id: "task_release_a", title: "应发布任务", status: "completed", statusCategory: "completed", publicationStatus: "unreleased", version: 1 },
          { id: "task_release_b", title: "无需发布任务", status: "completed", statusCategory: "completed", publicationStatus: "unreleased", version: 1 },
        ],
      }],
    }];
    render(<ProjectRoadmap projectId="project_1" roadmap={releaseRoadmap} />);
    fireEvent.click(screen.getByRole("button", { name: "发布计划" }));
    const checkboxes = screen.getAllByRole("checkbox");
    fireEvent.click(checkboxes[0]!);
    fireEvent.click(checkboxes[1]!);
    fireEvent.click(screen.getByRole("button", { name: "清空选择" }));
    expect((checkboxes[0] as HTMLInputElement).checked).toBe(false);
    expect((checkboxes[1] as HTMLInputElement).checked).toBe(false);
  });
});
