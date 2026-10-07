import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import App from "../App";
import { createFixtureFetch } from "../test/fixtures";

describe("QuickCreate", () => {
  beforeEach(() => localStorage.clear());

  it("explains the read-only state and never sends a create request", async () => {
    const fetchMock = createFixtureFetch();
    const user = userEvent.setup();
    window.history.replaceState({}, "", "/dashboard");
    render(<App fetch={fetchMock as typeof fetch} storage={localStorage} />);
    await user.type(screen.getByLabelText("登录邮箱"), "person@example.com");
    await user.type(screen.getByLabelText("登录密码"), "password");
    await user.click(screen.getByRole("button", { name: "登录并进入工作台" }));
    await user.click(await screen.findByRole("button", { name: "快速新建" }));

    expect(screen.getByRole("dialog", { name: "快速新建" })).toBeInTheDocument();
    expect(screen.getByText("设计预览只读，写操作未启用")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "创建任务" })).toBeDisabled();
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes("/api/desktop/create"))).toBe(false);
    vi.restoreAllMocks();
  });
});
