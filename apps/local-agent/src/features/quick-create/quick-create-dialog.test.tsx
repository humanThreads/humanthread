import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { QuickCreateDialog } from "./quick-create-dialog";

describe("desktop quick create", () => {
  it("creates a task with a generated idempotency command", async () => {
    const user = userEvent.setup();
    const createTask = vi.fn().mockResolvedValue(undefined);
    render(
      <QuickCreateDialog
        createDocument={vi.fn()}
        createProject={vi.fn()}
        createTask={createTask}
        onClose={() => {}}
      />,
    );

    await user.type(screen.getByLabelText("任务标题"), "修复桌面登录");
    await user.click(screen.getByRole("button", { name: "创建任务" }));

    expect(createTask).toHaveBeenCalledWith({
      commandId: expect.stringMatching(/^desktop:create:/u),
      title: "修复桌面登录",
    });
  });

  it("requires a project objective before submitting", async () => {
    const user = userEvent.setup();
    const createProject = vi.fn().mockResolvedValue(undefined);
    render(
      <QuickCreateDialog
        createDocument={vi.fn()}
        createProject={createProject}
        createTask={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("tab", { name: "项目" }));
    await user.type(screen.getByLabelText("项目标题"), "桌面工作台");
    await user.click(screen.getByRole("button", { name: "创建项目" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("请填写项目目标");
    expect(createProject).not.toHaveBeenCalled();
  });

  it("keeps the dialog draft when creation fails", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const createTask = vi.fn().mockRejectedValue(new Error("没有当前空间的写入权限"));
    render(
      <QuickCreateDialog
        createDocument={vi.fn()}
        createProject={vi.fn()}
        createTask={createTask}
        onClose={onClose}
      />,
    );

    await user.type(screen.getByLabelText("任务标题"), "保留这条任务草稿");
    await user.click(screen.getByRole("button", { name: "创建任务" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("没有当前空间的写入权限");
    expect(screen.getByLabelText("任务标题")).toHaveValue("保留这条任务草稿");
    expect(screen.getByRole("dialog", { name: "快速新建" })).toBeVisible();
    expect(onClose).not.toHaveBeenCalled();
  });
});
