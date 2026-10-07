import { render, screen, waitFor } from "@testing-library/react";
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

describe("core desktop pages", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("renders official task and agent data without enabling write commands", async () => {
    const user = await renderAuthenticated("/tasks");

    expect(await screen.findByText("实现客户端开箱向导")).toBeInTheDocument();
    await user.click(screen.getByRole("link", { name: "Agents" }));
    expect(await screen.findByText("Codex Worker")).toBeInTheDocument();
    expect(screen.getAllByText("只读预览").length).toBeGreaterThan(0);
    await user.click(screen.getByRole("button", { name: "Approvals" }));
    expect(screen.getByRole("button", { name: "批准" })).toBeDisabled();
  });

  it("renders the dashboard and project detail from official APIs", async () => {
    const user = await renderAuthenticated("/dashboard");
    expect(await screen.findByText("当前工作")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("待审批")).toBeInTheDocument());

    await user.click(screen.getByRole("link", { name: "项目" }));
    await user.click(await screen.findByRole("link", { name: "Desktop 重设计" }));
    expect(await screen.findByText("项目目标")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "路线图" }));
    expect(screen.getByText("设计评审")).toBeInTheDocument();
  });
});
