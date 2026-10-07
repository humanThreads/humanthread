import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import App from "../App";
import { createFixtureFetch } from "../test/fixtures";

async function renderAuthenticated(path: string) {
  const user = userEvent.setup();
  window.history.replaceState({}, "", path);
  localStorage.clear();
  render(<App fetch={createFixtureFetch() as typeof fetch} storage={localStorage} />);
  await user.type(screen.getByLabelText("登录邮箱"), "person@example.com");
  await user.type(screen.getByLabelText("登录密码"), "password");
  await user.click(screen.getByRole("button", { name: "登录并进入工作台" }));
  return user;
}

describe("remaining desktop pages", () => {
  beforeEach(() => localStorage.clear());

  it("renders notifications, reports, templates, team and settings from official APIs", async () => {
    const user = await renderAuthenticated("/notifications");
    expect((await screen.findAllByText("审批等待处理")).length).toBeGreaterThan(0);

    await user.click(screen.getByRole("link", { name: "报表" }));
    expect(await screen.findByText("自动化成功率")).toBeInTheDocument();

    await user.click(screen.getByRole("link", { name: "模板库" }));
    expect(await screen.findByText("标准功能开发 Loop")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Loop 市场" })).toHaveAttribute("aria-selected", "true");

    await user.click(screen.getByRole("link", { name: "团队" }));
    expect(await screen.findByText("测试用户")).toBeInTheDocument();

    await user.click(screen.getByRole("link", { name: "设置" }));
    expect(await screen.findByRole("tab", { name: "本地执行环境" })).toHaveAttribute("aria-selected", "true");
  });
});
