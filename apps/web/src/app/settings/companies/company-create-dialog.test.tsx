// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CompanyCreateDialog } from "./company-create-dialog";

const push = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

afterEach(() => {
  cleanup();
  push.mockClear();
});

describe("CompanyCreateDialog", () => {
  it("keeps the entered company name when creation fails", async () => {
    const user = userEvent.setup();
    render(<CompanyCreateDialog action={vi.fn().mockResolvedValue({ ok: false, formError: "公司创建失败" })} />);

    await user.click(screen.getByRole("button", { name: "创建公司" }));
    await user.type(screen.getByLabelText("公司名称"), "HumanThread");
    await user.click(screen.getByRole("button", { name: "确认创建公司" }));

    expect((await screen.findByRole("alert")).textContent).toContain("公司创建失败");
    expect((screen.getByLabelText("公司名称") as HTMLInputElement).value).toBe("HumanThread");
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("navigates to the explicit company after successful creation", async () => {
    const user = userEvent.setup();
    render(<CompanyCreateDialog action={vi.fn().mockResolvedValue({ ok: true, companyId: "company_2" })} />);

    await user.click(screen.getByRole("button", { name: "创建公司" }));
    await user.type(screen.getByLabelText("公司名称"), "Beta");
    await user.click(screen.getByRole("button", { name: "确认创建公司" }));

    expect(push).toHaveBeenCalledWith("/companies/company_2");
  });
});
