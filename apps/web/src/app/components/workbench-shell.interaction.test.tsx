// @vitest-environment jsdom

import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkbenchAppShell } from "./workbench-shell";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

afterEach(cleanup);

function renderShell() {
  render(
    <WorkbenchAppShell
      activeKey="tasks"
      title="任务中心"
      subtitle="当前线程"
      loginEmail="review@example.com"
    />,
  );
}

describe("workbench shell mobile navigation", () => {
  it("keeps the full navigation behind a compact current-section trigger", async () => {
    const user = userEvent.setup();
    renderShell();

    expect(screen.queryByRole("dialog")).toBeNull();

    const trigger = screen.getByRole("button", {
      name: "打开工作台导航，当前栏目为任务中心",
    });
    expect(trigger.textContent).toContain("任务中心");

    await user.click(trigger);

    const dialog = screen.getByRole("dialog", { name: "工作台导航" });
    const navigation = within(dialog).getByRole("navigation", {
      name: "移动端工作台导航",
    });

    expect(within(navigation).getByText("推进")).toBeTruthy();
    expect(within(navigation).getByText("自动化")).toBeTruthy();
    expect(within(navigation).getByText("协作")).toBeTruthy();
    expect(within(navigation).getByText("复盘")).toBeTruthy();
    expect(
      within(navigation).getByRole("link", { name: "任务中心" }).getAttribute("aria-current"),
    ).toBe("page");
  });

  it("closes the drawer and restores focus to the mobile navigation trigger", async () => {
    const user = userEvent.setup();
    renderShell();

    const trigger = screen.getByRole("button", {
      name: "打开工作台导航，当前栏目为任务中心",
    });
    await user.click(trigger);
    await user.click(screen.getByRole("button", { name: "关闭工作台导航" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("closes the drawer after a navigation choice", async () => {
    const user = userEvent.setup();
    renderShell();

    await user.click(screen.getByRole("button", {
      name: "打开工作台导航，当前栏目为任务中心",
    }));
    const projectLink = screen.getByRole("link", { name: "项目空间" });
    projectLink.addEventListener("click", (event) => event.preventDefault(), { once: true });
    await user.click(projectLink);

    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
