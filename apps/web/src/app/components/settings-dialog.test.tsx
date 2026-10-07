// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DangerConfirmDialog,
  SettingsDialog,
} from "./settings-dialog";

afterEach(cleanup);

describe("settings dialogs", () => {
  it("renders a labelled modal and returns focus to its trigger", async () => {
    const user = userEvent.setup();
    render(
      <SettingsDialog
        triggerLabel="创建公司"
        title="创建公司"
        description="公司与个人账号保持独立。"
      >
        <label htmlFor="company-name">公司名称</label>
        <input id="company-name" />
      </SettingsDialog>,
    );

    const trigger = screen.getByRole("button", { name: "创建公司" });
    await user.click(trigger);
    expect(screen.getByRole("dialog", { name: "创建公司" })).toBeTruthy();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("requires the exact confirmation text before a danger command", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(
      <DangerConfirmDialog
        triggerLabel="转移 owner"
        title="转移 owner"
        description="此操作会改变公司最高权限。"
        actionLabel="确认转移 owner"
        confirmationText="HumanThread"
        onConfirm={onConfirm}
      />,
    );

    await user.click(screen.getByRole("button", { name: "转移 owner" }));
    const confirm = screen.getByRole("button", { name: "确认转移 owner" });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);

    await user.type(screen.getByLabelText("输入 HumanThread 以确认"), "Human");
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    await user.type(screen.getByLabelText("输入 HumanThread 以确认"), "Thread");
    expect((confirm as HTMLButtonElement).disabled).toBe(false);
    await user.click(confirm);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
