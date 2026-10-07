// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TaskLoopPreview } from "./task-loop-preview";

vi.mock("../workbench-shell", () => ({
  WorkbenchShell: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));

afterEach(cleanup);

describe("TaskLoopPreview", () => {
  it("renders the independent task page with the default Loop and target selected", () => {
    render(<TaskLoopPreview />);

    expect(screen.getByRole("heading", { name: "允许任务启动时选择执行 Loop" })).toBeTruthy();
    expect(screen.getByRole("radio", { name: /分支开发 Loop/ })).toHaveProperty("checked", true);
    expect(screen.getByRole("radio", { name: /标准 Linux Worker/ })).toHaveProperty("checked", true);
    expect(screen.getByText("分支开发 Loop v12 · 标准 Linux Worker")).toBeTruthy();
  });

  it("updates the frozen run summary when another ready Loop is selected", async () => {
    const user = userEvent.setup();
    render(<TaskLoopPreview />);

    await user.click(screen.getByRole("radio", { name: /快速修复 Loop/ }));

    expect(screen.getByText("快速修复 Loop v8 · 标准 Linux Worker")).toBeTruthy();
    expect(screen.getByText("本次使用 快速修复 Loop v8")).toBeTruthy();
  });

  it("keeps unavailable configurations visible with an actionable reason", () => {
    render(<TaskLoopPreview />);

    expect((screen.getByRole("radio", { name: /发布验收 Loop/ }) as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText("尚未配置 Worker 节点模型")).toBeTruthy();
    expect((screen.getByRole("radio", { name: /本地 Agent/ }) as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText("运行时当前离线")).toBeTruthy();
  });

  it("shows the run creation state and the subsequent success state", async () => {
    const user = userEvent.setup();
    render(<TaskLoopPreview />);

    await user.click(screen.getByRole("button", { name: "启动 Loop" }));
    expect((screen.getByRole("button", { name: "正在创建运行..." }) as HTMLButtonElement).disabled).toBe(true);

    expect(await screen.findByText("Loop 已启动", {}, { timeout: 1_500 })).toBeTruthy();
    expect(screen.getByText("运行 ID：loop_run_preview_0912")).toBeTruthy();
    expect((screen.getByRole("button", { name: "重新启动 Loop" }) as HTMLButtonElement).disabled).toBe(false);
  });
});
