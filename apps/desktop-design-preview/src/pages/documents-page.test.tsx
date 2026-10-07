import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import App from "../App";
import { createFixtureFetch } from "../test/fixtures";

async function renderDocuments() {
  const user = userEvent.setup();
  window.history.replaceState({}, "", "/documents");
  localStorage.clear();
  render(<App fetch={createFixtureFetch() as typeof fetch} storage={localStorage} />);
  await user.type(screen.getByLabelText("登录邮箱"), "person@example.com");
  await user.type(screen.getByLabelText("登录密码"), "password");
  await user.click(screen.getByRole("button", { name: "登录并进入工作台" }));
  return user;
}

describe("DocumentsPage", () => {
  beforeEach(() => localStorage.clear());

  it("collapses and restores both sidebars and keeps trash and revisions closed by default", async () => {
    const user = await renderDocuments();

    expect(await screen.findByRole("button", { name: "展开文档目录" })).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "文档目录" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "展开文档目录" }));
    expect(screen.getByRole("navigation", { name: "文档目录" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "回收站" })).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("button", { name: "版本信息" })).toHaveAttribute("aria-expanded", "false");

    await user.click(screen.getByRole("button", { name: "收起文档目录" }));
    expect(screen.getByRole("button", { name: "展开文档目录" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "版本信息" }));
    expect(screen.getByRole("complementary", { name: "文档版本信息" })).toBeInTheDocument();
  });

  it("renders document content as Markdown instead of plain text", async () => {
    await renderDocuments();
    const markdown = await screen.findByTestId("document-markdown");
    expect(markdown.querySelector("h1")?.textContent).toBe("设计说明");
    expect(markdown.querySelectorAll("li")).toHaveLength(2);
  });
});
