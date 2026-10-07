import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { DesktopQuitDialog } from "./quit-dialog";

describe("desktop quit dialog", () => {
  it("explains and offers only safe choices for an active external session", async () => {
    const user = userEvent.setup();
    const onChoice = vi.fn();
    render(
      <DesktopQuitDialog
        onChoice={onChoice}
        pending={false}
        state={{ managedRunning: true, externalSession: true }}
      />,
    );

    expect(screen.getByRole("dialog", { name: "退出 HumanThread" })).toBeVisible();
    expect(screen.getByText("本地命令仍在运行")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "保持会话并退出" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "中断命令并退出" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "中断命令并退出" }));
    expect(onChoice).toHaveBeenCalledWith("interrupt_and_quit");
  });

  it("uses a simple confirmation when no command or external session is active", () => {
    render(
      <DesktopQuitDialog
        error="退出请求失败"
        onChoice={vi.fn()}
        pending={false}
        state={{ managedRunning: false, externalSession: false }}
      />,
    );

    expect(screen.getByRole("button", { name: "退出应用" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "保持会话并退出" })).toBeNull();
    expect(screen.queryByRole("button", { name: "中断命令并退出" })).toBeNull();
    expect(screen.getByRole("alert")).toHaveTextContent("退出请求失败");
  });

  it("focuses the safe action and cancels from Escape", async () => {
    const user = userEvent.setup();
    const onChoice = vi.fn();
    render(
      <DesktopQuitDialog
        onChoice={onChoice}
        pending={false}
        state={{ managedRunning: true, externalSession: true }}
      />,
    );

    expect(screen.getByRole("button", { name: "后台继续运行" })).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(onChoice).toHaveBeenCalledWith("cancel");
  });
});
