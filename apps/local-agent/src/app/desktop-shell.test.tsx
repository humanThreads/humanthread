// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("react-router-dom", () => ({
  NavLink: ({ children }: { children: React.ReactNode }) => <a href="/">{children}</a>,
}));

vi.mock("../components/shell/primary-navigation", () => ({
  PrimaryNavigation: () => <nav>主导航</nav>,
}));

vi.mock("../components/shell/top-bar", () => ({
  TopBar: () => <header>顶栏</header>,
}));

import { DesktopShell } from "./desktop-shell";

afterEach(cleanup);

describe("Desktop shell cache notice", () => {
  it("explains local cache deletion in the sidebar footer", async () => {
    render(<DesktopShell activeKey="dashboard"><div>内容</div></DesktopShell>);

    await userEvent.hover(screen.getByRole("button", { name: "本地会话缓存说明" }));

    expect(screen.getByText("删除本地缓存后，刷新页面不会恢复这部分内容；服务端只做实时转发，不保留会话正文。")).toBeTruthy();
    expect(screen.getByText(/默认保留 30 天/u)).toBeTruthy();
  });
});
