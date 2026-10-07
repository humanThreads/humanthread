// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  COMPANY_MEMBER_ACTION_OPTIONS,
  COMPANY_MEMBER_ROLE_OPTIONS,
  CompanyMemberActionsDialogs,
} from "./member-actions-dialogs";

afterEach(cleanup);

const members = [
  { id: "company_1:user_member", role: "member", user: { name: "Member" } },
];

function actions(result: { ok: boolean; formError?: string } = { ok: true }) {
  return {
    invite: vi.fn().mockResolvedValue(result),
    role: vi.fn().mockResolvedValue(result),
    remove: vi.fn().mockResolvedValue(result),
    transfer: vi.fn().mockResolvedValue(result),
  };
}

describe("company member action dialogs", () => {
  it("offers the supported non-owner company roles", () => {
    expect(COMPANY_MEMBER_ROLE_OPTIONS).toEqual(["member", "viewer", "admin"]);
  });

  it("exposes explicit owner transfer instead of relying on role edits", () => {
    expect(COMPANY_MEMBER_ACTION_OPTIONS).toContain("transfer");
    expect(COMPANY_MEMBER_ROLE_OPTIONS).not.toContain("owner");
  });

  it("keeps a destructive dialog open and preserves selection when its action fails", async () => {
    const user = userEvent.setup();
    render(createElement(CompanyMemberActionsDialogs, {
      companyId: "company_1",
      companyName: "HumanThread",
      members,
      inviteDisabled: false,
      canTransferOwnership: true,
      actions: actions({ ok: false, formError: "成员移除失败" }),
    }));

    await user.click(screen.getByRole("button", { name: "移除成员" }));
    await user.click(screen.getByRole("button", { name: "确认移除成员" }));

    expect((await screen.findByRole("alert")).textContent).toContain("成员移除失败");
    expect(screen.getByRole("dialog", { name: "移除成员" })).toBeTruthy();
    expect((screen.getByLabelText("成员") as HTMLSelectElement).value).toBe("company_1:user_member");
  });

  it("requires the exact company name before transferring owner", async () => {
    const user = userEvent.setup();
    render(createElement(CompanyMemberActionsDialogs, {
      companyId: "company_1",
      companyName: "HumanThread",
      members,
      inviteDisabled: false,
      canTransferOwnership: true,
      actions: actions(),
    }));

    await user.click(screen.getByRole("button", { name: "转移 owner" }));
    const submit = screen.getByRole("button", { name: "确认转移 owner" }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);

    await user.type(screen.getByLabelText("输入公司名称确认"), "HumanThread");
    expect(submit.disabled).toBe(false);
  });
});
