// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SettingsFormActions, SettingsSection } from "./settings-form";

afterEach(cleanup);

describe("settings form primitives", () => {
  it("keeps save actions out of the layout until a section is dirty", () => {
    const { rerender } = render(
      <SettingsFormActions dirty={false} pending={false} onCancel={vi.fn()} />,
    );

    expect(screen.queryByRole("button", { name: "保存" })).toBeNull();

    rerender(
      <SettingsFormActions dirty pending={false} onCancel={vi.fn()} />,
    );
    expect((screen.getByRole("button", { name: "保存" }) as HTMLButtonElement).disabled)
      .toBe(false);
  });

  it("cancels locally and disables commands while saving", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(
      <SettingsFormActions dirty pending onCancel={onCancel} />,
    );

    expect((screen.getByRole("button", { name: "保存中" }) as HTMLButtonElement).disabled)
      .toBe(true);
    expect((screen.getByRole("button", { name: "取消" }) as HTMLButtonElement).disabled)
      .toBe(true);

    cleanup();
    render(<SettingsFormActions dirty pending={false} onCancel={onCancel} />);
    await user.click(screen.getByRole("button", { name: "取消" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("associates a semantic section heading with its content", () => {
    render(
      <SettingsSection title="个人资料" description="仅影响当前账号。">
        <label htmlFor="name">姓名</label>
        <input id="name" />
      </SettingsSection>,
    );

    expect(screen.getByRole("heading", { name: "个人资料" })).toBeTruthy();
    expect(screen.getByText("仅影响当前账号。")).toBeTruthy();
  });
});
