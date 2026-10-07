// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PasswordForm } from "./password-form";

afterEach(cleanup);

describe("password form", () => {
  it("keeps sensitive values after a failed save and clears them after success", async () => {
    const user = userEvent.setup();
    const failedAction = vi.fn().mockResolvedValue({
      ok: false,
      formError: "当前密码不正确",
    });
    const { rerender } = render(<PasswordForm action={failedAction} />);

    const current = screen.getByLabelText("当前密码") as HTMLInputElement;
    const next = screen.getByLabelText("新密码") as HTMLInputElement;
    const confirm = screen.getByLabelText("确认新密码") as HTMLInputElement;
    await user.type(current, "old-password");
    await user.type(next, "new-password");
    await user.type(confirm, "new-password");
    await user.click(screen.getByRole("button", { name: "保存新密码" }));

    expect(current.value).toBe("old-password");
    expect(screen.getByText("当前密码不正确")).toBeTruthy();

    rerender(<PasswordForm action={vi.fn().mockResolvedValue({ ok: true })} />);
    await user.click(screen.getByRole("button", { name: "保存新密码" }));
    await waitFor(() => {
      expect(current.value).toBe("");
      expect(next.value).toBe("");
      expect(confirm.value).toBe("");
    });
  });

  it("explains that a successful password change signs out other devices", async () => {
    const user = userEvent.setup();
    render(<PasswordForm action={vi.fn().mockResolvedValue({ ok: true, otherSessionsRevoked: 2 })} />);
    await user.type(screen.getByLabelText("当前密码"), "old-password");
    await user.type(screen.getByLabelText("新密码"), "new-password");
    await user.type(screen.getByLabelText("确认新密码"), "new-password");
    await user.click(screen.getByRole("button", { name: "保存新密码" }));
    expect(await screen.findByText("密码已更新，其他设备已退出登录")).toBeTruthy();
  });
});
