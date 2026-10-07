// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CompanyMailForm } from "./company-mail-form";

afterEach(cleanup);

describe("CompanyMailForm", () => {
  it("retains entered values after failure and never pre-fills the password", async () => {
    const user = userEvent.setup();
    render(
      <CompanyMailForm
        companyId="company_1"
        initial={{ emailHost: "smtp.example.com", emailPort: 465, emailUsername: "noreply@example.com", hasPassword: true }}
        action={vi.fn().mockResolvedValue({ ok: false, formError: "邮件设置保存失败" })}
      />,
    );

    const host = screen.getByLabelText("服务器地址") as HTMLInputElement;
    const password = screen.getByLabelText("密码") as HTMLInputElement;
    expect(password.value).toBe("");
    expect(password.placeholder).toContain("留空保留现有密码");

    await user.clear(host);
    await user.type(host, "smtp.changed.example.com");
    await user.type(password, "new-secret");
    await user.click(screen.getByRole("button", { name: "保存邮件集成" }));

    expect((await screen.findByRole("alert")).textContent).toContain("邮件设置保存失败");
    expect(host.value).toBe("smtp.changed.example.com");
    expect(password.value).toBe("new-secret");
  });
});
