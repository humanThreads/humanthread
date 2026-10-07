// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CompanyProfileForm } from "./company-profile-form";

afterEach(cleanup);

describe("CompanyProfileForm", () => {
  it("retains edits after a failed save and supports cancel", async () => {
    const user = userEvent.setup();
    render(
      <CompanyProfileForm
        companyId="company_1"
        initialDescription="原简介"
        initialCertificationLevel="normal"
        action={vi.fn().mockResolvedValue({ ok: false, formError: "公司资料保存失败" })}
      />,
    );

    const description = screen.getByLabelText("公司简介");
    await user.clear(description);
    await user.type(description, "新简介");
    await user.click(screen.getByRole("button", { name: "保存公司资料" }));

    expect((await screen.findByRole("alert")).textContent).toContain("公司资料保存失败");
    expect((description as HTMLTextAreaElement).value).toBe("新简介");

    await user.click(screen.getByRole("button", { name: "取消" }));
    expect((description as HTMLTextAreaElement).value).toBe("原简介");
  });
});
