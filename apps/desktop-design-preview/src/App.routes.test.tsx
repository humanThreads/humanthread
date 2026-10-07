import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import App from "./App";
import { createFixtureFetch } from "./test/fixtures";

describe("Desktop preview routes", () => {
  beforeEach(() => localStorage.clear());

  it("exposes every primary Desktop destination", async () => {
    const user = userEvent.setup();
    window.history.replaceState({}, "", "/dashboard");
    render(<App fetch={createFixtureFetch() as typeof fetch} storage={localStorage} />);
    await user.type(screen.getByLabelText("登录邮箱"), "person@example.com");
    await user.type(screen.getByLabelText("登录密码"), "password");
    await user.click(screen.getByRole("button", { name: "登录并进入工作台" }));

    const destinations = [
      ["任务", "任务"],
      ["Agents", "Agents"],
      ["项目", "项目"],
      ["文档", "文档"],
      ["通知", "通知"],
      ["报表", "报表"],
      ["模板库", "模板库"],
      ["团队", "团队"],
      ["设置", "设置"],
    ] as const;

    for (const [link, heading] of destinations) {
      await user.click(screen.getByRole("link", { name: link }));
      expect(await screen.findByRole("heading", { level: 1, name: heading })).toBeInTheDocument();
    }
  });
});
