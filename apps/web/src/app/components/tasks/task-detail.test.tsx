// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TaskDetail } from "./task-detail";

vi.mock("./task-editor", () => ({ TaskEditor: ({ contentMarkdown }: { contentMarkdown: string }) => <div data-testid="task-editor" data-content-markdown={contentMarkdown}>正文编辑器</div> }));
vi.mock("./task-loop-launcher", () => ({
  TaskLoopLauncher: ({ loopRun }: { loopRun: { id: string } | null }) => <aside aria-label="Loop 启动设置" data-loop-run={loopRun?.id ?? ""}>独立启动器</aside>,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

export const detailFixture = {
  task: {
    id: "task_1", shortId: "HT100001", title: "发布内部版本", contentMarkdown: "# 验收", version: 3,
    statusCategory: "in_progress", statusDefinition: { id: "status_1", name: "开发中", category: "in_progress", color: "#1f883d" },
    priority: 2, visibility: "project", startAt: null, dueAt: new Date("2026-07-25T09:00:00.000Z"), archivedAt: null,
    assigneeUserId: "user_1", assignee: { id: "user_1", name: "Owner", avatarUrl: null },
    createdById: "user_1", createdBy: { id: "user_1", name: "Owner", avatarUrl: null },
    acceptanceMode: "human", acceptanceReviewer: null, acceptanceReadiness: null, project: { id: "project_1", name: "HumanThread" },
    members: [], blockers: [], labelAssignments: [], childTasks: [], predecessorDependencies: [], successorDependencies: [],
    documentLinks: [], attachments: [], comments: [], activities: [], reminders: [], agentRuns: [], loopRuns: [],
  },
  capabilities: { read: true, comment: true, edit: true, changeStatus: true, manageMembers: true, manageVisibility: true, dispatchAgent: true, govern: true },
};

afterEach(cleanup);

describe("TaskDetail", () => {
  it("shares primary fields, editor and independent content/activity scroll regions", () => {
    const { container } = render(<TaskDetail detail={detailFixture} layout="panel" queryString="relation=assigned&taskId=task_1" members={[]} projects={[]} labels={[]} agentProfiles={[]} />);
    expect(screen.getByRole("heading", { name: "发布内部版本" })).toBeTruthy();
    expect(screen.getByText("HT100001")).toBeTruthy();
    expect(screen.getByLabelText("任务状态")).toBeTruthy();
    expect(screen.getByLabelText("任务负责人")).toBeTruthy();
    expect(screen.getByLabelText("任务优先级")).toBeTruthy();
    expect(screen.getByTestId("task-editor")).toBeTruthy();
    expect(container.querySelector("[data-task-detail-scroll]")?.className).toContain("overflow-y-auto");
    expect(screen.getByRole("link", { name: "全屏打开" }).getAttribute("href")).toBe("/tasks/task_1");
    expect(screen.getByRole("link", { name: "关闭详情" }).getAttribute("href")).not.toContain("taskId");
  });

  it("gives the full task page a dedicated Loop launcher rail without duplicating it in the side panel", () => {
    const { rerender } = render(<TaskDetail detail={detailFixture} layout="page" queryString="" members={[]} projects={[]} labels={[]} agentProfiles={[]} />);

    expect(screen.getByLabelText("Loop 启动设置").textContent).toContain("独立启动器");
    expect(screen.getByRole("tab", { name: "Loop" })).toBeTruthy();

    rerender(<TaskDetail detail={detailFixture} layout="panel" queryString="" members={[]} projects={[]} labels={[]} agentProfiles={[]} />);
    expect(screen.queryByLabelText("Loop 启动设置")).toBeNull();
  });

  it("does not expose the internal task ID when the detail has no shortId", () => {
    const { container } = render(<TaskDetail detail={{ ...detailFixture, task: { ...detailFixture.task, shortId: null } }} layout="page" queryString="" members={[]} projects={[]} labels={[]} agentProfiles={[]} />);

    expect(container.textContent).not.toContain("task_1");
  });

  it("normalizes null task content before passing it to the editor boundary", () => {
    render(<TaskDetail detail={{ ...detailFixture, task: { ...detailFixture.task, contentMarkdown: null } }} layout="page" queryString="" members={[]} projects={[]} labels={[]} agentProfiles={[]} />);

    expect(screen.getByTestId("task-editor").getAttribute("data-content-markdown")).toBe("");
  });

  it("shows Loop progress directly below the task title when a run exists", () => {
    render(<TaskDetail detail={{ ...detailFixture, task: { ...detailFixture.task, loopRuns: [{ id: "run_1", status: "running", currentIteration: 2, stopReason: null, version: 4, progress: { completed: 1, total: 6, percent: 17 } }] } }} layout="page" queryString="" members={[]} projects={[]} labels={[]} agentProfiles={[]} />);

    expect(screen.getByRole("tab", { name: "Loop" })).toBeTruthy();
    expect(screen.getAllByRole("progressbar", { name: "Loop 运行进度 17%" })).toHaveLength(1);
  });

  it("shows an explicit document association action in the task relations tab", async () => {
    const user = userEvent.setup();
    render(<TaskDetail detail={detailFixture} layout="panel" queryString="" members={[]} projects={[]} labels={[]} agentProfiles={[]} />);
    await user.click(screen.getByRole("tab", { name: "关联" }));
    expect(screen.getByRole("button", { name: "关联文档" })).toBeTruthy();
  });

  it("exposes restart for a worker failure waiting for intervention", async () => {
    const user = userEvent.setup();
    render(<TaskDetail detail={{ ...detailFixture, task: { ...detailFixture.task, loopRuns: [{ id: "run_1", status: "waiting", statusReason: "intervention:worker_execution_failed", currentIteration: 0, stopReason: null, version: 4, progress: { completed: 1, total: 6, percent: 17 } }] } }} layout="panel" queryString="" members={[]} projects={[]} labels={[]} agentProfiles={[]} />);

    await user.click(screen.getByRole("tab", { name: "Loop" }));
    expect(screen.getByRole("button", { name: "重新启动任务 Loop" })).toBeTruthy();
  });

  it("keeps the full-page Loop tab for monitoring without duplicating the launch controls", async () => {
    const user = userEvent.setup();
    render(<TaskDetail detail={{ ...detailFixture, task: { ...detailFixture.task, loopRuns: [{ id: "run_1", status: "waiting", statusReason: "intervention:worker_execution_failed", currentIteration: 0, stopReason: null, version: 4, progress: { completed: 1, total: 6, percent: 17 } }] } }} layout="page" queryString="" members={[]} projects={[]} labels={[]} agentProfiles={[]} />);

    expect(screen.getByLabelText("Loop 启动设置").getAttribute("data-loop-run")).toBe("run_1");
    await user.click(screen.getByRole("tab", { name: "Loop" }));
    expect(screen.queryByRole("button", { name: "重新启动任务 Loop" })).toBeNull();
    expect(screen.getAllByRole("progressbar", { name: "Loop 运行进度 17%" })).toHaveLength(2);
  });

  it("hides mutation controls from read-only viewers", () => {
    render(<TaskDetail detail={{ ...detailFixture, capabilities: { ...detailFixture.capabilities, edit: false, changeStatus: false, manageMembers: false, dispatchAgent: false } }} layout="page" queryString="" members={[]} projects={[]} labels={[]} agentProfiles={[]} />);
    expect(screen.queryByLabelText("任务状态")).toBeNull();
    expect(screen.queryByRole("button", { name: "添加评论" })).toBeNull();
    expect(screen.queryByRole("button", { name: "交给 Agent" })).toBeNull();
  });

  it("freezes archived task fields and restores through the existing command API", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true, result: { version: 4 } }), { status: 200, headers: { "content-type": "application/json" } })));
    render(<TaskDetail detail={{
      ...detailFixture,
      task: { ...detailFixture.task, archivedAt: new Date("2026-08-01T09:00:00.000Z") },
      capabilities: { ...detailFixture.capabilities, edit: false, changeStatus: false, manageMembers: false, manageVisibility: false, dispatchAgent: false, govern: true },
    }} layout="page" queryString="" members={[]} projects={[]} labels={[]} agentProfiles={[]} />);

    expect(screen.getByText("已归档")).toBeTruthy();
    expect(screen.queryByLabelText("任务状态")).toBeNull();
    expect(screen.queryByRole("button", { name: "编辑任务标题" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "恢复任务" }));
    expect(fetch).toHaveBeenCalledWith("/api/tasks/task_1/commands/restore", expect.objectContaining({ method: "POST" }));
    vi.unstubAllGlobals();
  });

  it("edits title and due date through versioned commands", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true, result: { version: 4 } }), { status: 200, headers: { "content-type": "application/json" } })));
    render(<TaskDetail detail={detailFixture} layout="page" queryString="" members={[]} projects={[]} labels={[]} agentProfiles={[]} />);
    await user.click(screen.getByRole("button", { name: "编辑任务标题" }));
    await user.clear(screen.getByLabelText("任务标题"));
    await user.type(screen.getByLabelText("任务标题"), "发布候选版本");
    await user.click(screen.getByRole("button", { name: "保存任务标题" }));
    expect(fetch).toHaveBeenCalledWith("/api/tasks/task_1/commands/update_fields", expect.objectContaining({ method: "POST" }));
    vi.unstubAllGlobals();
  });

  it("keeps status command IDs within the API limit for long internal task IDs", async () => {
    const user = userEvent.setup();
    const longTaskId = `task:space:company:${"company_".repeat(8)}:${"command_".repeat(8)}`;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true, result: { version: 4 } }), { status: 200, headers: { "content-type": "application/json" } })));

    render(<TaskDetail detail={{ ...detailFixture, task: { ...detailFixture.task, id: longTaskId } }} layout="page" queryString="" members={[]} projects={[]} labels={[]} agentProfiles={[]} />);
    await user.selectOptions(screen.getByLabelText("任务状态"), "submit_for_review");

    const request = vi.mocked(fetch).mock.calls[0]?.[1];
    const body = JSON.parse(String(request?.body)) as { commandId: string };
    expect(body.commandId).toMatch(/^[a-f0-9]{32}$/);
    vi.unstubAllGlobals();
  });

  it("routes automated acceptance through the evidence gate instead of the status menu", () => {
    render(<TaskDetail detail={{
      ...detailFixture,
      task: {
        ...detailFixture.task,
        statusCategory: "in_review",
        acceptanceMode: "automated",
        acceptanceReadiness: {
          ready: false,
          requiredChecks: ["delivery"],
          missingChecks: ["delivery"],
          blockingChecks: [],
          policyErrors: [],
          latestEvidence: [],
        },
      },
    }} layout="page" queryString="" members={[]} projects={[]} labels={[]} agentProfiles={[]} />);

    expect(screen.getByRole("region", { name: "自动验收" })).toBeTruthy();
    expect((screen.getByRole("option", { name: "通过验收" }) as HTMLOptionElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "通过验收" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
