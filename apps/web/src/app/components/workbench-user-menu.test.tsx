// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkbenchUserMenu } from "./workbench-user-menu";

const { logoutAction, setSpaceAction } = vi.hoisted(() => ({
  logoutAction: vi.fn(),
  setSpaceAction: vi.fn(),
}));

vi.mock("../workbench/actions", () => ({
  logoutWorkbenchAction: logoutAction,
  setWorkbenchSpaceAction: setSpaceAction,
}));

afterEach(() => {
  cleanup();
  logoutAction.mockReset();
  setSpaceAction.mockReset();
});

describe("WorkbenchUserMenu", () => {
  it("renders only personal identity and account-owned actions", async () => {
    const user = userEvent.setup();
    render(<WorkbenchUserMenu name="Alice" email="alice@example.com" />);

    await user.click(screen.getByRole("button", { name: "打开账号菜单" }));

    expect(screen.getByText("Alice")).toBeTruthy();
    expect(screen.getByText("alice@example.com")).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "设置中心" }).getAttribute("href")).toBe("/settings");
    expect(screen.getByRole("menuitem", { name: "下载本地 Agent" }).getAttribute("href")).toBe("/downloads");
    expect(screen.getByRole("menuitem", { name: "退出登录" })).toBeTruthy();
    expect(screen.queryByText("普通会员")).toBeNull();
    expect(screen.queryByText("Agent 中心")).toBeNull();
    expect(screen.queryByText("公司空间")).toBeNull();
    expect(screen.queryByText("设备与 Agent")).toBeNull();
    expect(screen.queryByText("MCP")).toBeNull();
  });

  it("supports keyboard opening, Escape dismissal, and trigger focus restoration", async () => {
    const user = userEvent.setup();
    render(<WorkbenchUserMenu name="Alice" email="alice@example.com" />);

    const trigger = screen.getByRole("button", { name: "打开账号菜单" });
    trigger.focus();
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitem", { name: "设置中心" })).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "设置中心" }));

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("dismisses on an outside pointer interaction", async () => {
    const user = userEvent.setup();
    render(
      <div>
        <WorkbenchUserMenu name="Alice" email="alice@example.com" />
        <button type="button">页面操作</button>
      </div>,
    );

    const outsideButton = screen.getByRole("button", { name: "页面操作" });
    await user.click(screen.getByRole("button", { name: "打开账号菜单" }));
    fireEvent.pointerDown(outsideButton);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("renders an uploaded avatar and keeps long identity text constrained", async () => {
    const user = userEvent.setup();
    const longName = "HumanThread Delivery Operations Account With A Very Long Name";
    render(
      <WorkbenchUserMenu
        name={longName}
        email="very-long-delivery-account@example.com"
        avatarSrc="/uploads/avatars/user_owner/avatar.png?v=1747900800000"
      />,
    );

    expect(screen.getByRole("img", { name: longName }).getAttribute("src")).toContain("/uploads/avatars/user_owner/avatar.png");
    await user.click(screen.getByRole("button", { name: "打开账号菜单" }));
    expect(screen.getByText(longName).className).toContain("truncate");
    expect(screen.getByText("very-long-delivery-account@example.com").className).toContain("truncate");
  });

  it("locks logout while the server action is pending", async () => {
    const user = userEvent.setup();
    let resolveLogout: (() => void) | undefined;
    logoutAction.mockImplementation(() => new Promise<void>((resolve) => {
      resolveLogout = resolve;
    }));
    render(<WorkbenchUserMenu name="Alice" email="alice@example.com" />);

    await user.click(screen.getByRole("button", { name: "打开账号菜单" }));
    await user.click(screen.getByRole("menuitem", { name: "退出登录" }));

    const pendingButton = await screen.findByRole("menuitem", { name: "正在退出..." });
    expect((pendingButton as HTMLButtonElement).disabled).toBe(true);
    resolveLogout?.();
    await waitFor(() => expect(logoutAction).toHaveBeenCalledTimes(1));
  });
});
