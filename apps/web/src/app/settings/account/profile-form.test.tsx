// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AccountProfileForm } from "./profile-form";

afterEach(cleanup);

describe("account profile form", () => {
  it("shows section actions only after changing the current user's name", async () => {
    const user = userEvent.setup();
    render(
      <AccountProfileForm
        initialName="Alice"
        action={vi.fn().mockResolvedValue({ ok: true })}
      />,
    );

    expect(screen.queryByRole("button", { name: "保存" })).toBeNull();
    const input = screen.getByLabelText("姓名") as HTMLInputElement;
    await user.clear(input);
    await user.type(input, "Alice Chen");
    expect(screen.getByRole("button", { name: "保存" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "取消" }));
    expect(input.value).toBe("Alice");
  });

  it("becomes dirty again when the user edits after a successful save", async () => {
    const user = userEvent.setup();
    render(
      <AccountProfileForm
        initialName="Alice"
        action={vi.fn().mockResolvedValue({ ok: true })}
      />,
    );

    const input = screen.getByLabelText("姓名") as HTMLInputElement;
    await user.clear(input);
    await user.type(input, "Alice Chen");
    await user.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(screen.getByText("个人资料已保存")).toBeTruthy());

    await user.type(input, " Jr");
    await waitFor(() => expect(screen.getByRole("button", { name: "保存" })).toBeTruthy());
  });
});
