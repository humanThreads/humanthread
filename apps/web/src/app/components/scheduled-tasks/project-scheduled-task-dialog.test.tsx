// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ProjectScheduledTaskListItem } from "../../../lib/orchestration/scheduled-task-read-model";
import { ProjectScheduledTaskDialog } from "./project-scheduled-task-dialog";

const targetOptions = [
  { type: "local_agent" as const, id: "agent_1", displayName: "本地 Agent · Codex", ready: true, reason: null, loopBindingIds: ["loop_project"] },
  { type: "linux_worker_pool" as const, id: "a".repeat(32), displayName: "Linux Worker · 默认池", ready: false, reason: "暂无可用容量", loopBindingIds: ["loop_project"] },
  { type: "local_agent" as const, id: "agent_task", displayName: "本地 Agent · 任务", ready: true, reason: null, loopBindingIds: ["loop_task"] },
];

const loopOptions = [
  { id: "loop_project", name: "项目巡检", scope: "project" as const, versionNumber: 2, enabled: true, targetOptions: targetOptions.filter((option) => option.loopBindingIds.includes("loop_project")) },
  { id: "loop_task", name: "任务处理", scope: "task" as const, versionNumber: 4, enabled: true, targetOptions: targetOptions.filter((option) => option.loopBindingIds.includes("loop_task")) },
  { id: "loop_archived", name: "已取消 Loop", scope: "project" as const, versionNumber: 1, enabled: false, targetOptions: [] },
];

function task(overrides: Partial<ProjectScheduledTaskListItem> = {}): ProjectScheduledTaskListItem {
  return {
    id: "task_1",
    name: "每日巡检",
    description: "检查项目状态",
    status: "inactive",
    version: 7,
    cronExpression: "0 9 * * *",
    timezone: "Asia/Shanghai",
    contentMode: "platform",
    contentMarkdown: "检查项目状态",
    loopBinding: { id: "loop_project", name: "项目巡检", scope: "project", versionNumber: 2 },
    executionTarget: { type: "local_agent", id: "agent_1", displayName: "本地 Agent · Codex", provider: "codex" },
    nextRunAt: "2026-09-23T01:00:00.000Z",
    pendingScheduledFor: null,
    lastScheduledFor: null,
    updatedAt: "2026-09-22T01:00:00.000Z",
    activeRun: null,
    ...overrides,
    latestRun: overrides.latestRun ?? null,
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("ProjectScheduledTaskDialog", () => {
  it("renders enabled project and task Loop options", () => {
    render(
      <ProjectScheduledTaskDialog
        projectId="project_1"
        mode="create"
        loopOptions={loopOptions}
        targetOptions={targetOptions}
        onSaved={vi.fn()}
      />,
    );

    expect(screen.getByRole("radio", { name: /项目级.*项目巡检.*v2/ })).toBeTruthy();
    expect(screen.getByRole("radio", { name: /任务级.*任务处理.*v4/ })).toBeTruthy();
    expect(screen.queryByRole("radio", { name: /已取消 Loop/ })).toBeNull();
  });

  it("renders only target options compatible with the selected Loop", async () => {
    const user = userEvent.setup();
    render(
      <ProjectScheduledTaskDialog
        projectId="project_1"
        mode="create"
        loopOptions={loopOptions}
        targetOptions={targetOptions}
        onSaved={vi.fn()}
      />,
    );

    expect(screen.getByRole("radio", { name: /本地 Agent · Codex/ })).toBeTruthy();
    expect(screen.getByRole("radio", { name: /Linux Worker · 默认池/ })).toBeTruthy();
    await user.click(screen.getByRole("radio", { name: /任务级.*任务处理.*v4/ }));
    expect(screen.getByRole("radio", { name: /本地 Agent · 任务/ })).toBeTruthy();
    expect(screen.queryByRole("radio", { name: /Linux Worker · 默认池/ })).toBeNull();
  });

  it("shows an unavailable stored target without falling back to another target", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(
      <ProjectScheduledTaskDialog
        projectId="project_1"
        mode="edit"
        task={task({ executionTarget: { type: "linux_worker_pool", id: "f".repeat(32), displayName: "已撤销 Worker", provider: null } })}
        loopOptions={loopOptions}
        targetOptions={targetOptions}
        onSaved={vi.fn()}
      />,
    );

    expect(screen.getByText(/已撤销 Worker/)).toBeTruthy();
    expect(screen.getByText(/原执行目标已不可用，请重新选择/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "保存任务" }));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("provides common Cron examples and a next-occurrence preview", async () => {
    const user = userEvent.setup();
    render(
      <ProjectScheduledTaskDialog
        projectId="project_1"
        mode="create"
        loopOptions={loopOptions}
        targetOptions={targetOptions}
        onSaved={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: /每天 9 点 0 9 \* \* \*/ }));
    expect((screen.getByLabelText("Cron") as HTMLInputElement).value).toBe("0 9 * * *");
    expect(screen.getByRole("status").textContent).toMatch(/下次预览：/);
    expect(screen.getByRole("status").textContent).not.toContain("无效");
  });

  it("shows the Markdown editor only for platform-managed content and clears it on mode change", async () => {
    const user = userEvent.setup();
    render(
      <ProjectScheduledTaskDialog
        projectId="project_1"
        mode="create"
        loopOptions={loopOptions}
        targetOptions={targetOptions}
        onSaved={vi.fn()}
      />,
    );

    const content = screen.getByLabelText("任务正文");
    await user.type(content, "每日检查");
    await user.click(screen.getByRole("radio", { name: /项目自行管理/ }));
    expect(screen.queryByLabelText("任务正文")).toBeNull();

    await user.click(screen.getByRole("radio", { name: /平台维护/ }));
    expect((screen.getByLabelText("任务正文") as HTMLTextAreaElement).value).toBe("");
  });

  it("always renders the exact red privacy notices", () => {
    render(
      <ProjectScheduledTaskDialog
        projectId="project_1"
        mode="create"
        loopOptions={loopOptions}
        targetOptions={targetOptions}
        onSaved={vi.fn()}
      />,
    );

    const platformNotice = screen.getByText(/平台维护：任务正文会上传到 HumanThread/);
    const managedNotice = screen.getByText(/项目自行管理：平台只保存调度和 Loop 绑定/);
    expect(platformNotice.className).toBe("text-xs leading-5 text-[#cf222e]");
    expect(managedNotice.className).toBe("text-xs leading-5 text-[#cf222e]");
    expect(platformNotice.textContent).toContain("请勿填写密码、Token、Cookie、密钥或受监管个人信息。");
    expect(managedNotice.textContent).toContain("内容未就绪时，本次运行会按 Loop 逻辑失败或等待。");
  });

  it("creates an inactive task without sending a status field", async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true, result: { id: "task_1" } }), {
      status: 201,
      headers: { "content-type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    render(
      <ProjectScheduledTaskDialog
        projectId="project_1"
        mode="create"
        loopOptions={loopOptions}
        targetOptions={targetOptions}
        onSaved={onSaved}
      />,
    );

    await user.type(screen.getByLabelText("名称"), "每日巡检");
    await user.click(screen.getByRole("radio", { name: /任务级.*任务处理.*v4/ }));
    await user.type(screen.getByLabelText("任务正文"), "检查项目状态");
    await user.click(screen.getByRole("radio", { name: /本地 Agent · 任务/ }));
    await user.click(screen.getByRole("button", { name: "保存任务" }));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/projects/project_1/scheduled-tasks");
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      name: "每日巡检",
      loopBindingId: "loop_task",
      contentMode: "platform",
      contentMarkdown: "检查项目状态",
      executionTarget: { type: "local_agent", agentProfileId: "agent_task" },
    });
    expect(body).not.toHaveProperty("status");
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it("omits contentMarkdown when creating a project-managed task", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true, result: { id: "task_1" } }), {
      status: 201,
      headers: { "content-type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    render(
      <ProjectScheduledTaskDialog
        projectId="project_1"
        mode="create"
        loopOptions={loopOptions}
        targetOptions={targetOptions}
        onSaved={vi.fn()}
      />,
    );

    await user.type(screen.getByLabelText("名称"), "仓库巡检");
    await user.click(screen.getByRole("radio", { name: /项目自行管理/ }));
    await user.click(screen.getByRole("button", { name: "保存任务" }));

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body.contentMode).toBe("loop_managed");
    expect(body).not.toHaveProperty("contentMarkdown");
  });

  it("requires a currently enabled Loop when the edited task's Loop is unavailable", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    render(
      <ProjectScheduledTaskDialog
        projectId="project_1"
        mode="edit"
        task={task({ loopBinding: { id: "loop_stale", name: "已停用巡检", scope: "project", versionNumber: 1 } })}
        loopOptions={loopOptions}
        targetOptions={targetOptions}
        onSaved={vi.fn()}
      />,
    );

    expect(screen.getByRole("alert").textContent).toContain("原 Loop“已停用巡检”已不再启用或可用");
    expect(screen.getByRole("button", { name: "保存任务" }).getAttribute("disabled")).not.toBeNull();
    await user.click(screen.getByRole("button", { name: "保存任务" }));
    expect(fetchMock).not.toHaveBeenCalled();

    await user.click(screen.getByRole("radio", { name: /任务级.*任务处理.*v4/ }));
    expect((screen.getByRole("button", { name: "保存任务" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("patches the expected version and clears content when switching to project-managed content", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true, result: { id: "task_1" } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    render(
      <ProjectScheduledTaskDialog
        projectId="project_1"
        mode="edit"
        task={task()}
        loopOptions={loopOptions}
        targetOptions={targetOptions}
        onSaved={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("radio", { name: /项目自行管理/ }));
    await user.click(screen.getByRole("button", { name: "保存任务" }));

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/projects/project_1/scheduled-tasks/task_1");
    expect(init.method).toBe("PATCH");
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      expectedVersion: 7,
      contentMode: "loop_managed",
      contentMarkdown: null,
      loopBindingId: "loop_project",
    });
  });

  it("moves focus into the dialog and closes it with Escape", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();

    render(
      <ProjectScheduledTaskDialog
        projectId="project_1"
        mode="create"
        loopOptions={loopOptions}
        targetOptions={targetOptions}
        onSaved={vi.fn()}
        onCancel={onCancel}
      />,
    );

    const dialog = screen.getByRole("dialog", { name: "新建定时任务" });
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    await user.keyboard("{Escape}");
    await waitFor(() => expect(onCancel).toHaveBeenCalledTimes(1));
  });
});
