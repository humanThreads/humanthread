import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import App from "../App";
import { createFixtureFetch } from "../test/fixtures";

async function renderSearch() {
  const user = userEvent.setup();
  window.history.replaceState({}, "", "/dashboard");
  localStorage.clear();
  render(<App fetch={createFixtureFetch() as typeof fetch} storage={localStorage} />);
  await user.type(screen.getByLabelText("登录邮箱"), "person@example.com");
  await user.type(screen.getByLabelText("登录密码"), "password");
  await user.click(screen.getByRole("button", { name: "登录并进入工作台" }));
  await user.click(await screen.findByRole("button", { name: "全局搜索" }));
  return user;
}

describe("GlobalSearch", () => {
  beforeEach(() => localStorage.clear());

  it("searches official Desktop data and closes with Escape", async () => {
    const user = await renderSearch();
    const dialog = screen.getByRole("dialog", { name: "全局搜索" });
    expect(dialog).toBeInTheDocument();
    await user.type(screen.getByLabelText("搜索工作台"), "设计");
    expect((await within(dialog).findAllByText("Desktop 重设计")).length).toBeGreaterThan(0);
    expect(within(dialog).getByText("设计说明")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "全局搜索" })).not.toBeInTheDocument();
  });
});
