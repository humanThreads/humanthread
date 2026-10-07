// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TaskCreateDialog } from "./task-create-dialog";

const spaces = [
  { id: "space_personal", name: "个人空间", type: "personal" as const },
  { id: "space_company", name: "研发公司", type: "company" as const },
];
const projects = [{
  id: "project_1",
  name: "内部发布",
  spaceId: "space_company",
  milestones: [{ id: "milestone_1", name: "MVP" }],
}];

beforeEach(() => vi.stubGlobal("fetch", vi.fn()));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("TaskCreateDialog", () => {
  it("creates a title-only Task in the inherited company context", async () => {
    const user = userEvent.setup();
    const onCreated = vi.fn();
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      result: { taskId: "task_new", version: 1 },
    }), { status: 201, headers: { "content-type": "application/json" } }));
    render(<TaskCreateDialog
      open
      spaces={spaces}
      projects={projects}
      initialSpaceId="space_company"
      initialProjectId="project_1"
      initialStatusLabel="待处理"
      onOpenChange={vi.fn()}
      onCreated={onCreated}
    />);

    expect(screen.getByText("待处理")).toBeTruthy();
    await user.type(screen.getByLabelText("任务标题"), "整理发布清单");
    await user.click(screen.getByRole("button", { name: "创建任务" }));

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    const [path, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(path).toBe("/api/tasks");
    expect(JSON.parse(String(init?.body))).toMatchObject({
      spaceId: "space_company",
      title: "整理发布清单",
      projectId: "project_1",
      visibility: "project",
    });
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith({ taskId: "task_new", version: 1 }));
  });

  it("shows project milestones and progressive advanced settings", async () => {
    const user = userEvent.setup();
    render(<TaskCreateDialog open spaces={spaces} projects={projects} initialSpaceId="space_company" initialProjectId="project_1" onOpenChange={vi.fn()} onCreated={vi.fn()} />);

    expect(screen.getByLabelText("里程碑")).toBeTruthy();
    expect(screen.queryByLabelText("开始时间")).toBeNull();
    await user.click(screen.getByRole("button", { name: "更多设置" }));
    expect(screen.getByLabelText("开始时间")).toBeTruthy();
    expect(screen.getByLabelText("验收方式")).toBeTruthy();
    expect(screen.getByLabelText("任务正文")).toBeTruthy();
  });

  it("submits required checks for automated acceptance", async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      result: { taskId: "task_automated", version: 1 },
    }), { status: 201, headers: { "content-type": "application/json" } }));
    render(<TaskCreateDialog open spaces={spaces} projects={projects} initialSpaceId="space_company" initialProjectId="project_1" onOpenChange={vi.fn()} onCreated={vi.fn()} />);

    await user.type(screen.getByLabelText("任务标题"), "自动发布");
    await user.click(screen.getByRole("button", { name: "更多设置" }));
    await user.selectOptions(screen.getByLabelText("验收方式"), "automated");
    await user.clear(screen.getByLabelText("必需检查"));
    await user.type(screen.getByLabelText("必需检查"), "test, typecheck");
    await user.click(screen.getByRole("button", { name: "创建任务" }));

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    const request = vi.mocked(fetch).mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(request.body))).toMatchObject({
      acceptanceMode: "automated",
      requiredChecks: ["test", "typecheck"],
    });
  });

  it("only offers automated acceptance while a Project is selected", async () => {
    const user = userEvent.setup();
    render(<TaskCreateDialog open spaces={spaces} projects={projects} initialSpaceId="space_company" initialProjectId="project_1" onOpenChange={vi.fn()} onCreated={vi.fn()} />);

    await user.click(screen.getByRole("button", { name: "更多设置" }));
    await user.selectOptions(screen.getByLabelText("验收方式"), "automated");
    await user.selectOptions(screen.getByLabelText("项目"), "");

    expect((screen.getByLabelText("验收方式") as HTMLSelectElement).value).toBe("none");
    expect((screen.getByRole("option", { name: "自动检查" }) as HTMLOptionElement).disabled).toBe(true);
    expect((screen.getByRole("option", { name: "人工与自动" }) as HTMLOptionElement).disabled).toBe(true);
  });

  it("forces personal Tasks private and keeps server field errors in place", async () => {
    const user = userEvent.setup();
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({
      ok: false,
      code: "validation_failed",
      error: "Invalid Task request",
      issues: [{ path: ["title"], message: "标题已存在" }],
    }), { status: 400, headers: { "content-type": "application/json" } }));
    render(<TaskCreateDialog open spaces={spaces} projects={projects} initialSpaceId="space_personal" onOpenChange={vi.fn()} onCreated={vi.fn()} />);

    expect(screen.getByText("个人任务仅自己可见")).toBeTruthy();
    expect(screen.queryByLabelText("可见范围")).toBeNull();
    await user.type(screen.getByLabelText("任务标题"), "重复标题");
    await user.click(screen.getByRole("button", { name: "创建任务" }));

    expect((await screen.findByRole("alert")).textContent).toContain("标题已存在");
    expect((screen.getByLabelText("任务标题") as HTMLInputElement).value).toBe("重复标题");
  });

  it("asks before discarding a dirty form and suppresses duplicate submission", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    let resolveRequest!: (value: Response) => void;
    vi.mocked(fetch).mockImplementation(() => new Promise((resolve) => { resolveRequest = resolve; }));
    render(<TaskCreateDialog open spaces={spaces} projects={projects} initialSpaceId="space_company" onOpenChange={onOpenChange} onCreated={vi.fn()} />);

    await user.type(screen.getByLabelText("任务标题"), "尚未提交");
    await user.click(screen.getByRole("button", { name: "关闭新建任务弹窗" }));
    expect(screen.getByText("放弃当前编辑？")).toBeTruthy();
    expect(onOpenChange).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "继续编辑" }));
    expect((screen.getByLabelText("任务标题") as HTMLInputElement).value).toBe("尚未提交");

    const submit = screen.getByRole("button", { name: "创建任务" });
    await user.click(submit);
    expect(submit.hasAttribute("disabled")).toBe(true);
    await user.click(submit);
    expect(fetch).toHaveBeenCalledTimes(1);
    resolveRequest(new Response(JSON.stringify({ ok: true, result: { taskId: "task_1", version: 1 } }), {
      status: 201,
      headers: { "content-type": "application/json" },
    }));
  });
});
