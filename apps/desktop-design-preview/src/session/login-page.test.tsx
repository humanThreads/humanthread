import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PreviewSessionProvider } from "./preview-session";
import { LoginPage } from "./login-page";

describe("LoginPage", () => {
  beforeEach(() => localStorage.clear());

  it("submits the real account and keeps the password out of browser storage", async () => {
    const user = userEvent.setup();
    const login = vi.fn().mockResolvedValue(undefined);
    render(
      <MemoryRouter>
        <PreviewSessionProvider storage={localStorage}>
          <LoginPage login={login} />
        </PreviewSessionProvider>
      </MemoryRouter>,
    );

    await user.type(screen.getByLabelText("登录邮箱"), "user@example.com");
    await user.type(screen.getByLabelText("登录密码"), "secret-value");
    await user.click(screen.getByRole("button", { name: "登录并进入工作台" }));

    expect(login).toHaveBeenCalledWith({
      email: "user@example.com",
      password: "secret-value",
    });
    expect(JSON.stringify(localStorage)).not.toContain("secret-value");
  });
});
